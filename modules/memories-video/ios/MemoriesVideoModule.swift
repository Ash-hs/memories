import ExpoModulesCore

public final class MemoriesVideoModule: Module {
  private let queue = DispatchQueue(label: "memories.video.encoder")
  private var encoder: VideoEncoder?

  public func definition() -> ModuleDefinition {
    Name("MemoriesVideo")

    AsyncFunction("start") { (output: URL, audio: URL, width: Int, height: Int, fps: Int, count: Int) -> String in
      guard self.encoder == nil else { throw VideoExportError.invalid("A video export is already running") }
      let encoder = try VideoEncoder(output: output, audio: audio, width: width, height: height, fps: fps, frameCount: count, queue: self.queue)
      self.encoder = encoder
      return encoder.id
    }.runOnQueue(queue)

    AsyncFunction("append") { (id: String, frame: URL, index: Int) -> Bool in
      try self.session(id).append(frame: frame, index: index)
    }.runOnQueue(queue)

    AsyncFunction("finish") { (id: String, promise: Promise) in
      try self.session(id).finish { result in
        switch result {
        case .success(let uri):
          self.encoder = nil
          promise.resolve(uri)
        case .failure(let error):
          promise.reject(error)
        }
      }
    }.runOnQueue(queue)

    AsyncFunction("cancel") { (id: String) in
      // Cleanup may arrive after finish has already succeeded.
      if let encoder = self.encoder, encoder.id == id {
        try encoder.cancel()
        self.encoder = nil
      }
    }.runOnQueue(queue)

    OnDestroy {
      self.queue.async {
        do {
          try self.encoder?.cancel()
          self.encoder = nil
        } catch {
          NSLog("[Memories] Failed to clean up video export: %@", error.localizedDescription)
        }
      }
    }
  }

  private func session(_ id: String) throws -> VideoEncoder {
    guard let encoder, encoder.id == id else { throw VideoExportError.invalid("Video export session is no longer active") }
    return encoder
  }
}
