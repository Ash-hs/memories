import { matchFont, Skia, type SkCanvas, type SkImage, type SkPicture } from "react-native-skia";
import type { MediaStore } from "./media";
import { VIDEO_FPS } from "./media";
import { manifest, type Segment } from "./pack";
import { clamp, ease, evaluateTimeline, frameIndex, photoLayers } from "./timeline";

export const FRAME = { width: 360, height: 540 };
const C = { paper: "#fff5e6", ink: "#302f2a", muted: "#726b61", orange: "#e9794f", green: "#547560" };

function required<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new Error(`Manifest is missing ${field}`);
  return value;
}

export function drawFrame(canvas: SkCanvas, time: number, media: MediaStore) {
  const paint = Skia.Paint();
  const font = matchFont({ fontFamily: "Helvetica", fontSize: 20 });
  const fill = (color: string, alpha = 1) => {
    paint.setColor(Skia.Color(color));
    paint.setAlphaf(alpha);
    return paint;
  };
  const rect = (x: number, y: number, w: number, h: number, color: string, alpha = 1) =>
    canvas.drawRect(Skia.XYWHRect(x, y, w, h), fill(color, alpha));
  const circle = (x: number, y: number, radius: number, color: string, alpha = 1) =>
    canvas.drawCircle(x, y, radius, fill(color, alpha));
  const text = (value: string, x: number, y: number, size = 20, color = C.ink, centered = false) => {
    font.setSize(size);
    const width = font.measureText(value).width;
    canvas.drawText(value, centered ? x - width / 2 : x, y, fill(color), font);
  };
  const wrapped = (value: string, y: number, size = 22, color = C.ink) => {
    font.setSize(size);
    let line = "";
    let row = 0;
    for (const word of value.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (font.measureText(next).width > 300 && line) {
        text(line, 180, y + row++ * size * 1.4, size, color, true);
        line = word;
      } else line = next;
    }
    if (line) text(line, 180, y + row * size * 1.4, size, color, true);
  };
  const image = (
    source: SkImage | undefined,
    x: number,
    y: number,
    w: number,
    h: number,
    mode: "cover" | "contain" = "contain",
    zoom = 1,
    opacity = 1,
  ) => {
    if (!source) {
      rect(x, y, w, h, "#eadbc7");
      text("Moment unavailable", x + w / 2, y + h / 2, 15, C.muted, true);
      return;
    }
    const sw = source.width();
    const sh = source.height();
    if (mode === "cover") {
      const scale = Math.max(w / sw, h / sh) * zoom;
      const cropW = w / scale;
      const cropH = h / scale;
      canvas.drawImageRect(
        source,
        Skia.XYWHRect((sw - cropW) / 2, (sh - cropH) / 2, cropW, cropH),
        Skia.XYWHRect(x, y, w, h),
        fill("#ffffff", opacity),
      );
    } else {
      const scale = Math.min(w / sw, h / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      canvas.drawImageRect(source, Skia.XYWHRect(0, 0, sw, sh),
        Skia.XYWHRect(x + (w - dw) / 2, y + (h - dh) / 2, dw, dh), fill("#ffffff", opacity));
    }
  };
  const asset = (uri: string | undefined) => media.images.get(required(uri, "image URI"));
  const badge = (label: string, value: string, y = 320) => {
    rect(40, y, 280, 78, "#ffffff", 0.7);
    text(value, 180, y + 35, 27, C.orange, true);
    text(label, 180, y + 59, 12, C.muted, true);
  };
  const scene = (segment: Segment, localTime: number) => {
    const p = segment.payload;
    const enter = ease(localTime / 0.65);
    const progress = clamp(localTime / segment.duration);
    rect(0, 0, FRAME.width, FRAME.height, C.paper);
    circle(326, 42, 122, "#f6d6a9", 0.45);
    circle(15, 508, 90, "#dce6d6", 0.7);
    text("AUGUST / 2026", 28, 39, 12, C.muted);
    rect(28, 53, 304, 1, "#d8c9b6");
    canvas.save();
    canvas.translate(0, (1 - enter) * 16);
    switch (segment.type) {
      case "title_card":
        text("A month worth", 180, 194, 34, C.ink, true);
        text("remembering.", 180, 239, 34, C.orange, true);
        wrapped(required(p.title, "title"), 307, 20);
        wrapped(required(p.subtitle, "subtitle"), 345, 16, C.muted);
        text("12 MOMENTS  /  ONE LITTLE STORY", 180, 442, 11, C.muted, true);
        break;
      case "action_task_complete":
        image(asset(p.iconUri), 126, 100, 108 * (0.85 + enter * 0.15), 108);
        text("Little acts, big wins", 180, 249, 26, C.ink, true);
        wrapped(required(p.taskName, "taskName"), 286, 18, C.muted);
        badge("TASK COMPLETED", `+${p.rewardAmount} ${p.rewardUnit}`, 370);
        break;
      case "action_toggee_upgrade": {
        const scale = 1 + Math.sin(clamp(localTime / 0.8) * Math.PI) * 0.12;
        image(asset(p.imageUri), 180 - 85 * scale, 103, 170 * scale, 170 * scale);
        text(`${p.toggeeName} is growing!`, 180, 317, 27, C.ink, true);
        badge(`LEVEL ${p.oldLevel}  TO  LEVEL ${p.newLevel}`, `+${p.rewardTbux} tbux`, 360);
        break;
      }
      case "action_btc_purchase":
        image(asset(p.iconUri), 132, 103, 96, 96);
        text("Investing in tomorrow", 180, 260, 26, C.ink, true);
        text(`${p.fiatCurrency} ${p.fiatAmount}  /  ${p.btcAcquired} BTC`, 180, 305, 18, C.muted, true);
        rect(40, 352, 280, 12, "#e2d6c5");
        rect(40, 352, 280 * required(p.currentSavingProgress, "currentSavingProgress") / 100 * enter, 12, C.green);
        text(`${p.currentSavingProgress}% of your saving goal`, 180, 395, 16, C.green, true);
        text(`+${p.goldseedEarned} goldseeds earned`, 180, 431, 15, C.muted, true);
        break;
      case "action_friend_connect":
        required(p.friends, "friends").forEach((friend, index) => {
          const reveal = ease((localTime - index * 0.16) / 0.5);
          canvas.saveLayer(fill("#ffffff", reveal));
          image(asset(friend.avatarUri), 30 + index * 104, 145 + (1 - reveal) * 22, 92, 92);
          text(friend.name, 76 + index * 104, 267, 15, C.ink, true);
          canvas.restore();
        });
        text(`${p.newFriendsCount} new connections`, 180, 334, 27, C.ink, true);
        wrapped(required(p.message, "message"), 383, 18, C.muted);
        break;
      case "action_guardian_reward_star":
        text(`+${Math.round(required(p.starsAwarded, "starsAwarded") * enter)}`, 180, 220, 78, C.orange, true);
        text("STARS FROM YOUR FAMILY", 180, 267, 13, C.muted, true);
        wrapped(required(p.starsReason, "starsReason"), 333, 22);
        text(`With love, ${p.sender}`, 180, 439, 16, C.green, true);
        break;
      case "action_guardian_deduct_star":
        canvas.translate(Math.sin(localTime * 22) * (1 - enter) * 5, 0);
        text(`-${p.starsDeducted} star`, 180, 222, 48, C.muted, true);
        wrapped(required(p.deductReason, "deductReason"), 307, 22);
        text("Tomorrow is a fresh start.", 180, 412, 17, C.green, true);
        text(`A reminder from ${p.sender}`, 180, 448, 14, C.muted, true);
        break;
      case "action_photo_cluster": {
        const photos = required(p.photos, "photos");
        const layers = photoLayers(localTime, segment.duration, photos.length);
        image(asset(photos[layers.previous]), 20, 88, 320, 300, "cover", 1 + progress * 0.07);
        image(asset(photos[layers.index]), 20, 88, 320, 300, "cover", 1 + progress * 0.07, layers.blend);
        wrapped(required(p.caption, "caption"), 430, 19);
        break;
      }
      case "video_clip": {
        const uri = required(segment.url, "video URL");
        const isLocal = uri.startsWith("asset://");
        const failed = media.failures.has(uri);
        const frames = media.videoFrames;
        const frame = isLocal && !failed && frames.length
          ? frames[frameIndex(localTime, VIDEO_FPS, frames.length)]
          : asset(p.placeholderUri ?? "asset://images/photo_02.png");
        image(frame, 20, 88, 320, 322, "contain");
        text(isLocal && !failed && frames.length ? "A moment in motion" : "A memory, still here", 180, 451, 23, C.ink, true);
        text(failed ? "Media unavailable / photo fallback" : isLocal && frames.length ? "Original clip / 12 fps preview" : "Preparing media / photo fallback",
          180, 483, 12, C.muted, true);
        break;
      }
      case "action_toggee_interaction_summary": {
        text(`${p.period}, together`, 180, 130, 28, C.ink, true);
        const counts = required(p.counts, "counts");
        Object.entries(counts).forEach(([label, count], index) => {
          const y = 184 + index * 52;
          text(label.toUpperCase(), 30, y + 18, 11, C.muted);
          rect(93, y, 185 * count / 42 * enter, 24, index % 2 ? C.orange : C.green);
          text(String(count), 305, y + 18, 16);
        });
        wrapped(required(p.achievementUnlocked, "achievementUnlocked"), 430, 20);
        break;
      }
      case "outro_card":
        image(asset(p.imageUri), 100, 110, 160, 160);
        text("Keep growing.", 180, 330, 34, C.ink, true);
        text("Keep remembering.", 180, 375, 28, C.orange, true);
        wrapped(required(p.footerText, "footerText"), 439, 16, C.muted);
        break;
      default:
        throw new Error(`Unsupported segment type: ${segment.type}`);
    }
    canvas.restore();
    text(`${String(manifest.timeline.indexOf(segment) + 1).padStart(2, "0")} / 12`, 28, 518, 11, C.muted);
    text("MEMORIES", 270, 518, 11, C.muted);
  };

  try {
    rect(0, 0, FRAME.width, FRAME.height, C.paper);
    for (const layer of evaluateTimeline(manifest.timeline, time, manifest.audio.duration)) {
      canvas.saveLayer(fill("#ffffff", layer.opacity));
      canvas.translate(layer.offsetX * FRAME.width, 0);
      scene(layer.segment, layer.localTime);
      canvas.restore();
    }
  } finally {
    paint.dispose();
    font.dispose();
  }
}

export function pictureAt(time: number, media: MediaStore): SkPicture {
  const recorder = Skia.PictureRecorder();
  try {
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, FRAME.width, FRAME.height));
    drawFrame(canvas, time, media);
    return recorder.finishRecordingAsPicture();
  } finally {
    recorder.dispose();
  }
}
