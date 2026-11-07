import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameMetrics, ResolutionGovernor } from "../client/src/performance";
import { AdaptiveFilter } from "../shared/motion";
import { sweptHit } from "../client/src/collision";
test("raw metrics report 10 FPS without physics clamp and expose tail latency", () => {
  const metrics = new FrameMetrics();
  for (let i = 0; i < 60; i++) metrics.add(100);
  assert.equal(metrics.snapshot().fps, 10);
  assert.equal(metrics.snapshot().p95, 100);
  assert.equal(metrics.snapshot().slow, 60);
  for (let i = 0; i < 240; i++) metrics.add(10);
  assert.equal(metrics.snapshot().fps, 100);
  assert.equal(metrics.snapshot().slow, 0);
  metrics.reset();
  assert.equal(metrics.snapshot().count, 0);
});
test("adaptive resolution responds to sustained load, not a single stall, then recovers", () => {
  const governor = new ResolutionGovernor();
  for (let i = 0; i < 180; i++) governor.update(16.67);
  governor.update(150);
  assert.equal(governor.scale, 1);
  for (let i = 0; i < 500; i++) governor.update(33.34);
  assert.equal(governor.scale, 0.6);
  for (let i = 0; i < 7000; i++) governor.update(16);
  assert.equal(governor.scale, 1);
});
test("adaptive motion suppresses stationary jitter and responds quickly without overshoot", () => {
  const filter = new AdaptiveFilter();
  filter.reset(0);
  let jitter = 0;
  for (let i = 0; i < 120; i++)
    jitter = Math.max(
      jitter,
      Math.abs(filter.update(i % 2 ? 0.02 : -0.02, 1 / 60)),
    );
  assert.ok(jitter < 0.01);
  let value = 0;
  for (let i = 0; i < 6; i++) {
    value = filter.update(1, 1 / 60);
    assert.ok(value >= 0 && value <= 1);
  }
  assert.ok(value > 0.85);
});
test("swept collision catches thin cube crossed between frames and rejects near miss", () => {
  const box = { min: { x: -1, y: -1, z: -5.1 }, max: { x: 1, y: 1, z: -4.9 } };
  assert.notEqual(
    sweptHit({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -10 }, box, 0.8),
    null,
  );
  assert.equal(
    sweptHit({ x: 3, y: 0, z: 0 }, { x: 3, y: 0, z: -10 }, box, 0.8),
    null,
  );
  assert.equal(
    sweptHit({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: -5 }, box, 0.8),
    0,
  );
});
