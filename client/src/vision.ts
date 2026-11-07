import {
  GestureMapper,
  neutralPose,
  distance,
  type Point,
  type GestureMode,
} from "./gestures";
import { neutral, type Control } from "../../shared/control";
import type { Settings } from "./settings";
import { prepareVision } from "./resources";
import { AdaptiveFilter } from "../../shared/motion";
const edges = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [0, 1],
  [0, 4],
  [1, 7],
  [4, 8],
];
const handEdges = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];
export class Vision {
  worker?: Worker;
  stream?: MediaStream;
  mapper = new GestureMapper();
  control: Control = neutral();
  status = "Cámara apagada";
  active = false;
  ready = false;
  preparing = false;
  preparationProgress = 0;
  inferenceMs = 0;
  resultAge = 0;
  captureMs = 0;
  detectionHz = 0;
  delegate = "—";
  private resultTime = 0;
  private lastPoseTime = 0;
  private filters: AdaptiveFilter[] = [];
  busy = false;
  mode: GestureMode = "A";
  lastSeen = 0;
  valid = false;
  progress = 0;
  shoulders = 0;
  private lastFrame = 0;
  private lastVideoTime = -1;
  private hold = 0;
  private pilot: { x: number; y: number; width: number } | null = null;
  private smoothed: Point[] | null = null;
  private generation = 0;
  constructor(
    public video: HTMLVideoElement,
    private canvas: HTMLCanvasElement,
    public settings: Settings,
    private notify: (message: string) => void,
  ) {}
  async start() {
    if (this.active) return;
    const gen = ++this.generation;
    this.active = true;
    this.status = "Cargando...";
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw Error("La cámara requiere HTTPS o localhost.");
      this.status = "Solicitando cámara...";
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
          frameRate: { ideal: 24, max: 30 },
        },
        audio: false,
      });
      if (gen !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      if (gen !== this.generation) return;
      this.preparing = true;
      await prepareVision(this.mode === "C", (text, percent) => {
        if (gen === this.generation) {
          this.status = text;
          this.preparationProgress = percent * 0.85;
        }
      });
      if (gen !== this.generation) return;
      this.worker = new Worker(new URL("./vision.worker.ts", import.meta.url), {
        type: "module",
      });
      this.status = "Cargando detector local...";
      this.worker.onmessage = (e) => {
        if (e.data.type === "ready" || e.data.type === "prepared") {
          if (e.data.mode !== this.mode) {
            void this.prepareMode();
            return;
          }
          this.ready = true;
          this.preparing = false;
          this.preparationProgress = 1;
          this.delegate = e.data.delegate;
          this.status = "Buscando persona...";
        }
        if (e.data.type === "result") {
          this.busy = false;
          this.inferenceMs = e.data.inferenceMs;
          this.resultAge = performance.now() - e.data.time;
          if (this.resultTime)
            this.detectionHz = 1000 / (performance.now() - this.resultTime);
          this.resultTime = performance.now();
          if (this.ready && e.data.mode === this.mode) {
            if (this.resultAge <= 750) this.process(e.data);
            else {
              this.valid = false;
              this.control = neutral();
              this.hold = 0;
              this.progress = 0;
              this.status =
                "Detección lenta: mejora la luz o reduce la carga del equipo";
            }
          }
        }
        if (e.data.type === "error") {
          this.busy = false;
          this.status = `Error del detector: ${e.data.message}`;
          this.notify(this.status);
          this.stop(false);
        }
      };
      this.worker.onerror = () => {
        this.status =
          "No se pudo iniciar el detector. Revisa los modelos locales.";
        this.notify(this.status);
        this.stop(false);
      };
      this.worker.postMessage({
        type: "init",
        hands: this.mode === "C",
        mode: this.mode,
      });
    } catch (error) {
      this.status = `No se pudo abrir la cámara: ${(error as Error).message}`;
      this.notify(this.status);
      this.stop(false);
    }
  }
  stop(clear = true) {
    ++this.generation;
    this.active = false;
    this.ready = false;
    this.preparing = false;
    this.preparationProgress = 0;
    this.busy = false;
    this.worker?.terminate();
    this.worker = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.video.srcObject = null;
    this.valid = false;
    this.control = neutral();
    this.reset();
    if (clear) this.status = "Cámara apagada";
    this.canvas
      .getContext("2d")
      ?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  reset() {
    this.mapper.reset();
    this.pilot = null;
    this.smoothed = null;
    this.hold = 0;
    this.progress = 0;
    this.valid = false;
    this.control = neutral();
    this.lastSeen = 0;
    this.shoulders = 0;
    this.filters = [];
    this.lastPoseTime = 0;
    this.resultTime = 0;
  }
  async changeMode(mode: GestureMode) {
    this.mode = mode;
    this.reset();
    if (this.active && this.worker) await this.prepareMode();
  }
  private async prepareMode() {
    const gen = this.generation,
      mode = this.mode;
    this.ready = false;
    this.preparing = true;
    this.valid = false;
    try {
      await prepareVision(mode === "C", (text, percent) => {
        if (gen === this.generation && mode === this.mode) {
          this.status = text;
          this.preparationProgress = percent * 0.85;
        }
      });
      if (gen !== this.generation || mode !== this.mode) return;
      this.status = "Inicializando detector…";
      this.worker?.postMessage({
        type: "prepare",
        hands: mode === "C",
        mode,
        time: performance.now(),
      });
    } catch (error) {
      if (gen === this.generation) {
        this.status = (error as Error).message;
        this.stop(false);
      }
    }
  }
  setPreview(visible: boolean) {
    if (!visible)
      this.canvas
        .getContext("2d")
        ?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  async tick(now: number) {
    if (this.valid && now - this.lastSeen > 1200) {
      this.valid = false;
      this.control = neutral();
      this.status = "Se interrumpió la señal de cámara";
    }
    if (
      !this.active ||
      !this.ready ||
      this.busy ||
      now - this.lastFrame < 66 ||
      this.video.readyState < 2 ||
      this.video.currentTime === this.lastVideoTime
    )
      return;
    this.busy = true;
    this.lastFrame = now;
    this.lastVideoTime = this.video.currentTime;
    const gen = this.generation;
    try {
      const begin = performance.now();
      const frame = await createImageBitmap(this.video);
      this.captureMs = performance.now() - begin;
      if (gen !== this.generation) {
        frame.close();
        return;
      }
      this.worker?.postMessage(
        {
          type: "frame",
          frame,
          time: now,
          hands: this.mode === "C",
          mode: this.mode,
        },
        [frame],
      );
    } catch {
      this.busy = false;
    }
  }
  private process(data: {
    poses: Point[][];
    hands?: Point[][];
    handedness?: { categoryName: string }[][];
    time: number;
  }) {
    const ctx = this.settings.preview ? this.canvas.getContext("2d")! : null;
    if (ctx) {
      const width = this.video.videoWidth || 640,
        height = this.video.videoHeight || 480;
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      ctx.clearRect(0, 0, width, height);
    }
    let selected: Point[] | undefined;
    // Lock by shoulder center AND scale. If the pilot leaves, don't silently select a bystander.
    if (this.pilot) {
      let best = 0.22;
      for (const p of data.poses) {
        const x = (p[11].x + p[12].x) / 2,
          y = (p[11].y + p[12].y) / 2,
          w = distance(p[11], p[12]);
        const score =
          Math.hypot(x - this.pilot.x, y - this.pilot.y) +
          Math.abs(w / this.pilot.width - 1) * 0.15;
        if (score < best) {
          best = score;
          selected = p;
        }
      }
    } else
      selected = [...data.poses].sort(
        (a, b) =>
          Math.abs((a[11].x + a[12].x) / 2 - 0.5) -
          Math.abs((b[11].x + b[12].x) / 2 - 0.5),
      )[0];
    this.valid = false;
    if (!selected) {
      this.status = this.lastSeen ? "Persona perdida" : "Buscando persona...";
      this.control = neutral();
      this.hold = 0;
      this.progress = 0;
      return;
    }
    const p = selected;
    if (![11, 12, 13, 14, 15, 16].every((i) => (p[i]?.visibility ?? 0) > 0.6)) {
      this.status = "Muestra hombros, codos y muñecas";
      this.control = neutral();
      this.hold = 0;
      this.progress = 0;
      if (ctx) this.draw(ctx, p, edges, "#ffcb78");
      return;
    }
    if (!this.lastSeen)
      this.notify("Persona detectada. Prepara la pose de calibración.");
    this.lastSeen = performance.now();
    this.shoulders = distance(p[11], p[12]);
    if (ctx) {
      this.draw(ctx, p, edges, "#72f5d0");
      data.hands?.forEach((h) => this.draw(ctx, h, handEdges, "#e4ba7a"));
    }
    if (
      this.shoulders < this.settings.near ||
      this.shoulders > this.settings.far
    ) {
      this.status =
        this.shoulders < this.settings.near ? "Acércate" : "Aléjate";
      this.control = neutral();
      this.hold = 0;
      this.progress = 0;
      return;
    }
    if (this.pilot) {
      this.pilot.x = (p[11].x + p[12].x) / 2;
      this.pilot.y = (p[11].y + p[12].y) / 2;
      this.pilot.width = this.shoulders;
    }
    // Low-pass landmarks before computing angular differences; render the raw skeleton for diagnostics.
    if (!this.smoothed) {
      this.smoothed = p.map((v) => ({ ...v }));
      this.filters = Array.from(
        { length: p.length * 3 },
        () => new AdaptiveFilter(2, 2),
      );
    }
    const dt = this.lastPoseTime
      ? Math.max(0.001, (data.time - this.lastPoseTime) / 1000)
      : 1 / 15;
    this.lastPoseTime = data.time;
    for (let i = 0; i < p.length; i++) {
      const v = p[i],
        out = this.smoothed[i];
      out.x = this.filters[i * 3].update(v.x, dt);
      out.y = this.filters[i * 3 + 1].update(v.y, dt);
      out.z = this.filters[i * 3 + 2].update(v.z, dt);
      out.visibility = v.visibility;
    }
    if (!this.mapper.baseline) {
      const poseOk = neutralPose(p, this.mode);
      if (poseOk) {
        if (!this.hold) this.hold = performance.now();
        this.progress = Math.min(1, (performance.now() - this.hold) / 2000);
        if (this.progress === 1) {
          this.mapper.calibrate(this.smoothed);
          this.pilot = {
            x: (p[11].x + p[12].x) / 2,
            y: (p[11].y + p[12].y) / 2,
            width: this.shoulders,
          };
          this.notify("Calibración completa. Listo para volar.");
        }
      } else {
        this.hold = 0;
        this.progress = 0;
      }
      this.status =
        this.mode === "B"
          ? "Extiende los brazos en cruz · mantén 2 s"
          : "Brazos en candelabro · mantén 2 s";
      return;
    }
    if (this.mode === "C" && (data.hands?.length ?? 0) < 2) {
      this.status = "Muestra las dos manos abiertas";
      this.control = neutral();
      return;
    }
    this.valid = true;
    this.status = "Listo: en rango OK";
    this.control = this.mapper.map(
      this.smoothed,
      this.mode,
      this.settings,
      data.hands,
      data.handedness,
    );
  }
  private draw(
    ctx: CanvasRenderingContext2D,
    p: Point[],
    connections: number[][],
    color: string,
  ) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    for (const [a, b] of connections) {
      if (
        !p[a] ||
        !p[b] ||
        (p[a].visibility ?? 1) < 0.5 ||
        (p[b].visibility ?? 1) < 0.5
      )
        continue;
      ctx.beginPath();
      ctx.moveTo(p[a].x * this.canvas.width, p[a].y * this.canvas.height);
      ctx.lineTo(p[b].x * this.canvas.width, p[b].y * this.canvas.height);
      ctx.stroke();
    }
    for (const v of p) {
      if ((v.visibility ?? 1) < 0.5) continue;
      ctx.beginPath();
      ctx.arc(
        v.x * this.canvas.width,
        v.y * this.canvas.height,
        4,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
}
