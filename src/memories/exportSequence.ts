export const VIDEO_EXPORT = { width: 720, height: 1080, fps: 30, duration: 48 } as const;

export class ExportCancelledError extends Error {
  constructor() {
    super("视频导出已取消");
    this.name = "ExportCancelledError";
  }
}

export function checkExportCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new ExportCancelledError();
}

export async function renderVideoFrames(options: {
  signal: AbortSignal;
  render: (time: number) => void;
  append: (index: number) => Promise<boolean>;
  onProgress: (completed: number, total: number) => void;
}) {
  const count = VIDEO_EXPORT.fps * VIDEO_EXPORT.duration;
  options.onProgress(0, count);
  for (let index = 0; index < count; index++) {
    checkExportCancelled(options.signal);
    options.render(index / VIDEO_EXPORT.fps);
    const deadline = Date.now() + 30_000;
    while (true) {
      checkExportCancelled(options.signal);
      if (await options.append(index)) break;
      if (Date.now() >= deadline) throw new Error("视频编码器等待超时，请重试导出");
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    options.onProgress(index + 1, count);
  }
  checkExportCancelled(options.signal);
}
