import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { audioModule, manifest } from "./pack";
import { checkRemoteMedia, disposeMedia, errorMessage, loadImages, loadVideoFrames, type MediaStore } from "./media";
import { clamp } from "./timeline";

export function useMemories() {
  const player = useAudioPlayer(audioModule, { updateInterval: 50 });
  const status = useAudioPlayerStatus(player);
  const [media, setMedia] = useState<MediaStore | null>(null);
  const [mediaVersion, setMediaVersion] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [time, setTime] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [preparingVideo, setPreparingVideo] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrubbing = useRef(false);
  const resumeAfterSeek = useRef(false);
  const draftTime = useRef(0);
  const mounted = useRef(true);
  const seekQueue = useRef<Promise<void>>(Promise.resolve());
  const seekGeneration = useRef(0);

  const report = useCallback((cause: unknown) => {
    console.error("[Memories]", cause);
    if (mounted.current) setError(errorMessage(cause));
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const store: MediaStore = { images: new Map(), videoFrames: [], failures: new Map() };
    const controller = new AbortController();
    // This timeout only bounds network I/O. It never advances the story.
    const timeout = setTimeout(() => controller.abort(), 4000);
    const images = loadImages(store).then(() => {
      if (!cancelled) setMedia(store);
    });
    const video = loadVideoFrames(store, () => cancelled).then(() => {
      if (!cancelled) {
        setPreparingVideo(false);
        setMediaVersion((value) => value + 1);
      }
    });
    const remote = checkRemoteMedia(store, controller.signal).then(() => {
      if (!cancelled) setMediaVersion((value) => value + 1);
    });
    const work = Promise.all([images, video, remote]).catch(report);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
      // In-flight native decodes must finish before their image handles are released.
      void work.then(() => disposeMedia(store));
    };
  }, [report]);

  useEffect(() => {
    let cancelled = false;
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: "doNotMix",
    }).then(() => {
      if (!cancelled) setAudioReady(true);
    }).catch(report);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        resumeAfterSeek.current = false;
        player.pause();
      }
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [player, report]);

  useEffect(() => {
    if (status.error) report(new Error(`Background audio: ${status.error}`));
  }, [status.error, report]);

  useEffect(() => {
    let animation: number;
    let lastFrame = -1;
    const tick = () => {
      if (!scrubbing.current && player.isLoaded) {
        // Read the native audio playhead, not RAF timestamps or accumulated deltas.
        const position = clamp(player.currentTime, 0, manifest.audio.duration);
        const frame = Math.floor(position * 30);
        if (frame !== lastFrame) {
          lastFrame = frame;
          setTime(position);
        }
        if (position >= manifest.audio.duration && player.playing) player.pause();
      }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [player]);

  const beginScrub = useCallback(() => {
    seekGeneration.current += 1;
    if (!scrubbing.current) resumeAfterSeek.current = player.playing;
    scrubbing.current = true;
    draftTime.current = clamp(player.currentTime, 0, manifest.audio.duration);
    player.pause();
  }, [player]);

  const scrubTo = useCallback((position: number) => {
    draftTime.current = clamp(position, 0, manifest.audio.duration);
    setTime(draftTime.current);
  }, []);

  const endScrub = useCallback(() => {
    const target = draftTime.current;
    const generation = ++seekGeneration.current;
    setSeeking(true);
    seekQueue.current = seekQueue.current.then(async () => {
      if (!mounted.current) return;
      try {
        // Zero iOS tolerances; do not resume until native seek acknowledges completion.
        await player.seekTo(target, 0, 0);
        if (!mounted.current || generation !== seekGeneration.current) return;
        setTime(clamp(player.currentTime, 0, manifest.audio.duration));
        if (resumeAfterSeek.current && target < manifest.audio.duration) player.play();
      } catch (cause) {
        report(cause);
      } finally {
        if (mounted.current && generation === seekGeneration.current) {
          scrubbing.current = false;
          setSeeking(false);
        }
      }
    });
  }, [player, report]);

  const seek = useCallback((position: number) => {
    beginScrub();
    scrubTo(position);
    endScrub();
  }, [beginScrub, scrubTo, endScrub]);

  const toggle = useCallback(async () => {
    try {
      if (player.playing) player.pause();
      else {
        if (player.currentTime >= manifest.audio.duration) await player.seekTo(0, 0, 0);
        player.play();
      }
    } catch (cause) { report(cause); }
  }, [player, report]);

  return {
    media, mediaVersion, time, status, seeking, preparingVideo, error,
    ready: audioReady && status.isLoaded && media !== null,
    beginScrub, scrubTo, endScrub, seek, toggle, report,
    pause: () => player.pause(),
  };
}
