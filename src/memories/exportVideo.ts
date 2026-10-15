import { Asset } from "expo-asset";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { AlphaType, ColorType, Skia } from "react-native-skia";
import encoder from "../../modules/memories-video";
import { checkExportCancelled, ExportCancelledError, renderVideoFrames, VIDEO_EXPORT } from "./exportSequence";
import type { MediaStore } from "./media";
import { audioModule } from "./pack";
import { drawFrame, FRAME } from "./render";

export type ExportProgress = { stage: "frames" | "audio" | "sharing"; completed: number; total: number };

export async function exportVideo(media: MediaStore, signal: AbortSignal, onProgress: (progress: ExportProgress) => void) {
  if (Platform.OS !== "ios") throw new Error("MP4 离线导出目前仅支持 iOS，其他平台仍可分享 PNG");
  if (!encoder) throw new Error("当前客户端不含 MP4 编码模块，请重新构建 iOS 开发客户端");
  const native = encoder;
  checkExportCancelled(signal);
  const stamp = Date.now();
  const frame = new File(Paths.cache, `memories-${stamp}.bgra`);
  const output = new File(Paths.document, `memories-${stamp}.mp4`);
  const { width, height, fps, duration } = VIDEO_EXPORT;
  let surface: ReturnType<typeof Skia.Surface.MakeOffscreen> = null;
  let session: string | undefined;
  let cancellation: Promise<void> | undefined;
  let completed = false;
  const cancel = () => {
    if (session) cancellation ??= native.cancel(session);
    return cancellation;
  };
  const onAbort = () => {
    void cancel()?.catch((error: unknown) => console.error("[Memories] MP4 cancellation failed", error));
  };
  try {
    const audio = await Asset.fromModule(audioModule).downloadAsync();
    checkExportCancelled(signal);
    if (!audio.localUri) throw new Error("背景音乐尚未下载到本地，无法离线导出");
    session = await native.start(output.uri, audio.localUri, width, height, fps, fps * duration);
    signal.addEventListener("abort", onAbort);
    checkExportCancelled(signal);
    surface = Skia.Surface.MakeOffscreen(width, height);
    if (!surface) throw new Error("无法分配 MP4 离屏渲染画布");
    const exportSurface = surface;
    const canvas = exportSurface.getCanvas();
    canvas.scale(width / FRAME.width, height / FRAME.height);
    const id = session;
    await renderVideoFrames({
      signal,
      render: (time) => {
        drawFrame(canvas, time, media);
        exportSurface.flush();
        const image = exportSurface.makeImageSnapshot();
        try {
          const pixels = image.readPixels(0, 0, { width, height, colorType: ColorType.BGRA_8888, alphaType: AlphaType.Opaque });
          if (!(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) {
            throw new Error(`无法读取 ${time.toFixed(3)} 秒的 BGRA 视频帧`);
          }
          frame.write(pixels);
        } finally {
          image.dispose();
        }
      },
      append: (index) => native.append(id, frame.uri, index),
      onProgress: (done, total) => onProgress({ stage: "frames", completed: done, total }),
    });
    onProgress({ stage: "audio", completed: fps * duration, total: fps * duration });
    const uri = await native.finish(id);
    checkExportCancelled(signal);
    completed = true;
    return uri;
  } catch (error) {
    if (signal.aborted) throw new ExportCancelledError();
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    surface?.dispose();
    try {
      await cancel();
    } finally {
      if (frame.exists) frame.delete();
      if (!completed && output.exists) output.delete();
    }
  }
}

export async function shareVideo(uri: string) {
  if (!await Sharing.isAvailableAsync()) throw new Error(`系统分享不可用，MP4 已保存至：${uri}`);
  await Sharing.shareAsync(uri, { mimeType: "video/mp4", UTI: "public.mpeg-4", dialogTitle: "分享回顾短片" });
}
