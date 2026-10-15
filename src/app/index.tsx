import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  useWindowDimensions, type GestureResponderEvent,
} from "react-native";
import { Canvas, Group, Picture } from "react-native-skia";
import { SafeAreaView } from "react-native-safe-area-context";
import { exportFrame, shareFrame } from "../memories/exportFrame";
import { ExportCancelledError } from "../memories/exportSequence";
import { exportVideo, shareVideo, type ExportProgress } from "../memories/exportVideo";
import { manifest, segmentLabels } from "../memories/pack";
import { FRAME, pictureAt } from "../memories/render";
import { clamp, evaluateTimeline, formatTime } from "../memories/timeline";
import { useMemories } from "../memories/useMemories";

export default function Index() {
  const memories = useMemories();
  const { width, height } = useWindowDimensions();
  const [trackWidth, setTrackWidth] = useState(1);
  const [exporting, setExporting] = useState<"png" | "mp4" | null>(null);
  const [exported, setExported] = useState<number | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [videoMessage, setVideoMessage] = useState<string | null>(null);
  const exportBusy = useRef(false);
  const exportController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") exportController.current?.abort();
    });
    return () => {
      mounted.current = false;
      exportController.current?.abort();
      subscription.remove();
    };
  }, []);
  const previewWidth = Math.min(width - 48, 360, Math.max(220, (height - 380) / 1.5));
  const previewHeight = previewWidth * 1.5;
  const picture = useMemo(
    () => memories.media ? pictureAt(memories.time, memories.media) : null,
    // The media store updates in place after asynchronous decoding completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memories.time, memories.media, memories.mediaVersion],
  );
  useEffect(() => () => { picture?.dispose(); }, [picture]);

  const layers = evaluateTimeline(manifest.timeline, memories.time, manifest.audio.duration);
  const current = layers[layers.length - 1]?.segment;
  const failedCount = memories.media?.failures.size ?? 0;
  const scrub = (event: GestureResponderEvent) => {
    memories.scrubTo(clamp(event.nativeEvent.locationX / trackWidth) * manifest.audio.duration);
  };
  const handleExport = async () => {
    if (!memories.media || exportBusy.current) return;
    exportBusy.current = true;
    memories.pause();
    setExporting("png");
    const time = memories.time;
    try {
      const uri = await exportFrame(time, memories.media);
      setExported(time);
      await shareFrame(uri);
    } catch (error) {
      memories.report(error);
      Alert.alert("导出 / 分享失败", error instanceof Error ? error.message : String(error));
    } finally {
      exportBusy.current = false;
      if (mounted.current) setExporting(null);
    }
  };
  const handleVideoExport = async () => {
    if (!memories.media || exportBusy.current) return;
    exportBusy.current = true;
    const controller = new AbortController();
    exportController.current = controller;
    memories.pause();
    setExporting("mp4");
    setProgress(null);
    setVideoMessage(null);
    try {
      const uri = await exportVideo(memories.media, controller.signal, (value) => {
        if (mounted.current) setProgress(value);
      });
      exportController.current = null;
      if (!mounted.current) return;
      setVideoMessage("MP4 已保存到应用 Documents，可再次导出并分享。");
      setProgress({ stage: "sharing", completed: 1440, total: 1440 });
      await shareVideo(uri);
    } catch (error) {
      if (error instanceof ExportCancelledError) {
        if (mounted.current) setVideoMessage("视频导出已取消，临时文件已清理。");
      } else {
        memories.report(error);
        if (mounted.current) Alert.alert("视频导出 / 分享失败", error instanceof Error ? error.message : String(error));
      }
    } finally {
      exportController.current = null;
      exportBusy.current = false;
      if (mounted.current) {
        setExporting(null);
        setProgress(null);
      }
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>THE LITTLE THINGS</Text>
            <Text style={styles.heading}>回顾 · 八月</Text>
          </View>
          <View style={styles.tag}><Text style={styles.tagText}>48 秒 / 12 个瞬间</Text></View>
        </View>
        <View style={styles.previewContainer}>
          <View style={[styles.preview, { width: previewWidth, height: previewHeight }]}>
            {picture ? (
              <Canvas style={{ width: previewWidth, height: previewHeight }}>
                <Group transform={[{ scale: previewWidth / FRAME.width }]}>
                  <Picture picture={picture} />
                </Group>
              </Canvas>
            ) : (
              <View style={styles.loading}>
                <ActivityIndicator color="#547560" />
                <Text style={styles.note}>正在准备原始素材…</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.captionRow}>
          <Text style={styles.segmentTitle}>{current ? segmentLabels[current.type] : "回顾短片"}</Text>
          <Text style={styles.time}>{formatTime(memories.time)} / 0:48</Text>
        </View>
        <View
          testID="timeline-scrubber"
          accessible
          accessibilityLabel="短片播放进度"
          accessibilityRole="adjustable"
          accessibilityValue={{ min: 0, max: 48, now: Math.round(memories.time), text: `${memories.time.toFixed(1)} 秒` }}
          accessibilityActions={[{ name: "increment", label: "前进一秒" }, { name: "decrement", label: "后退一秒" }]}
          onAccessibilityAction={(event) => {
            if (memories.ready && !memories.seeking && !exporting) memories.seek(memories.time + (event.nativeEvent.actionName === "increment" ? 1 : -1));
          }}
          style={styles.scrubber}
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => memories.ready && !memories.seeking && !exporting}
          onMoveShouldSetResponder={() => memories.ready && !memories.seeking && !exporting}
          onResponderGrant={(event) => { memories.beginScrub(); scrub(event); }}
          onResponderMove={scrub}
          onResponderRelease={(event) => { scrub(event); memories.endScrub(); }}
          onResponderTerminate={() => memories.endScrub()}
          onResponderTerminationRequest={() => false}
        >
          <View pointerEvents="none" style={styles.rail}>
            <View style={[styles.progress, { width: `${memories.time / 48 * 100}%` }]} />
            {manifest.timeline.slice(1).map((segment) => (
              <View key={segment.id} style={[styles.tick, { left: `${segment.startTime / 48 * 100}%` }]} />
            ))}
            <View style={[styles.thumb, { left: `${memories.time / 48 * 100}%` }]} />
          </View>
        </View>

        <View style={styles.controls}>
          <Pressable accessibilityRole="button" accessibilityLabel="回到开头" disabled={!memories.ready || memories.seeking || !!exporting}
            onPress={() => memories.seek(0)} style={styles.secondary}>
            <Text style={styles.secondaryText}>重播</Text>
          </Pressable>
          <Pressable testID="play-button" accessibilityRole="button" accessibilityLabel={memories.status.playing ? "暂停" : "播放"}
            disabled={!memories.ready || memories.seeking || !!exporting} onPress={() => void memories.toggle()}
            style={[styles.play, (!memories.ready || memories.seeking || exporting) && styles.disabled]}>
            <Text style={styles.playText}>{memories.seeking ? "对齐中…" : !memories.ready ? "准备音轨…" : memories.status.playing ? "暂停" : memories.time >= 48 ? "再看一次" : "播放回顾"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!memories.ready || memories.seeking || !!exporting}
            onPress={handleExport} style={styles.secondary}>
            <Text style={styles.secondaryText}>{exporting === "png" ? "导出中" : "分享帧"}</Text>
          </Pressable>
        </View>
        <View style={styles.videoExport}>
          <Pressable testID="export-mp4-button" accessibilityRole="button"
            disabled={!memories.ready || memories.preparingVideo || memories.seeking || !!exporting || Platform.OS !== "ios"}
            onPress={handleVideoExport}
            style={[styles.play, (!memories.ready || memories.preparingVideo || memories.seeking || !!exporting || Platform.OS !== "ios") && styles.disabled]}>
            <Text style={styles.playText}>{exporting === "mp4"
              ? progress?.stage === "sharing" ? "已保存，分享中…" : progress?.stage === "audio" ? "正在合成背景音乐…" : `正在导出 ${Math.floor((progress?.completed ?? 0) / (progress?.total ?? 1440) * 100)}%`
              : "导出完整 MP4"}</Text>
          </Pressable>
          {exporting === "mp4" && progress?.stage !== "sharing" && (
            <Pressable accessibilityRole="button" accessibilityLabel="取消视频导出"
              onPress={() => exportController.current?.abort()} style={styles.secondary}>
              <Text style={styles.secondaryText}>取消</Text>
            </Pressable>
          )}
        </View>
        <Text accessibilityLiveRegion="polite" style={styles.note}>
          {videoMessage ?? (Platform.OS !== "ios" ? "MP4 导出暂仅支持 iOS；仍可分享 PNG。" : exporting === "mp4"
            ? "正在本地离线编码，请保持应用在前台；离开应用将取消导出。"
            : memories.preparingVideo ? "视频素材准备完成后可导出完整 MP4。" : "720×1080 · 30 fps · 48 秒 · 含背景音乐")}
        </Text>
        <View style={styles.statusBox}>
          <View style={styles.statusRow}>
            <View style={styles.dot} />
            <Text style={styles.statusText}>音频主时钟 · Skia 实时合成</Text>
            <Text style={styles.precision}>{memories.time.toFixed(2)} s</Text>
          </View>
          <Text style={styles.note}>
            {memories.status.isBuffering ? "音频缓冲中，画面跟随音轨等待。" : memories.preparingVideo ? "原始视频帧准备中；其他段可正常播放。" : "拖动可停在任意时刻，转场和运镜跟随时间重算。"}
          </Text>
          <Text style={[styles.note, failedCount > 0 && styles.warning]}>
            {failedCount > 0 ? `${failedCount} 个素材失败，使用占位继续播放；时间轴和音轨不阻塞。` : "正在检测坏链段；检测过程不阻塞主时钟。"}
          </Text>
          {memories.error && <Text accessibilityRole="alert" style={styles.error}>{memories.error}</Text>}
        </View>
        <Text style={styles.sectionTitle}>瞬间时间轴</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chapters}>
          {manifest.timeline.map((segment, index) => (
            <Pressable key={segment.id} accessibilityRole="button"
              accessibilityLabel={`跳到${segmentLabels[segment.type]}，${segment.startTime}秒`}
              disabled={!memories.ready || memories.seeking || !!exporting}
              onPress={() => memories.seek(segment.startTime + Math.min(0.7, segment.duration / 2))}
              style={[styles.chapter, current?.id === segment.id && styles.activeChapter]}>
              <Text style={styles.chapterNumber}>{String(index + 1).padStart(2, "0")} / {formatTime(segment.startTime)}</Text>
              <Text style={styles.chapterText}>{segment.id.includes("broken") ? "坏链演示" : segmentLabels[segment.type]}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable accessibilityRole="button" style={styles.exportNote} onPress={() => Alert.alert(
          "关于导出",
          "分享帧：保存当前时刻的 720×1080 PNG。\n\n完整 MP4：iOS 使用同一 Skia 渲染器按 t = n/30 离屏生成 1440 帧，本地编码 H.264 并合入裁切至 48 秒的背景音乐，再打开系统分享。保留坏链照片占位与预览的 12 fps 原视频帧；不含额外音效，也不使用服务端。\n\n新增原生模块后需要重新构建开发客户端。导出期间请保持前台，可随时取消。",
        )}>
          <Text style={styles.note}>{exported !== null ? `已保存 ${exported.toFixed(2)} 秒 PNG 画面。` : "原始瞬间，不做 AI 改图。"} 查看 PNG / MP4 导出说明 →</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f6f3ed" },
  page: { paddingHorizontal: 24, paddingTop: 14, paddingBottom: 24, gap: 10 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  eyebrow: { fontSize: 9, letterSpacing: 2, color: "#827968", marginBottom: 5 },
  heading: { fontSize: 27, fontWeight: "600", color: "#302f2a" },
  tag: { backgroundColor: "#e7ebdf", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  tagText: { fontSize: 11, color: "#547560" },
  previewContainer: { alignItems: "center" },
  preview: { backgroundColor: "#fff5e6", borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#e2d7c7" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  captionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 5 },
  segmentTitle: { fontSize: 15, fontWeight: "500", color: "#302f2a" },
  time: { fontSize: 12, color: "#726b61", fontVariant: ["tabular-nums"] },
  scrubber: { height: 40, justifyContent: "center" },
  rail: { height: 5, backgroundColor: "#dfdacd", borderRadius: 4 },
  progress: { height: 5, borderRadius: 4, backgroundColor: "#547560" },
  tick: { position: "absolute", top: 0, width: 1, height: 5, backgroundColor: "#f6f3ed" },
  thumb: { position: "absolute", top: -6, marginLeft: -8, width: 17, height: 17, borderRadius: 9, backgroundColor: "#547560", borderWidth: 3, borderColor: "#f6f3ed" },
  controls: { flexDirection: "row", gap: 12, alignItems: "center", marginBottom: 5 },
  videoExport: { flexDirection: "row", gap: 12, alignItems: "center" },
  play: { flex: 1, alignItems: "center", padding: 14, borderRadius: 25, backgroundColor: "#547560" },
  playText: { color: "#ffffff", fontWeight: "600", fontSize: 15 },
  disabled: { opacity: 0.45 },
  secondary: { paddingVertical: 14, paddingHorizontal: 9 },
  secondaryText: { color: "#547560", fontSize: 14 },
  statusBox: { backgroundColor: "#eeebe3", padding: 12, borderRadius: 12, gap: 5 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#547560" },
  statusText: { flex: 1, color: "#547560", fontSize: 11, fontWeight: "500" },
  precision: { fontSize: 11, color: "#726b61", fontVariant: ["tabular-nums"] },
  note: { fontSize: 11, lineHeight: 17, color: "#827968" },
  warning: { color: "#a16739" },
  error: { color: "#a23f37", fontSize: 12, lineHeight: 18 },
  sectionTitle: { fontSize: 12, color: "#726b61", marginTop: 4 },
  chapters: { gap: 8 },
  chapter: { borderWidth: 1, borderColor: "#e0dbcf", borderRadius: 10, padding: 10, minWidth: 88, gap: 4 },
  activeChapter: { borderColor: "#547560", backgroundColor: "#e7ebdf" },
  chapterNumber: { fontSize: 9, color: "#827968" },
  chapterText: { fontSize: 12, color: "#302f2a" },
  exportNote: { paddingTop: 2 },
});
