export interface TimedSegment {
  id: string;
  startTime: number;
  duration: number;
  transition: { type: string; duration: number };
}

export const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

export const ease = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

export function validateTimeline(segments: readonly TimedSegment[], duration: number) {
  if (!Number.isFinite(duration) || duration <= 0 || segments.length === 0) {
    throw new Error("Timeline must have segments and a positive duration");
  }
  const ids = new Set<string>();
  let end = 0;
  for (const segment of segments) {
    if (
      ids.has(segment.id) ||
      !Number.isFinite(segment.startTime) ||
      !Number.isFinite(segment.duration) ||
      segment.duration <= 0 ||
      segment.startTime < end ||
      segment.startTime + segment.duration > duration + 0.000001 ||
      !Number.isFinite(segment.transition.duration) ||
      segment.transition.duration < 0 ||
      segment.transition.duration > segment.duration ||
      !["fade", "slide_left", "slide_right"].includes(segment.transition.type)
    ) {
      throw new Error(`Invalid timeline segment: ${segment.id}`);
    }
    ids.add(segment.id);
    end = segment.startTime + segment.duration;
  }
}

export interface TimelineLayer<T extends TimedSegment> {
  segment: T;
  localTime: number;
  opacity: number;
  offsetX: number;
}

export function evaluateTimeline<T extends TimedSegment>(
  segments: readonly T[],
  time: number,
  duration: number,
): TimelineLayer<T>[] {
  if (!Number.isFinite(time)) throw new Error("Playhead must be finite");
  // The exact end retains the last frame instead of becoming an empty interval.
  const t = clamp(time, 0, duration - 0.000001);
  const index = segments.findIndex(
    (segment) => t >= segment.startTime && t < segment.startTime + segment.duration,
  );
  if (index < 0) return [];
  const segment = segments[index];
  const localTime = t - segment.startTime;
  const incoming: TimelineLayer<T> = { segment, localTime, opacity: 1, offsetX: 0 };
  const previous = segments[index - 1];
  const transition = segment.transition;
  if (
    !previous ||
    Math.abs(previous.startTime + previous.duration - segment.startTime) > 0.000001 ||
    transition.duration === 0 ||
    localTime >= transition.duration
  ) {
    return [incoming];
  }
  const progress = ease(localTime / transition.duration);
  const outgoing: TimelineLayer<T> = {
    segment: previous,
    localTime: previous.duration,
    opacity: 1,
    offsetX: 0,
  };
  if (transition.type === "fade") {
    incoming.opacity = progress;
  } else {
    const direction = transition.type === "slide_left" ? 1 : -1;
    incoming.offsetX = direction * (1 - progress);
    outgoing.offsetX = -direction * progress;
  }
  return [outgoing, incoming];
}

export function photoLayers(localTime: number, duration: number, count: number) {
  if (count < 1) throw new Error("Photo cluster must not be empty");
  const interval = duration / count;
  const index = Math.min(count - 1, Math.floor(clamp(localTime, 0, duration) / interval));
  const blend = index === 0 ? 1 : ease((localTime - index * interval) / 0.35);
  return { index, previous: Math.max(0, index - 1), blend };
}

export function frameIndex(localTime: number, fps: number, count: number) {
  if (count < 1 || fps <= 0) throw new Error("Video frame cache must not be empty");
  return Math.floor(clamp(localTime * fps, 0, count - 1));
}

export function formatTime(time: number) {
  const seconds = Math.floor(Math.max(0, time));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
