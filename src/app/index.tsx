import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View,
  useWindowDimensions, type GestureResponderEvent,
} from "react-native";
import { Canvas, Group, Picture } from "react-native-skia";
import { SafeAreaView } from "react-native-safe-area-context";
import { exportFrame, shareFrame } from "../memories/exportFrame";
import { manifest, segmentLabels } from "../memories/pack";
import { FRAME, pictureAt } from "../memories/render";
import { clamp, evaluateTimeline, formatTime } from "../memories/timeline";
import { useMemories } from "../memories/useMemories";

export default function Index() {
  const memories = useMemories();
  const { width, height } = useWindowDimensions();
  const [trackWidth, setTrackWidth] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<number | null>(null);
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
    if (!memories.media) return;
    memories.pause();
    setExporting(true);
    const time = memories.time;
    try {
      const uri = await exportFrame(time, memories.media);
      setExported(time);
      await shareFrame(uri);
    } catch (error) {
      memories.report(error);
      Alert.alert("导出 / 分享失败", error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
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
          onAccessibilityAction={(event) => memories.seek(memories.time + (event.nativeEvent.actionName === "increment" ? 1 : -1))}
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
          <Pressable accessibilityRole="button" accessibilityLabel="回到开头" disabled={!memories.ready || memories.seeking || exporting}
            onPress={() => memories.seek(0)} style={styles.secondary}>
            <Text style={styles.secondaryText}>重播</Text>
          </Pressable>
          <Pressable testID="play-button" accessibilityRole="button" accessibilityLabel={memories.status.playing ? "暂停" : "播放"}
            disabled={!memories.ready || memories.seeking || exporting} onPress={() => void memories.toggle()}
            style={[styles.play, (!memories.ready || memories.seeking || exporting) && styles.disabled]}>
            <Text style={styles.playText}>{memories.seeking ? "对齐中…" : !memories.ready ? "准备音轨…" : memories.status.playing ? "暂停" : memories.time >= 48 ? "再看一次" : "播放回顾"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!memories.ready || memories.seeking || exporting}
            onPress={handleExport} style={styles.secondary}>
            <Text style={styles.secondaryText}>{exporting ? "导出中" : "分享帧"}</Text>
          </Pressable>
        </View>
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
              disabled={!memories.ready || memories.seeking || exporting}
              onPress={() => memories.seek(segment.startTime + Math.min(0.7, segment.duration / 2))}
              style={[styles.chapter, current?.id === segment.id && styles.activeChapter]}>
              <Text style={styles.chapterNumber}>{String(index + 1).padStart(2, "0")} / {formatTime(segment.startTime)}</Text>
              <Text style={styles.chapterText}>{segment.id.includes("broken") ? "坏链演示" : segmentLabels[segment.type]}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable accessibilityRole="button" style={styles.exportNote} onPress={() => Alert.alert(
          "关于导出",
          "当前可将任意时刻用同一 Skia 渲染器离屏导出为 720×1080 PNG 并分享；不是 MP4。\n\n完整 MP4 路径：按 t = n/fps 取帧 → iOS AVAssetWriter 编码 H.264 → 裁切并混合音轨 → 系统分享。此 demo 未实现视频编码，也不使用服务端渲染。详细取舍见 README。",
        )}>
          <Text style={styles.note}>{exported !== null ? `已保存 ${exported.toFixed(2)} 秒画面。` : "原始瞬间，不做 AI 改图。"} 当前导出为 PNG，非 MP4。查看取舍 →</Text>
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
