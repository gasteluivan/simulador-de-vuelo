export interface Control {
  x: number;
  y: number;
  throttle: number;
  turbo: boolean;
}
export const neutral = (): Control => ({
  x: 0,
  y: 0,
  throttle: 0.45,
  turbo: false,
});
export const clamp = (v: number, min = -1, max = 1) =>
  Math.max(min, Math.min(max, v));
export function response(v: number, dead: number, sensitivity: number) {
  const a = Math.abs(v);
  return a < dead
    ? 0
    : Math.sign(v) *
        Math.pow(clamp((a - dead) / (1 - dead), 0, 1), 1.4) *
        sensitivity;
}
export function validControl(v: unknown): v is Control {
  const c = v as Control;
  return (
    !!c &&
    ["x", "y", "throttle"].every(
      (k) =>
        typeof c[k as keyof Control] === "number" &&
        Number.isFinite(c[k as keyof Control]),
    ) &&
    Math.abs(c.x) <= 1 &&
    Math.abs(c.y) <= 1 &&
    c.throttle >= 0 &&
    c.throttle <= 1 &&
    typeof c.turbo === "boolean"
  );
}
