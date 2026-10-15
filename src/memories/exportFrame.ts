import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { ImageFormat, Skia } from "react-native-skia";
import type { MediaStore } from "./media";
import { drawFrame, FRAME } from "./render";

export async function exportFrame(time: number, media: MediaStore) {
  const surface = Skia.Surface.MakeOffscreen(FRAME.width * 2, FRAME.height * 2);
  if (!surface) throw new Error("Unable to allocate an offscreen Skia surface");
  try {
    const canvas = surface.getCanvas();
    canvas.scale(2, 2);
    drawFrame(canvas, time, media);
    surface.flush();
    const image = surface.makeImageSnapshot();
    try {
      const bytes = image.encodeToBytes(ImageFormat.PNG);
      if (!bytes.length) throw new Error("Skia could not encode the frame");
      const file = new File(Paths.document, `memories-frame-${time.toFixed(3)}.png`);
      file.write(bytes);
      return file.uri;
    } finally {
      image.dispose();
    }
  } finally {
    surface.dispose();
  }
}

export async function shareFrame(uri: string) {
  if (!await Sharing.isAvailableAsync()) {
    throw new Error(`Sharing is unavailable. The frame is saved at: ${uri}`);
  }
  await Sharing.shareAsync(uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: "分享回顾画面" });
}
