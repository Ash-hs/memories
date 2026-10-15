import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateTimeline, validateTimeline, photoLayers, frameIndex } from "../src/memories/timeline.ts";

const manifest = JSON.parse(readFileSync(new URL("../assets/candidate-pack/manifest.json", import.meta.url)));
const { timeline, audio } = manifest;

test("pack has 12 contiguous segments and ends at 48 seconds", () => {
  validateTimeline(timeline, audio.duration);
  assert.equal(timeline.length, 12);
  assert.equal(timeline.at(-1).startTime + timeline.at(-1).duration, 48);
});

test("arbitrary seeks compute local animation time without playback history", () => {
  for (const t of [0, 2.87, 7.23, 16.91, 27.13, 31.1, 36.99, 37.51, 46.2, 48]) {
    const first = evaluateTimeline(timeline, t, 48);
    evaluateTimeline(timeline, 11.4, 48);
    assert.deepEqual(evaluateTimeline(timeline, t, 48), first);
    assert.ok(first.length >= 1 && first.length <= 2);
    assert.ok(first.at(-1).localTime >= 0);
  }
});

test("crossfade retains outgoing scene at the exact segment boundary", () => {
  const start = evaluateTimeline(timeline, 7, 48);
  assert.equal(start[0].segment.id, "seg_02_task");
  assert.equal(start[0].localTime, 4);
  assert.equal(start[1].opacity, 0);
  const middle = evaluateTimeline(timeline, 7.2, 48);
  assert.ok(Math.abs(middle[1].opacity - 0.5) < 1e-8);
  assert.equal(evaluateTimeline(timeline, 7.41, 48).length, 1);
});

test("both slide directions are computed at t, not with wall-clock animation", () => {
  const left = evaluateTimeline(timeline, 3.2, 48);
  assert.ok(left[0].offsetX < 0 && left[1].offsetX > 0);
  const right = evaluateTimeline(timeline, 15.7, 48);
  assert.ok(right[0].offsetX > 0 && right[1].offsetX < 0);
});

test("bad media occupies its interval but never blocks the following clip", () => {
  assert.equal(evaluateTimeline(timeline, 34, 48).at(-1).segment.id, "seg_09_video_broken");
  assert.equal(evaluateTimeline(timeline, 38, 48).at(-1).segment.id, "seg_10_video_ok");
  assert.equal(evaluateTimeline(timeline, 48, 48).at(-1).segment.id, "seg_12_outro");
  assert.deepEqual(evaluateTimeline(timeline, 200, 48), evaluateTimeline(timeline, 48, 48));
});

test("photo transitions and video frame indexes are bounded", () => {
  assert.deepEqual(photoLayers(0, 5, 3), { index: 0, previous: 0, blend: 1 });
  assert.equal(photoLayers(5, 5, 3).index, 2);
  assert.equal(photoLayers(1.84, 5, 3).previous, 0);
  assert.equal(frameIndex(-1, 12, 66), 0);
  assert.equal(frameIndex(2.2, 12, 66), 26);
  assert.equal(frameIndex(5.5, 12, 66), 65);
});

test("malformed clocks and timelines fail explicitly", () => {
  assert.throws(() => evaluateTimeline(timeline, NaN, 48), /finite/);
  assert.throws(() => validateTimeline([], 48), /positive duration/);
  assert.throws(() => validateTimeline([{ ...timeline[0], duration: -1 }], 48), /Invalid/);
  assert.throws(() => validateTimeline([{ ...timeline[0], transition: { type: "fade", duration: 4 } }], 48), /Invalid/);
  assert.throws(() => validateTimeline([timeline[0], { ...timeline[1], id: timeline[0].id }], 48), /Invalid/);
});

test("every sample at 30 fps has an active scene, including all transition windows", () => {
  for (let frame = 0; frame <= 48 * 30; frame++) {
    const layers = evaluateTimeline(timeline, frame / 30, 48);
    assert.ok(layers.length > 0, `missing scene at ${frame / 30}`);
    for (const layer of layers) {
      assert.ok(layer.opacity >= 0 && layer.opacity <= 1);
      assert.ok(layer.localTime >= 0 && layer.localTime <= layer.segment.duration);
    }
  }
});
