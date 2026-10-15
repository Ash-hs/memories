import Foundation

// macOS integration check of the exact AVFoundation encoder used by the iOS module.
@main
struct NativeExportTest {
  static func main() {
    guard CommandLine.arguments.count == 3 else {
      fatalError("Usage: native-export-test <bgm.mp3> <output.mp4>")
    }
    let queue = DispatchQueue(label: "memories.video.integration")
    queue.async {
      do {
        try run(queue: queue)
      } catch {
        fputs("Native export failed: \(error)\n", stderr)
        exit(1)
      }
    }
    dispatchMain()
  }

  static func run(queue: DispatchQueue) throws {
    let audio = URL(fileURLWithPath: CommandLine.arguments[1])
    let output = URL(fileURLWithPath: CommandLine.arguments[2])
    let raw = output.deletingLastPathComponent().appendingPathComponent("native-export-test.bgra")
    let cancelledOutput = output.deletingLastPathComponent().appendingPathComponent("native-cancel-test.mp4")
    let cancelled = try VideoEncoder(output: cancelledOutput, audio: audio, width: 720, height: 1080, fps: 30, frameCount: 1440, queue: queue)
    do {
      _ = try cancelled.append(frame: raw, index: 1)
      fatalError("Out of sequence frame was accepted")
    } catch is VideoExportError {}
    do {
      try cancelled.finish { _ in fatalError("Incomplete export was finalized") }
      fatalError("Incomplete export was accepted")
    } catch is VideoExportError {}
    try cancelled.cancel()
    assert(!FileManager.default.fileExists(atPath: cancelledOutput.path))
    do {
      _ = try cancelled.append(frame: raw, index: 0)
      fatalError("Cancelled export was accepted")
    } catch is VideoExportError {}

    let encoder = try VideoEncoder(output: output, audio: audio, width: 720, height: 1080, fps: 30, frameCount: 1440, queue: queue)
    do {
      for index in 0..<1440 {
        if index.isMultiple(of: 480) {
          // The three thirds are red, green and blue; the bottom row is always white.
          var bytes = Data(count: 720 * 1080 * 4)
          bytes.withUnsafeMutableBytes { (buffer: UnsafeMutableRawBufferPointer) in
            for pixel in 0..<(720 * 1080) {
              let offset = pixel * 4
              buffer[offset + (2 - index / 480)] = 255
              buffer[offset + 3] = 255
              if pixel >= 720 * 1070 {
                buffer[offset] = 255
                buffer[offset + 1] = 255
                buffer[offset + 2] = 255
              }
            }
          }
          try bytes.write(to: raw)
        }
        let deadline = Date().addingTimeInterval(30)
        while try !encoder.append(frame: raw, index: index) {
          guard Date() < deadline else { throw VideoExportError.invalid("Encoder backpressure timed out") }
          Thread.sleep(forTimeInterval: 0.005)
        }
      }
      try FileManager.default.removeItem(at: raw)
      try encoder.finish { result in
        switch result {
        case .success(let uri):
          print("Exported 1440 frames with BGM: \(uri)")
          exit(0)
        case .failure(let error):
          do { try encoder.cancel() } catch { fputs("Cleanup failed: \(error)\n", stderr) }
          fputs("Finalization failed: \(error)\n", stderr)
          exit(1)
        }
      }
    } catch {
      try encoder.cancel()
      if FileManager.default.fileExists(atPath: raw.path) { try FileManager.default.removeItem(at: raw) }
      throw error
    }
  }
}
