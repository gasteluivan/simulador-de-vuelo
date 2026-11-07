import { test } from "node:test";
import assert from "node:assert/strict";
import { response, validControl, neutral } from "../shared/control";
import { GestureMapper, neutralPose, type Point } from "../client/src/gestures";
import { defaults } from "../client/src/settings";
function pose() {
  const p: Point[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.6,
    z: 0,
    visibility: 1,
  }));
  p[11] = { x: 0.65, y: 0.5, z: 0, visibility: 1 };
  p[12] = { x: 0.35, y: 0.5, z: 0, visibility: 1 };
  p[13] = { x: 0.8, y: 0.5, z: 0, visibility: 1 };
  p[14] = { x: 0.2, y: 0.5, z: 0, visibility: 1 };
  p[15] = { x: 0.8, y: 0.25, z: 0, visibility: 1 };
  p[16] = { x: 0.2, y: 0.25, z: 0, visibility: 1 };
  return p;
}
test("dead zone removes jitter and preserves direction", () => {
  assert.equal(response(0.05, 0.1, 1), 0);
  assert.ok(response(0.7, 0.1, 1) > 0);
  assert.ok(response(-0.7, 0.1, 1) < 0);
});
test("reject malformed remote controls", () => {
  assert.ok(validControl(neutral()));
  assert.equal(validControl({ ...neutral(), x: Infinity }), false);
  assert.equal(validControl({ ...neutral(), throttle: 2 }), false);
  assert.equal(validControl(null), false);
});
test("right anatomical arm gives positive steering; left gives negative", () => {
  const mapper = new GestureMapper(),
    p = pose();
  assert.ok(neutralPose(p, "A"));
  mapper.calibrate(p);
  const right = pose();
  right[16] = { ...right[16], x: 0, y: 0.5 };
  assert.ok(mapper.map(right, "A", defaults).x > 0);
  const left = pose();
  left[15] = { ...left[15], x: 1, y: 0.5 };
  assert.ok(mapper.map(left, "A", defaults).x < 0);
  assert.equal(mapper.map(p, "A", defaults).x, 0);
});
test("both wrists up raises ship; down lowers ship", () => {
  const mapper = new GestureMapper(),
    p = pose();
  mapper.calibrate(p);
  const up = pose();
  up[15].y -= 0.15;
  up[16].y -= 0.15;
  assert.ok(mapper.map(up, "A", defaults).y > 0);
  const down = pose();
  down[15].y += 0.15;
  down[16].y += 0.15;
  assert.ok(mapper.map(down, "A", defaults).y < 0);
});
