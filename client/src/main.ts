import "./style.css";
import QRCode from "qrcode";
import { FlightScene } from "./scene";
import { Vision } from "./vision";
import { Link, controller } from "./remote";
import { loadSettings, type Settings } from "./settings";
import { neutral, clamp, type Control } from "../../shared/control";
import { FrameMetrics } from "./performance";
import { installOffline } from "./resources";
const root = document.getElementById("app")!;
if (location.pathname === "/controller") controller(root);
else boot();
function boot() {
  void installOffline();
  const settings = loadSettings();
  const metrics = new FrameMetrics();
  let rawFrameMs = 0,
    submitMs = 0,
    geometryChanged = false;
  let mode = "demo",
    running = false,
    invalidSince = 0,
    last = performance.now(),
    lastHUD = 0,
    turboUntil = 0,
    turboReady = 0;
  let link: Link | undefined;
  let connectedOrigin = location.origin;
  const keys = new Set<string>();
  root.innerHTML = `<div id="world" aria-label="Escenario de vuelo 3D"></div><div class="vignette"></div><div id="impact"></div><header><a class="brand" href="/">◈ ÓRBITA <span>LABORATORIO DE VUELO</span></a><div class="header-right"><span class="live-dot"></span><span>SIMULADOR / 01</span><button id="settings-button" aria-label="Abrir ajustes">⚙ <span>Ajustes</span></button></div></header><main><section class="intro" id="intro"><div class="eyebrow">EXPLORA CON TU MOVIMIENTO</div><h1>Tu cuerpo.<br>Tu nave.<br><em>Tu universo.</em></h1><p>Deja atrás los mandos. Abre los brazos<br>y encuentra una nueva forma de volar.</p><div class="intro-footer"><span>01 / ELIGE CÓMO PILOTAR</span><span>↓</span></div></section><aside class="control-panel panel"><div class="panel-heading"><span class="eyebrow">CENTRO DE CONTROL</span><span class="badge">PROTOTIPO 0.1</span></div><h2>Prepara el despegue.</h2><p class="muted">Elige tu conexión con la nave.</p><div class="tabs" role="group" aria-label="Método de control"><button data-mode="camera" class="selected">◉ Cámara</button><button data-mode="phone">▯ Celular</button><button data-mode="demo">⌨ Teclado</button></div><div id="camera-options"><label>Estilo de movimiento<select id="gesture"><option value="A">A · Candelabro / Alas</option><option value="B">B · Avión</option><option value="C">C · Joystick con manos</option></select></label><p class="guide" id="guide">Levanta ambos brazos con los codos doblados. Mantén la pose durante 2 segundos para calibrar.</p><button id="camera-toggle" class="primary">Activar cámara y detección <span>↗</span></button><button id="calibrate" class="text-button">Recalibrar postura</button></div><div id="phone-options" hidden><p class="guide">Escanea con tu celular. Ambos dispositivos deben poder acceder a esta dirección HTTPS.</p><canvas id="qr" aria-label="QR del mando"></canvas><label>Dirección pública o IP local<input id="origin" type="url" placeholder="https://tu-dominio.com"></label><button id="update-qr">Actualizar enlace</button><a id="remote-link" target="_blank" rel="noopener">Preparando sala…</a><p class="muted" id="network-note"></p></div><div id="demo-options" hidden><p class="guide">Usa WASD o las flechas para dirección y altura. + / − ajustan la potencia. Espacio activa el turbo.</p></div><div class="status-row"><span class="live-dot" id="status-dot"></span><span id="status" role="status">Cámara apagada</span></div><div class="progress"><i id="calibration-progress"></i></div><button id="fly" class="launch">Iniciar vuelo <span>→</span></button></aside><section id="camera-preview" class="preview panel" hidden><div class="preview-heading"><span>◉ VISIÓN DEL PILOTO</span><button id="hide-preview" aria-label="Ocultar vista de cámara">×</button></div><div class="video-wrap"><video id="video" autoplay playsinline muted></video><canvas id="skeleton"></canvas><div class="camera-label">ESPEJO · DETECCIÓN LOCAL</div></div><div class="range-row"><span>Distancia estimada</span><span id="range-label">—</span></div><meter id="range" min="0" max="0.6" low="0.12" high="0.42" optimum="0.25" value="0"></meter><details><summary>Diagnóstico de movimiento</summary><pre id="debug">Esperando detección…</pre></details></section><div class="flight-tip" id="flight-tip" hidden>VUELO EN CURSO <span>· P para pausar · Esc para volver al panel</span></div></main><footer class="hud"><div><span class="hud-label">VELOCIDAD</span><strong id="speed">0 <small>u/s</small></strong></div><div><span class="hud-label">ALTITUD</span><strong id="altitude">8 <small>u</small></strong></div><div><span class="hud-label">RECORRIDO</span><strong id="distance">0 <small>u</small></strong></div><div><span class="hud-label">IMPACTOS</span><strong id="hits">00</strong></div><div class="hud-end"><span class="hud-label" id="mode-label">EN ESPERA</span><span><b id="fps">60</b> FPS <span id="latency"></span></span></div></footer><dialog id="settings-dialog"><div class="dialog-head"><h2>Ajustes de vuelo</h2><button id="close-settings" aria-label="Cerrar ajustes">×</button></div><p class="muted">Perfil inicial para laptop. Los cambios se guardan en este equipo.</p><div id="settings-fields"></div><label class="check"><input id="collisions" type="checkbox">Colisiones activas</label><label class="check"><input id="preview-option" type="checkbox">Mostrar cámara y esqueleto</label><label>Calidad gráfica<select id="quality"><option value="laptop">Laptop · resolución contenida</option><option value="high">Alta · mayor resolución</option></select></label><p class="muted">La calidad se aplica al recargar. Los metros de distancia requieren referencia física; aquí ajustas el ancho visible de hombros.</p></dialog><div id="toast" role="status"></div>`;
  const elements = new Map<string, HTMLElement>();
  const el = <T extends HTMLElement>(id: string): T => {
    let node = elements.get(id);
    if (!node) {
      node = document.getElementById(id)!;
      elements.set(id, node);
    }
    return node as T;
  };
  root.insertAdjacentHTML(
    "beforeend",
    `<aside id="performance-panel" class="performance-panel panel" hidden><div class="eyebrow">DIAGNÓSTICO DE FLUIDEZ</div><pre id="performance-values">Recogiendo muestras…</pre><button id="export-performance">Descargar diagnóstico</button><p class="muted">Tiempo entre cuadros y envío de trabajo al render; no mide el tiempo GPU. RTT = ida y vuelta.</p></aside>`,
  );
  el("settings-fields").insertAdjacentHTML(
    "afterend",
    `<label class="check"><input id="adaptive-option" type="checkbox">Resolución adaptativa</label><label class="check"><input id="diagnostics-option" type="checkbox">Mostrar diagnóstico de fluidez</label>`,
  );
  el("fly").insertAdjacentHTML(
    "beforebegin",
    `<div id="preparation" role="status"><span id="preparation-label">Preparando gráficos…</span><progress id="preparation-meter" max="1" value="0"></progress></div>`,
  );
  document.body.classList.toggle("laptop-profile", settings.quality !== "high");
  const numberNodes = {} as Record<string, Text>;
  for (const [id, unit] of [
    ["speed", "u/s"],
    ["altitude", "u"],
    ["distance", "u"],
  ]) {
    const number = document.createTextNode("0 "),
      small = document.createElement("small");
    small.textContent = unit;
    el(id).replaceChildren(number, small);
    numberNodes[id] = number;
  }
  let audio: AudioContext | undefined;
  function notify(text: string) {
    el("toast").textContent = text;
    el("toast").classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => el("toast").classList.remove("visible"),
      4500,
    );
    try {
      if (audio?.state === "running") {
        const oscillator = audio.createOscillator(),
          gain = audio.createGain();
        gain.gain.setValueAtTime(0.035, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.12);
        oscillator.frequency.value = 620;
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start();
        oscillator.stop(audio.currentTime + 0.12);
      }
    } catch {}
  }
  let toastTimer: ReturnType<typeof setTimeout>;
  let scene: FlightScene;
  try {
    scene = new FlightScene(el("world"), settings, () => {
      link?.send({ type: "collision" });
    });
  } catch {
    el("status").textContent =
      "No se pudo iniciar WebGL. Activa la aceleración gráfica del navegador.";
    el<HTMLButtonElement>("fly").disabled = true;
    return;
  }
  const vision = new Vision(
    el<HTMLVideoElement>("video"),
    el<HTMLCanvasElement>("skeleton"),
    settings,
    notify,
  );
  el<HTMLButtonElement>("fly").disabled = true;
  void scene
    .prepare()
    .then(() => {
      el<HTMLButtonElement>("fly").disabled = false;
      el("preparation").hidden = true;
      last = performance.now();
      metrics.reset();
    })
    .catch(() => {
      notify(
        "No se pudieron preparar los gráficos. Recarga y revisa la aceleración gráfica.",
      );
      el("preparation-label").textContent =
        "No se pudieron preparar los gráficos";
    });
  function report() {
    return {
      date: new Date().toISOString(),
      mode,
      settings: { ...settings },
      frames: metrics.snapshot(),
      renderSubmitMs: submitMs,
      recycleMs: scene.recycleMs,
      resolutionScale: scene.resolutionScale,
      drawCalls: scene.renderer.info.render.calls,
      triangles: scene.renderer.info.render.triangles,
      vision: {
        delegate: vision.delegate,
        inferenceMs: vision.inferenceMs,
        captureMs: vision.captureMs,
        resultAgeMs: vision.resultAge,
        hz: vision.detectionHz,
      },
      network: link
        ? {
            transport: link.transport,
            serverRTT: link.latency,
            peerRTT: link.peerLatency,
            jitterMs: link.jitter,
            packetAgeMs: Number.isFinite(link.packetAge)
              ? link.packetAge
              : null,
          }
        : null,
      note: "Mediciones de esta sesión; renderSubmitMs no incluye espera GPU. No contiene video, tokens de sala ni imágenes.",
    };
  }
  el("export-performance").onclick = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report(), null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `orbita-diagnostico-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  function save() {
    localStorage.setItem("orbita-settings", JSON.stringify(settings));
  }
  function preview() {
    el("camera-preview").hidden = !(
      vision.active &&
      settings.preview &&
      mode === "camera"
    );
    vision.setPreview(!el("camera-preview").hidden);
  }
  function setMode(next: string) {
    running = false;
    el("fly").textContent = "Iniciar vuelo →";
    el("intro").classList.remove("flying");
    el("flight-tip").hidden = true;
    if (mode === "camera" && next !== "camera") vision.stop();
    if (mode === "phone" && next !== "phone") {
      link?.close();
      link = undefined;
    }
    mode = next;
    document
      .querySelectorAll<HTMLButtonElement>("[data-mode]")
      .forEach((b) => b.classList.toggle("selected", b.dataset.mode === next));
    el("camera-options").hidden = next !== "camera";
    el("phone-options").hidden = next !== "phone";
    el("demo-options").hidden = next !== "demo";
    if (next === "phone") createRoom();
    preview();
  }
  document
    .querySelectorAll<HTMLButtonElement>("[data-mode]")
    .forEach((b) => (b.onclick = () => setMode(b.dataset.mode!)));
  async function drawQR() {
    if (!link?.room) return;
    const url = link.url(connectedOrigin);
    try {
      await QRCode.toCanvas(el<HTMLCanvasElement>("qr"), url, {
        width: 160,
        margin: 1,
        color: { dark: "#0c1821", light: "#e3fff5" },
      });
      const anchor = el<HTMLAnchorElement>("remote-link");
      anchor.href = url;
      anchor.textContent = `Abrir mando · sala ${link.room}`;
    } catch {
      notify("No se pudo generar el QR.");
    }
  }
  function createRoom() {
    link = new Link("host", (m) => {
      if (m.type === "room") void drawQR();
      if (m.type === "connected")
        notify("Celular conectado. Activa y centra sus sensores.");
      if (m.type === "disconnected")
        notify("Celular desconectado. Esperando reconexión.");
    });
    el<HTMLInputElement>("origin").value = connectedOrigin;
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1")
      fetch("/api/network")
        .then((r) => r.json())
        .then((data) => {
          el("network-note").textContent =
            `IP de la laptop: ${data.addresses.join(", ")}. Configura HTTPS o un túnel; localhost en el celular apunta al propio teléfono.`;
        })
        .catch(() => {});
  }
  el("update-qr").onclick = () => {
    try {
      const url = new URL(el<HTMLInputElement>("origin").value);
      if (!["http:", "https:"].includes(url.protocol)) throw Error();
      connectedOrigin = url.origin;
      void drawQR();
      if (url.protocol !== "https:")
        notify("El giroscopio del celular requiere HTTPS.");
    } catch {
      notify(
        "Introduce una dirección válida, por ejemplo https://vuelo.ejemplo.com",
      );
    }
  };
  el("camera-toggle").onclick = async () => {
    if (vision.active) {
      vision.stop();
      el("camera-toggle").textContent = "Activar cámara y detección ↗";
    } else {
      try {
        audio ??= new AudioContext();
        await audio.resume();
      } catch {}
      await vision.start();
      el("camera-toggle").textContent = vision.active
        ? "Apagar cámara"
        : "Activar cámara y detección ↗";
    }
    preview();
  };
  el<HTMLSelectElement>("gesture").onchange = (e) => {
    void vision.changeMode(
      (e.target as HTMLSelectElement).value as "A" | "B" | "C",
    );
    running = false;
    el("fly").textContent = "Iniciar vuelo →";
    el("guide").textContent =
      vision.mode === "B"
        ? "Extiende los brazos en cruz y mantén 2 segundos. Inclina la línea de los brazos para girar."
        : vision.mode === "C"
          ? "Calibra con brazos en candelabro. Después muestra ambas palmas: derecha dirige, izquierda controla potencia."
          : "Levanta ambos brazos con los codos doblados. Mantén la pose durante 2 segundos para calibrar.";
  };
  el("calibrate").onclick = () => {
    vision.reset();
    running = false;
    el("fly").textContent = "Iniciar vuelo →";
    notify("Repite la postura neutra durante 2 segundos.");
  };
  el("hide-preview").onclick = () => {
    settings.preview = false;
    el<HTMLInputElement>("preview-option").checked = false;
    save();
    preview();
  };
  function toggleFlight() {
    if (!scene.prepared || (vision.preparing && mode === "camera")) {
      notify("Espera a que termine la preparación.");
      return;
    }
    if (geometryChanged) {
      scene.rebuild();
      geometryChanged = false;
    }
    if (!running && mode === "camera" && !vision.valid) {
      notify("Activa la cámara y completa la calibración antes de despegar.");
      return;
    }
    if (
      !running &&
      mode === "phone" &&
      (!link?.connected || performance.now() - link.lastPacket > 1200)
    ) {
      notify("Conecta el celular y activa sus sensores antes de despegar.");
      return;
    }
    running = !running;
    invalidSince = 0;
    el("fly").textContent = running ? "Pausar vuelo Ⅱ" : "Continuar vuelo →";
    el("intro").classList.toggle("flying", running);
    el("flight-tip").hidden = !running;
  }
  el("fly").onclick = toggleFlight;
  window.addEventListener("keydown", (e) => {
    if (
      (e.target as HTMLElement).matches("input,select,textarea") ||
      el<HTMLDialogElement>("settings-dialog").open
    )
      return;
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)
    )
      e.preventDefault();
    keys.add(e.key.toLowerCase());
    if (e.key.toLowerCase() === "p" && !e.repeat) toggleFlight();
    if (e.key === "Escape") {
      running = false;
      el("intro").classList.remove("flying");
      el("flight-tip").hidden = true;
      el("fly").textContent = "Continuar vuelo →";
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => keys.clear());
  document.addEventListener("visibilitychange", () => {
    last = performance.now();
    metrics.reset();
    scene.resetTiming();
    if (document.hidden && running) {
      running = false;
      el("fly").textContent = "Continuar vuelo →";
    }
  });
  const fields: [keyof Settings, string, number, number, number][] = [
    ["sensitivity", "Sensibilidad", 0.3, 2, 0.1],
    ["dead", "Zona muerta", 0, 0.4, 0.01],
    ["density", "Cubos por bloque", 8, 80, 1],
    ["seed", "Semilla del universo", 1, 99999, 1],
    ["minSpeed", "Velocidad mínima", 5, 35, 1],
    ["maxSpeed", "Velocidad máxima", 36, 100, 1],
    ["near", "Hombros mínimos · acércate", 0.04, 0.3, 0.01],
    ["far", "Hombros máximos · aléjate", 0.32, 0.7, 0.01],
  ];
  el("settings-fields").innerHTML = fields
    .map(
      ([key, title, min, max, step]) =>
        `<label>${title}<output id="out-${key}">${settings[key]}</output><input id="set-${key}" type="${key === "seed" ? "number" : "range"}" min="${min}" max="${max}" step="${step}" value="${settings[key]}"></label>`,
    )
    .join("");
  for (const [key, minTitle, min, max] of fields) {
    el<HTMLInputElement>(`set-${key}`).oninput = (e) => {
      const value = Number((e.target as HTMLInputElement).value);
      if (!Number.isFinite(value)) return;
      (settings as any)[key] = clamp(value, min, max);
      el(`out-${key}`).textContent = String(settings[key]);
      save();
      if (key === "density" || key === "seed") geometryChanged = true;
    };
    el<HTMLInputElement>(`set-${key}`).onchange = () => {
      if (geometryChanged) {
        scene.rebuild();
        geometryChanged = false;
      }
    };
  }
  el<HTMLInputElement>("adaptive-option").checked = settings.adaptive;
  el<HTMLInputElement>("adaptive-option").onchange = (e) => {
    settings.adaptive = (e.target as HTMLInputElement).checked;
    save();
    scene.resetTiming();
  };
  el<HTMLInputElement>("diagnostics-option").checked = settings.diagnostics;
  el("performance-panel").hidden = !settings.diagnostics;
  el<HTMLInputElement>("diagnostics-option").onchange = (e) => {
    settings.diagnostics = (e.target as HTMLInputElement).checked;
    el("performance-panel").hidden = !settings.diagnostics;
    save();
  };
  el<HTMLInputElement>("collisions").checked = settings.collisions;
  el<HTMLInputElement>("collisions").onchange = (e) => {
    settings.collisions = (e.target as HTMLInputElement).checked;
    save();
  };
  el<HTMLInputElement>("preview-option").checked = settings.preview;
  el<HTMLInputElement>("preview-option").onchange = (e) => {
    settings.preview = (e.target as HTMLInputElement).checked;
    save();
    preview();
  };
  el<HTMLSelectElement>("quality").value = settings.quality;
  el<HTMLSelectElement>("quality").onchange = (e) => {
    settings.quality = (e.target as HTMLSelectElement).value;
    save();
  };
  el("settings-button").onclick = () =>
    el<HTMLDialogElement>("settings-dialog").showModal();
  el("close-settings").onclick = () => {
    if (geometryChanged) {
      scene.rebuild();
      geometryChanged = false;
    }
    el<HTMLDialogElement>("settings-dialog").close();
  };
  let throttle = 0.45;
  setMode("camera");
  function frame(now: number) {
    requestAnimationFrame(frame);
    rawFrameMs = now - last;
    // A pending rAF may carry an earlier timestamp than asynchronous preparation.
    const dt = Math.max(0, Math.min(rawFrameMs / 1000, 0.05));
    last = now;
    if (document.hidden) return;
    if (scene.prepared) {
      metrics.add(rawFrameMs);
      scene.adapt(rawFrameMs);
    }
    void vision.tick(now);
    let input: Control = neutral();
    let valid = true;
    if (mode === "camera") {
      valid = vision.valid;
      input = valid ? vision.control : neutral();
    } else if (mode === "phone") {
      valid = !!link?.connected && now - link.lastPacket < 1200;
      input = valid ? link!.control : neutral();
    } else {
      throttle = clamp(
        throttle +
          (keys.has("+") || keys.has("=") ? dt * 0.3 : 0) -
          (keys.has("-") ? dt * 0.3 : 0),
        0,
        1,
      );
      input = {
        x:
          Number(keys.has("d") || keys.has("arrowright")) -
          Number(keys.has("a") || keys.has("arrowleft")),
        y:
          Number(keys.has("w") || keys.has("arrowup")) -
          Number(keys.has("s") || keys.has("arrowdown")),
        throttle,
        turbo: keys.has(" "),
      };
    }
    if (!valid && running) {
      if (!invalidSince) invalidSince = now;
      if (now - invalidSince > 3000) {
        running = false;
        el("fly").textContent = "Continuar vuelo →";
        notify(
          "Vuelo pausado: se perdió el control. Recupera la señal y continúa.",
        );
      }
    } else invalidSince = 0;
    if (input.turbo && now > turboReady) {
      turboUntil = now + 1800;
      turboReady = now + 7000;
    }
    input = { ...input, turbo: now < turboUntil };
    const renderBegin = performance.now();
    scene.update(dt, input, running, mode as "camera" | "phone" | "demo");
    submitMs = performance.now() - renderBegin;
    el("impact").style.opacity = String(scene.flash * 0.45);
    if (now - lastHUD > 250) {
      lastHUD = now;
      numberNodes.speed.data = `${scene.speed.toFixed(0)} `;
      numberNodes.altitude.data = `${scene.ship.position.y.toFixed(0)} `;
      numberNodes.distance.data = `${scene.distance.toFixed(0)} `;
      el("hits").textContent = String(scene.hits).padStart(2, "0");
      const stats = metrics.snapshot();
      el("fps").textContent = stats.fps.toFixed(0);
      el("mode-label").textContent =
        mode === "camera"
          ? `CÁMARA · ${vision.mode}`
          : mode === "phone"
            ? "GIROSCOPIO"
            : "TECLADO";
      el("latency").textContent =
        mode === "phone"
          ? `· ${(link?.peerLatency ?? 0).toFixed(0)} ms RTT · ${link?.transport === "webrtc" ? "directo" : "servidor"}`
          : "";
      el("status").textContent =
        mode === "camera"
          ? vision.status
          : mode === "phone"
            ? link?.connected
              ? "Celular conectado ✓"
              : "Esperando celular…"
            : "Teclado listo · WASD / flechas";
      el("status-dot").classList.toggle("ready", valid);
      el("calibration-progress").style.width = `${vision.progress * 100}%`;
      el("debug").textContent = vision.mapper.debug || "Esperando calibración…";
      el("range-label").textContent = vision.shoulders
        ? vision.shoulders.toFixed(2)
        : "—";
      el<HTMLMeterElement>("range").value = vision.shoulders;
      const preparing =
        !scene.prepared || (mode === "camera" && vision.preparing);
      el("preparation").hidden = !preparing;
      if (preparing) {
        el("preparation-label").textContent = !scene.prepared
          ? "Preparando gráficos…"
          : vision.status;
        el<HTMLProgressElement>("preparation-meter").value = scene.prepared
          ? vision.preparationProgress
          : 0.15;
      }
      el<HTMLButtonElement>("fly").disabled = preparing;
      if (settings.diagnostics) {
        el("performance-values").textContent =
          `FPS reales: ${stats.fps.toFixed(1)} · ventana ${stats.count} cuadros\nMedia / P95 / P99: ${stats.mean.toFixed(1)} / ${stats.p95.toFixed(1)} / ${stats.p99.toFixed(1)} ms\nCuadros >33 ms: ${stats.slow}\nResolución: ${(scene.resolutionScale * 100).toFixed(0)}% · dibujados ${scene.renderer.info.render.calls}\nEnvío de render CPU: ${submitMs.toFixed(1)} ms\nReciclado último bloque: ${scene.recycleMs.toFixed(2)} ms\nCámara ${vision.delegate}: ${vision.inferenceMs.toFixed(1)} ms · ${vision.detectionHz.toFixed(1)} Hz\nCaptura: ${vision.captureMs.toFixed(1)} ms · resultado ${vision.resultAge.toFixed(1)} ms\nMando: ${link?.transport ?? "—"} · RTT par ${(link?.peerLatency ?? 0).toFixed(1)} ms\nJitter: ${(link?.jitter ?? 0).toFixed(1)} ms · último paquete ${link?.lastPacket ? link.packetAge.toFixed(0) : "—"} ms`;
      }
    }
  }
  requestAnimationFrame(frame);
}
