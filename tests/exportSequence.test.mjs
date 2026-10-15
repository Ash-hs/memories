import { test } from "node:test";
import assert from "node:assert/strict";
import { ExportCancelledError, renderVideoFrames, VIDEO_EXPORT } from "../src/memories/exportSequence.ts";

test("MP4 samples exactly 1440 frames at 30 fps, not the preview playhead", async () => {
  assert.deepEqual(VIDEO_EXPORT, { width: 720, height: 1080, fps: 30, duration: 48 });
  const times = [];
  const indexes = [];
  const progress = [];
  await renderVideoFrames({
    signal: new AbortController().signal,
    render: (time) => times.push(time),
    append: async (index) => { indexes.push(index); return true; },
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.equal(times.length, 1440);
  assert.equal(times[0], 0);
  assert.equal(times.at(-1), 1439 / 30);
  for (let index = 0; index < times.length; index++) {
    assert.equal(times[index], index / 30);
    assert.equal(indexes[index], index);
  }
  assert.deepEqual(progress[0], [0, 1440]);
  assert.deepEqual(progress.at(-1), [1440, 1440]);
});

test("encoder backpressure retries the same frame without rerendering or skipping", async () => {
  const times = [];
  const attempts = [];
  let retried = false;
  await renderVideoFrames({
    signal: new AbortController().signal,
    render: (time) => times.push(time),
    append: async (index) => {
      attempts.push(index);
      if (index === 2 && !retried) { retried = true; return false; }
      return true;
    },
    onProgress: () => {},
  });
  assert.equal(times.length, 1440);
  assert.equal(attempts.length, 1441);
  assert.deepEqual(attempts.slice(0, 5), [0, 1, 2, 2, 3]);
});

test("cancellation stops before rendering and while waiting for encoder readiness", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(renderVideoFrames({
    signal: controller.signal,
    render: () => assert.fail("cancelled export must not render"),
    append: async () => assert.fail("cancelled export must not encode"),
    onProgress: () => {},
  }), ExportCancelledError);

  const waiting = new AbortController();
  let renders = 0;
  let attempts = 0;
  await assert.rejects(renderVideoFrames({
    signal: waiting.signal,
    render: () => renders++,
    append: async () => { attempts++; waiting.abort(); return false; },
    onProgress: () => {},
  }), ExportCancelledError);
  assert.equal(renders, 1);
  assert.equal(attempts, 1);
});

test("render/encode errors are surfaced and never reported as a completed export", async () => {
  let progress = 0;
  await assert.rejects(renderVideoFrames({
    signal: new AbortController().signal,
    render: () => {},
    append: async () => { throw new Error("disk full"); },
    onProgress: (done) => { progress = done; },
  }), /disk full/);
  assert.equal(progress, 0);
});
