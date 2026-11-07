import { neutral, clamp, response } from "../../shared/control";
import { Link } from "./link";
export { Link } from "./link";
export function controller(root: HTMLElement) {
  root.innerHTML = `<main class="controller"><a class="brand" href="/">◈ ÓRBITA <span>MANDO REMOTO</span></a><div class="eyebrow">TU TELÉFONO ES EL TIMÓN</div><h1>El vuelo está<br>en tus manos.</h1><p id="remote-state" role="status">Conectando con la sala…</p><div class="tilt"><div id="tilt-ship">✦</div><span id="tilt-values">0° / 0°</span></div><button class="primary" id="sensors">Activar control</button><div class="remote-actions"><button id="zero">Centrar posición</button><button id="remote-turbo">Mantener turbo</button></div><label>Control de velocidad<select id="speed-mode"><option value="slider">Deslizador</option><option value="buttons">Botones mantenidos</option></select></label><label id="slider-wrap">Potencia <input id="throttle" type="range" min="0" max="100" value="45"></label><div id="speed-buttons" class="remote-actions" hidden><button id="brake">Frenar −</button><button id="accelerate">Acelerar +</button></div><p class="muted">Inclina suavemente a los lados para girar. Inclina hacia adelante para bajar. Centra el teléfono en una posición cómoda antes de volar.</p><div class="remote-foot"><span id="remote-room"></span><span id="remote-latency">— ms RTT</span></div></main>`;
  const el = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const state = el("remote-state");
  let permission = false,
    received = false;
  let beta = 0,
    gamma = 0,
    baseBeta = 0,
    baseGamma = 0,
    seq = 0,
    throttle = 0.45,
    accel = 0,
    turbo = false;
  let filtered = neutral();
  let lastSensor = 0;
  let needsCenter = true;
  const link = new Link("remote", (m) => {
    if (m.type === "joined") {
      state.textContent = "Celular conectado ✓ · activa los sensores";
      el("remote-room").textContent = `SALA ${link.room}`;
    }
    if (m.type === "error") state.textContent = m.message;
    if (m.type === "disconnected")
      state.textContent = "Reconectando con el PC…";
    if (m.type === "collision") navigator.vibrate?.(100);
  });
  const orient = (event: DeviceOrientationEvent) => {
    if (event.beta === null || event.gamma === null) return;
    if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
    beta = event.beta;
    gamma = event.gamma;
    received = true;
    lastSensor = performance.now();
    if (needsCenter) {
      baseBeta = beta;
      baseGamma = gamma;
      needsCenter = false;
    }
    state.textContent = link.connected
      ? "Giroscopio activo · listo para volar"
      : "Buscando conexión con el PC…";
  };
  el("sensors").onclick = async () => {
    try {
      if (!isSecureContext)
        throw Error("Abre el enlace con HTTPS para usar los sensores.");
      if (!window.DeviceOrientationEvent)
        throw Error("Este dispositivo no ofrece sensores de orientación.");
      const Sensor = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<string>;
      };
      if (
        Sensor.requestPermission &&
        (await Sensor.requestPermission()) !== "granted"
      )
        throw Error("Permiso de movimiento denegado.");
      permission = true;
      received = false;
      needsCenter = true;
      window.removeEventListener("deviceorientation", orient);
      window.addEventListener("deviceorientation", orient);
      state.textContent =
        "Mueve un poco el teléfono para detectar los sensores…";
      setTimeout(() => {
        if (!received)
          state.textContent =
            "No llegan datos de orientación. Revisa los permisos o usa otro navegador.";
      }, 3500);
    } catch (e) {
      state.textContent = (e as Error).message;
    }
  };
  el("zero").onclick = () => {
    baseBeta = beta;
    baseGamma = gamma;
    filtered = neutral();
    navigator.vibrate?.(30);
  };
  el<HTMLInputElement>("throttle").oninput = (e) => {
    throttle = Number((e.target as HTMLInputElement).value) / 100;
  };
  el<HTMLSelectElement>("speed-mode").onchange = (e) => {
    const buttons = (e.target as HTMLSelectElement).value === "buttons";
    el("slider-wrap").hidden = buttons;
    el("speed-buttons").hidden = !buttons;
    accel = 0;
  };
  function hold(id: string, down: () => void, up: () => void) {
    const button = el(id);
    button.onpointerdown = (e) => {
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      down();
    };
    button.onpointerup = up;
    button.onpointercancel = up;
    button.onlostpointercapture = up;
  }
  hold(
    "accelerate",
    () => (accel = 1),
    () => (accel = 0),
  );
  hold(
    "brake",
    () => (accel = -1),
    () => (accel = 0),
  );
  hold(
    "remote-turbo",
    () => (turbo = true),
    () => (turbo = false),
  );
  // Use screen orientation to rotate beta/gamma axes. Exponential smoothing is frame-rate independent.
  const wrap = (v: number) => ((v + 540) % 360) - 180;
  let previous = performance.now();
  const timer = setInterval(() => {
    const now = performance.now(),
      dt = Math.min((now - previous) / 1000, 0.1);
    previous = now;
    throttle = clamp(throttle + accel * dt * 0.5, 0, 1);
    const angle = ((screen.orientation?.angle ?? 0) * Math.PI) / 180;
    const roll = wrap(gamma - baseGamma),
      pitch = wrap(beta - baseBeta);
    const x = response(
        (roll * Math.cos(angle) + pitch * Math.sin(angle)) / 28,
        0.07,
        1,
      ),
      y = response(
        (pitch * Math.cos(angle) - roll * Math.sin(angle)) / 30,
        0.07,
        1,
      );
    // Smooth hand tremor while allowing deliberate turns to respond quickly.
    const movement = Math.max(
      Math.abs(clamp(x) - filtered.x),
      Math.abs(clamp(y) - filtered.y),
    );
    const alpha = 1 - Math.exp(-dt * (7 + Math.min(1, movement * 3) * 18));
    filtered.x += (clamp(x) - filtered.x) * alpha;
    filtered.y += (clamp(y) - filtered.y) * alpha;
    filtered.throttle = throttle;
    filtered.turbo = turbo;
    el("tilt-ship").style.transform =
      `translate(${filtered.x * 55}px,${-filtered.y * 35}px) rotate(${filtered.x * 30}deg)`;
    el("tilt-values").textContent =
      `${roll.toFixed(0)}° / ${pitch.toFixed(0)}°`;
    el("remote-latency").textContent =
      `${link.peerLatency.toFixed(0)} ms RTT · ${link.transport === "webrtc" ? "Directo" : "Servidor"}`;
    if (permission && received && now - lastSensor < 1200 && link.connected)
      link.send({ type: "control", control: filtered, seq: ++seq });
  }, 33);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      turbo = false;
      accel = 0;
      link.send({
        type: "control",
        control: { ...neutral(), throttle: 0 },
        seq: ++seq,
      });
    }
  });
  window.addEventListener("pagehide", () => {
    clearInterval(timer);
    link.close();
  });
}
