export interface Settings {
  sensitivity: number;
  dead: number;
  density: number;
  seed: number;
  collisions: boolean;
  minSpeed: number;
  maxSpeed: number;
  near: number;
  far: number;
  quality: string;
  preview: boolean;
  adaptive: boolean;
  diagnostics: boolean;
}
export const defaults: Settings = {
  sensitivity: 1,
  dead: 0.1,
  density: 30,
  seed: 42,
  collisions: true,
  minSpeed: 12,
  maxSpeed: 48,
  near: 0.12,
  far: 0.42,
  quality: "laptop",
  preview: true,
  adaptive: true,
  diagnostics: false,
};
export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem("orbita-settings") || "{}");
    const s = { ...defaults };
    for (const k of Object.keys(defaults) as (keyof Settings)[])
      if (
        typeof raw[k] === typeof defaults[k] &&
        (typeof raw[k] !== "number" || Number.isFinite(raw[k]))
      )
        (s as any)[k] = raw[k];
    s.density = Math.max(8, Math.min(80, s.density));
    s.density = Math.round(s.density);
    s.seed = Math.max(1, Math.min(99999, Math.round(s.seed)));
    s.dead = Math.max(0, Math.min(0.4, s.dead));
    s.sensitivity = Math.max(0.3, Math.min(2, s.sensitivity));
    s.minSpeed = Math.max(5, Math.min(35, s.minSpeed));
    s.maxSpeed = Math.max(s.minSpeed + 1, Math.min(100, s.maxSpeed));
    s.near = Math.max(0.04, Math.min(0.3, s.near));
    s.far = Math.max(s.near + 0.02, Math.min(0.7, s.far));
    return s;
  } catch {
    return { ...defaults };
  }
}
