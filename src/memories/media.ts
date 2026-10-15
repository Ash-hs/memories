import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { createVideoPlayer, type VideoPlayer } from "expo-video";
import { Skia, type SkImage } from "react-native-skia";
import { imageModules, manifest, videoModule } from "./pack";

export const VIDEO_FPS = 12;
export interface MediaStore {
  images: Map<string, SkImage>;
  videoFrames: SkImage[];
  failures: Map<string, string>;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function decodeImage(uri: string) {
  const data = await Skia.Data.fromURI(uri);
  const image = Skia.Image.MakeImageFromEncoded(data);
  data.dispose();
  if (!image) throw new Error(`Cannot decode image: ${uri}`);
  return image;
}

export async function loadImages(store: MediaStore) {
  await Promise.all(
    Object.entries(imageModules).map(async ([uri, module]) => {
      try {
        const asset = await Asset.fromModule(module).downloadAsync();
        store.images.set(uri, await decodeImage(asset.localUri ?? asset.uri));
      } catch (error) {
        console.warn(`[Memories] Image unavailable: ${uri}`, error);
        store.failures.set(uri, errorMessage(error));
      }
    }),
  );
}

function waitForVideoReady(player: VideoPlayer) {
  if (player.status === "readyToPlay") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      subscription.remove();
      if (error) reject(error);
      else resolve();
    };
    const subscription = player.addListener("statusChange", (event) => {
      if (event.status === "readyToPlay") finish();
      else if (event.status === "error") finish(new Error(event.error?.message ?? "Video decoder failed"));
    });
    const timeout = setTimeout(() => finish(new Error("Local video preparation timed out")), 15000);
    // replaceAsync can resolve before AVPlayer applies its item on the main queue.
    if (player.status === "readyToPlay") finish();
    else if (player.status === "error") finish(new Error("Video decoder failed"));
  });
}

export async function loadVideoFrames(store: MediaStore, cancelled: () => boolean) {
  const segment = manifest.timeline.find(
    (item) => item.type === "video_clip" && item.url?.startsWith("asset://"),
  );
  if (!segment?.url) throw new Error("Pack has no local video segment");
  const player = createVideoPlayer(null);
  const frames: SkImage[] = [];
  try {
    const asset = await Asset.fromModule(videoModule).downloadAsync();
    await player.replaceAsync(asset.localUri ?? asset.uri);
    await waitForVideoReady(player);
    // Decode in small batches; never keep a full clip of native thumbnails alive.
    const count = Math.ceil(segment.duration * VIDEO_FPS);
    for (let first = 0; first < count && !cancelled(); first += 6) {
      const times = Array.from(
        { length: Math.min(6, count - first) },
        (_, index) => (first + index) / VIDEO_FPS,
      );
      const thumbnails = await player.generateThumbnailsAsync(times, {
        maxWidth: 360,
        maxHeight: 640,
      });
      try {
        if (thumbnails.length !== times.length) {
          throw new Error(`Video decoder returned ${thumbnails.length} of ${times.length} requested frames`);
        }
        for (const thumbnail of thumbnails.sort((a, b) => a.requestedTime - b.requestedTime)) {
          const context = ImageManipulator.manipulate(thumbnail);
          try {
            const rendered = await context.renderAsync();
            try {
              const result = await rendered.saveAsync({ format: SaveFormat.PNG });
              try {
                frames.push(await decodeImage(result.uri));
              } finally {
                new File(result.uri).delete();
              }
            } finally {
              rendered.release();
            }
          } finally {
            context.release();
          }
        }
      } finally {
        thumbnails.forEach((thumbnail) => thumbnail.release());
      }
    }
    if (!cancelled()) {
      store.videoFrames = frames;
    } else {
      frames.forEach((frame) => frame.dispose());
    }
  } catch (error) {
    console.warn("[Memories] Local video unavailable; keeping placeholder", error);
    store.failures.set(segment.url, errorMessage(error));
    frames.forEach((frame) => frame.dispose());
  } finally {
    player.release();
  }
}

export async function checkRemoteMedia(store: MediaStore, signal: AbortSignal) {
  await Promise.all(
    manifest.timeline
      .filter((segment) => segment.url?.startsWith("https://"))
      .map(async (segment) => {
        const uri = segment.url!;
        try {
          const response = await fetch(uri, { method: "HEAD", signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          // This demo pack deliberately has no playable remote clip.
          throw new Error("Remote clip decoding is not supported by this demo");
        } catch (error) {
          console.warn(`[Memories] Using non-blocking fallback: ${uri}`, error);
          store.failures.set(uri, errorMessage(error));
        }
      }),
  );
}

export function disposeMedia(store: MediaStore) {
  store.images.forEach((image) => image.dispose());
  store.videoFrames.forEach((image) => image.dispose());
  store.images.clear();
  store.videoFrames = [];
}
