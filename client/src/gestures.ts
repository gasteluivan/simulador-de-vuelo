import { clamp, response, neutral, type Control } from "../../shared/control";
import type { Settings } from "./settings";
export interface Point {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}
export type GestureMode = "A" | "B" | "C";
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
export const forearm = (elbow: Point, wrist: Point) =>
  Math.atan2(Math.abs(wrist.x - elbow.x), elbow.y - wrist.y);
export function neutralPose(p: Point[], mode: GestureMode) {
  if (![11, 12, 13, 14, 15, 16].every((i) => (p[i]?.visibility ?? 0) > 0.6))
    return false;
  if (mode === "B")
    return (
      Math.abs(p[15].y - p[11].y) < 0.12 &&
      Math.abs(p[16].y - p[12].y) < 0.12 &&
      distance(p[15], p[16]) > distance(p[11], p[12]) * 2
    );
  return (
    p[15].y < p[13].y - 0.07 &&
    p[16].y < p[14].y - 0.07 &&
    forearm(p[13], p[15]) < 0.5 &&
    forearm(p[14], p[16]) < 0.5
  );
}
export class GestureMapper {
  baseline: Point[] | null = null;
  handBaseline: Point[] | null = null;
  debug = "";
  calibrate(p: Point[]) {
    this.baseline = p.map((x) => ({ ...x }));
    this.handBaseline = null;
  }
  reset() {
    this.baseline = null;
    this.handBaseline = null;
  }
  map(
    p: Point[],
    mode: GestureMode,
    s: Settings,
    hands: Point[][] = [],
    labels: { categoryName: string }[][] = [],
  ): Control {
    const b = this.baseline;
    if (!b) return neutral();
    const width = distance(p[11], p[12]),
      bw = distance(b[11], b[12]);
    let x = 0,
      y = 0,
      throttle = 0.45,
      turbo = false;
    // Pose indices are anatomical: 16 is the pilot's right wrist. Mirror only the preview.
    if (mode === "A") {
      x =
        (forearm(p[14], p[16]) -
          forearm(b[14], b[16]) -
          (forearm(p[13], p[15]) - forearm(b[13], b[15]))) /
        1.3;
      y =
        (((b[15].y + b[16].y - p[15].y - p[16].y) / 2 +
          (p[11].y + p[12].y - b[11].y - b[12].y) / 2) /
          bw) *
        1.8;
      throttle = clamp(
        0.45 +
          (distance(p[15], p[16]) / width - distance(b[15], b[16]) / bw) * 0.35,
        0,
        1,
      );
    } else if (mode === "B") {
      x = (p[16].y - p[15].y - b[16].y + b[15].y) / width;
      y =
        (p[11].y +
          p[12].y -
          p[15].y -
          p[16].y -
          (b[11].y + b[12].y - b[15].y - b[16].y)) /
        width;
      throttle = clamp(0.45 + (width / bw - 1) * 1.8, 0, 1);
    } else {
      // Handedness is defined for mirrored input in the Hands model: raw webcam labels are swapped.
      const ri = labels.findIndex((l) => l[0]?.categoryName === "Left"),
        li = labels.findIndex((l) => l[0]?.categoryName === "Right");
      const right = hands[ri],
        left = hands[li];
      if (!right || !left) return { ...neutral(), throttle: 0 };
      if (!this.handBaseline)
        this.handBaseline = [{ ...right[9] }, { ...left[9] }];
      const [r, l] = this.handBaseline;
      x = (r.x - right[9].x) * 5;
      y = (r.y - right[9].y) * 5;
      const palm = distance(left[0], left[9]);
      const open =
        [8, 12, 16, 20].filter(
          (i) =>
            distance(left[0], left[i]) > distance(left[0], left[i - 2]) * 1.15,
        ).length >= 3;
      throttle = open ? clamp(0.55 + (l.y - left[9].y) * 3, 0, 1) : 0;
      turbo =
        distance(right[4], right[8]) < distance(right[0], right[9]) * 0.25 &&
        palm > 0;
    }
    this.debug = `Antebrazos I / D: ${((forearm(p[13], p[15]) * 180) / Math.PI).toFixed(0)}° / ${((forearm(p[14], p[16]) * 180) / Math.PI).toFixed(0)}°\nHombros: ${width.toFixed(3)} · Altura: ${y.toFixed(2)}\nLateral: ${x.toFixed(2)} · Potencia: ${(throttle * 100).toFixed(0)}%`;
    return {
      x: clamp(response(x, s.dead, s.sensitivity)),
      y: clamp(response(y, s.dead, s.sensitivity)),
      throttle,
      turbo,
    };
  }
}
