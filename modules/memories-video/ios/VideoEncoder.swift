import AVFoundation
import CoreVideo
import Foundation

enum VideoExportError: LocalizedError {
  case invalid(String)

  var errorDescription: String? {
    switch self {
    case .invalid(let message): return message
    }
  }
}

// All calls and completion handlers are confined to the module's serial queue.
final class VideoEncoder {
  let id = UUID().uuidString
  private let queue: DispatchQueue
  private let directory: URL
  private let output: URL
  private let audio: URL
  private let width: Int
  private let height: Int
  private let fps: Int32
  private let frameCount: Int
  private let writer: AVAssetWriter
  private let input: AVAssetWriterInput
  private let adaptor: AVAssetWriterInputPixelBufferAdaptor
  private var exporter: AVAssetExportSession?
  private var compositionSources: [AVURLAsset] = []
  private var nextFrame = 0
  private var cancelled = false
  private var finishing = false

  init(output: URL, audio: URL, width: Int, height: Int, fps: Int, frameCount: Int, queue: DispatchQueue) throws {
    guard output.isFileURL, audio.isFileURL,
          width > 0, width <= 2160, width.isMultiple(of: 2),
          height > 0, height <= 3840, height.isMultiple(of: 2),
          fps > 0, fps <= 60, frameCount > 0, frameCount <= fps * 600 else {
      throw VideoExportError.invalid("Invalid local video export settings")
    }
    guard FileManager.default.fileExists(atPath: audio.path),
          !FileManager.default.fileExists(atPath: output.path) else {
      throw VideoExportError.invalid("Audio is missing or output already exists")
    }
    let capacity = try output.deletingLastPathComponent().resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
    if let available = capacity.volumeAvailableCapacityForImportantUsage, available < 150 * 1024 * 1024 {
      throw VideoExportError.invalid("MP4 export needs at least 150 MB of free disk space")
    }
    self.queue = queue
    self.output = output
    self.audio = audio
    self.width = width
    self.height = height
    self.fps = Int32(fps)
    self.frameCount = frameCount
    directory = FileManager.default.temporaryDirectory.appendingPathComponent("memories-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    do {
      writer = try AVAssetWriter(outputURL: directory.appendingPathComponent("silent.mp4"), fileType: .mp4)
      input = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: 4_000_000,
          AVVideoExpectedSourceFrameRateKey: fps,
          AVVideoMaxKeyFrameIntervalKey: fps * 2,
          AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
        ]
      ])
      input.expectsMediaDataInRealTime = false
      adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
        kCVPixelBufferIOSurfacePropertiesKey as String: [:]
      ])
      guard writer.canAdd(input) else { throw VideoExportError.invalid("H.264 encoding is unavailable") }
      writer.add(input)
      guard writer.startWriting() else { throw writer.error ?? VideoExportError.invalid("Cannot start H.264 writer") }
      writer.startSession(atSourceTime: .zero)
    } catch {
      try FileManager.default.removeItem(at: directory)
      throw error
    }
  }

  func append(frame: URL, index: Int) throws -> Bool {
    guard !cancelled, !finishing, index == nextFrame, index < frameCount, frame.isFileURL else {
      throw VideoExportError.invalid("Export cancelled or frame is out of sequence")
    }
    guard writer.status == .writing else {
      throw writer.error ?? VideoExportError.invalid("H.264 writer stopped unexpectedly")
    }
    // The caller retains just one frame and retries after yielding when the encoder applies backpressure.
    guard input.isReadyForMoreMediaData else { return false }
    try autoreleasepool {
      let bytes = try Data(contentsOf: frame, options: .mappedIfSafe)
      guard bytes.count == width * height * 4, let pool = adaptor.pixelBufferPool else {
        throw VideoExportError.invalid("Invalid BGRA frame or missing pixel buffer pool")
      }
      var pixelBuffer: CVPixelBuffer?
      guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pixelBuffer) == kCVReturnSuccess,
            let buffer = pixelBuffer else {
        throw VideoExportError.invalid("Cannot allocate video pixel buffer")
      }
      guard CVPixelBufferLockBaseAddress(buffer, []) == kCVReturnSuccess else {
        throw VideoExportError.invalid("Cannot lock video pixel buffer")
      }
      defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
      guard let base = CVPixelBufferGetBaseAddress(buffer) else {
        throw VideoExportError.invalid("Pixel buffer has no writable memory")
      }
      let rowBytes = CVPixelBufferGetBytesPerRow(buffer)
      bytes.withUnsafeBytes { source in
        for row in 0..<height {
          memcpy(base.advanced(by: row * rowBytes), source.baseAddress!.advanced(by: row * width * 4), width * 4)
        }
      }
      guard adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(index), timescale: fps)) else {
        throw writer.error ?? VideoExportError.invalid("Cannot append video frame \(index)")
      }
    }
    nextFrame += 1
    return true
  }

  func finish(completion: @escaping (Result<String, Error>) -> Void) throws {
    guard !cancelled, !finishing, nextFrame == frameCount else {
      throw VideoExportError.invalid("Export cancelled or video frames are incomplete")
    }
    finishing = true
    writer.endSession(atSourceTime: CMTime(value: Int64(frameCount), timescale: fps))
    input.markAsFinished()
    writer.finishWriting {
      self.queue.async {
        do {
          guard !self.cancelled, self.writer.status == .completed else {
            throw VideoExportError.invalid("H.264 finalization cancelled or failed: \(String(describing: self.writer.error))")
          }
          try self.muxAudio(completion: completion)
        } catch {
          completion(.failure(error))
        }
      }
    }
  }

  private func muxAudio(completion: @escaping (Result<String, Error>) -> Void) throws {
    let audioAsset = AVURLAsset(url: audio)
    let duration = CMTime(value: Int64(frameCount), timescale: fps)
    // MP3 cannot be passed through into an AVFoundation MP4. Encode only the audio to AAC first.
    guard let session = AVAssetExportSession(asset: audioAsset, presetName: AVAssetExportPresetAppleM4A) else {
      throw VideoExportError.invalid("AAC audio encoding is unavailable")
    }
    // AAC packet boundaries/encoder padding can shorten an exact-duration export on iOS.
    // Encode a small tail, then trim the usable AAC track to the exact video duration.
    session.timeRange = CMTimeRange(start: .zero, duration: CMTimeAdd(duration, CMTime(value: 1, timescale: 4)))
    let aac = directory.appendingPathComponent("bgm.m4a")
    runExport(session, to: aac, type: .m4a) { result in
      switch result {
      case .success:
        self.loadComposition(audio: aac, completion: completion)
      case .failure(let error):
        completion(.failure(error))
      }
    }
  }

  private func loadComposition(audio: URL, completion: @escaping (Result<String, Error>) -> Void) {
    let videoAsset = AVURLAsset(url: directory.appendingPathComponent("silent.mp4"))
    let audioAsset = AVURLAsset(url: audio)
    // AVAssetTrack does not retain its parent asset. Keep both sources alive through export.
    compositionSources = [videoAsset, audioAsset]
    Task {
      do {
        let videoTracks = try await videoAsset.loadTracks(withMediaType: .video)
        let audioTracks = try await audioAsset.loadTracks(withMediaType: .audio)
        guard let videoSource = videoTracks.first else {
          throw VideoExportError.invalid("Encoded H.264 file has no video track")
        }
        guard let audioSource = audioTracks.first else {
          throw VideoExportError.invalid("Converted AAC file has no audio track")
        }
        let audioRange = try await audioSource.load(.timeRange)
        let videoRange = try await videoSource.load(.timeRange)
        self.queue.async {
          do {
            let duration = CMTime(value: Int64(self.frameCount), timescale: self.fps)
            guard !self.cancelled else {
              throw VideoExportError.invalid("Video export was cancelled before composing tracks")
            }
            guard audioRange.isValid, audioRange.duration.isNumeric,
                  CMTimeCompare(audioRange.duration, duration) >= 0 else {
              throw VideoExportError.invalid("AAC track is too short: start=\(audioRange.start.seconds)s, duration=\(audioRange.duration.seconds)s, required=\(duration.seconds)s")
            }
            guard videoRange.isValid, videoRange.duration.isNumeric,
                  CMTimeCompare(videoRange.start, .zero) <= 0,
                  CMTimeCompare(CMTimeRangeGetEnd(videoRange), duration) >= 0 else {
              throw VideoExportError.invalid("H.264 track does not cover export: start=\(videoRange.start.seconds)s, duration=\(videoRange.duration.seconds)s, required=\(duration.seconds)s")
            }
            NSLog("[Memories] MP4 tracks: video=%.6fs, AAC start=%.6fs duration=%.6fs, output=%.6fs",
                  videoRange.duration.seconds, audioRange.start.seconds, audioRange.duration.seconds, duration.seconds)
            let composition = AVMutableComposition()
            guard let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
                  let audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
              throw VideoExportError.invalid("Cannot allocate MP4 composition tracks")
            }
            let range = CMTimeRange(start: .zero, duration: duration)
            do {
              try videoTrack.insertTimeRange(range, of: videoSource, at: .zero)
            } catch {
              throw VideoExportError.invalid("Inserting H.264 video track failed: \(error)")
            }
            do {
              try audioTrack.insertTimeRange(CMTimeRange(start: audioRange.start, duration: duration), of: audioSource, at: .zero)
            } catch {
              throw VideoExportError.invalid("Inserting AAC audio track failed: \(error)")
            }
            guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough),
                  session.supportedFileTypes.contains(.mp4) else {
              throw VideoExportError.invalid("MP4 audio muxing is unavailable")
            }
            session.timeRange = range
            session.shouldOptimizeForNetworkUse = true
            self.runExport(session, to: self.output, type: .mp4) { result in
              do {
                try result.get()
                try FileManager.default.removeItem(at: self.directory)
                completion(.success(self.output.absoluteString))
              } catch {
                completion(.failure(error))
              }
            }
          } catch {
            completion(.failure(VideoExportError.invalid("Composing MP4 failed: \(error)")))
          }
        }
      } catch {
        self.queue.async { completion(.failure(VideoExportError.invalid("Loading MP4/AAC tracks failed: \(error)"))) }
      }
    }
  }

  private func runExport(_ session: AVAssetExportSession, to url: URL, type: AVFileType, completion: @escaping (Result<Void, Error>) -> Void) {
    exporter = session
    if #available(iOS 18.0, macOS 15.0, *) {
      Task {
        do {
          try await session.export(to: url, as: type)
          self.queue.async {
            completion(self.cancelled ? .failure(VideoExportError.invalid("Video export cancelled")) : .success(()))
          }
        } catch {
          self.queue.async {
            completion(.failure(VideoExportError.invalid("Exporting \(type.rawValue) failed: \(error.localizedDescription) (\(error))")))
          }
        }
      }
    } else {
      session.outputURL = url
      session.outputFileType = type
      session.exportAsynchronously {
        self.queue.async {
          if !self.cancelled, session.status == .completed {
            completion(.success(()))
          } else {
            completion(.failure(session.error ?? VideoExportError.invalid("Audio export cancelled or failed")))
          }
        }
      }
    }
  }

  func cancel() throws {
    cancelled = true
    if writer.status == .writing { writer.cancelWriting() }
    exporter?.cancelExport()
    for url in [directory, output] where FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
  }
}
