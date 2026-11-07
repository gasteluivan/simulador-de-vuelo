interface XYZ {
  x: number;
  y: number;
  z: number;
}
interface Bounds {
  min: XYZ;
  max: XYZ;
}
const AXES = ["x", "y", "z"] as const;
/** Sweep the center segment against an AABB expanded by the ship radius.
 * Conservative at box corners, but catches thin obstacles crossed between frames.
 * Slab intersection needs no temporary vectors or meshes. Returns earliest t in [0,1].
 */
export function sweptHit(
  from: XYZ,
  to: XYZ,
  box: Bounds,
  radius: number,
): number | null {
  let enter = 0,
    exit = 1;
  for (const axis of AXES) {
    const start = from[axis],
      delta = to[axis] - start,
      min = box.min[axis] - radius,
      max = box.max[axis] + radius;
    if (Math.abs(delta) < 1e-9) {
      if (start < min || start > max) return null;
      continue;
    }
    let a = (min - start) / delta,
      b = (max - start) / delta;
    if (a > b) {
      const temp = a;
      a = b;
      b = temp;
    }
    enter = Math.max(enter, a);
    exit = Math.min(exit, b);
    if (enter > exit) return null;
  }
  return enter;
}
