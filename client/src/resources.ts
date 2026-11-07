interface Manifest {
  version: string;
  files: Record<string, { size: number; sha256: string }>;
}
let manifest: Manifest | undefined;
const completed = new Set<string>();
let manifestPromise: Promise<void> | undefined;
export function installOffline() {
  if (
    !import.meta.env.PROD ||
    !isSecureContext ||
    !("serviceWorker" in navigator)
  )
    return Promise.resolve();
  manifestPromise ??= (async () => {
    const response = await fetch("/resource-manifest.json", {
      cache: "no-cache",
    });
    if (!response.ok) throw Error("No se pudo leer el manifiesto de recursos.");
    manifest = await response.json();
    // Retain this exact version's manifest for offline reloads.
    const cache = await caches.open(`orbita-${manifest!.version}`);
    await cache.put(
      "/resource-manifest.json",
      new Response(JSON.stringify(manifest), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    await navigator.serviceWorker.register("/sw.js");
  })().catch(() => {
    manifestPromise = undefined;
  });
  return manifestPromise;
}
async function loadManifest() {
  if (manifest || !import.meta.env.PROD) return;
  await installOffline();
  if (!manifest && "caches" in globalThis) {
    const registered = await navigator.serviceWorker.getRegistration();
    // Offline fallback reads only the currently active build's manifest through its worker.
    if (registered?.active) {
      const response = await fetch("/resource-manifest.json").catch(
        () => undefined,
      );
      if (response?.ok) manifest = await response.json();
    }
  }
}
/** Download and validate before starting inference. Cache persistence is best effort (quota/browser policy). */
export async function prepareVision(
  hands: boolean,
  progress: (text: string, percent: number) => void,
) {
  await loadManifest();
  const paths = [
    "/wasm/vision_wasm_module_internal.js",
    "/wasm/vision_wasm_module_internal.wasm",
    "/models/pose_landmarker_lite.task",
  ];
  if (hands) paths.push("/models/hand_landmarker.task");
  let cache: Cache | undefined;
  if (manifest && "caches" in globalThis) {
    try {
      cache = await caches.open(`orbita-${manifest.version}`);
    } catch {}
  }
  const total = paths.reduce((n, p) => n + (manifest?.files[p]?.size ?? 1), 0);
  let done = 0;
  for (const path of paths) {
    const size = manifest?.files[path]?.size ?? 1;
    if (!completed.has(path) && !(await cache?.match(path))) {
      progress(
        `Preparando ${path.includes("hand") ? "manos" : path.includes("pose") ? "cuerpo" : "motor de detección"}…`,
        done / total,
      );
      const response = await fetch(path);
      if (!response.ok)
        throw Error(`No se pudo descargar ${path} (${response.status}).`);
      const bytes = await response.arrayBuffer();
      const expected = manifest?.files[path]?.sha256;
      if (expected && crypto.subtle) {
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const actual = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        if (actual !== expected)
          throw Error(
            "Un modelo cambió de versión. Recarga la aplicación para prepararlo de nuevo.",
          );
      }
      if (cache)
        try {
          await cache.put(
            path,
            new Response(bytes, {
              headers: {
                "Content-Type": path.endsWith(".js")
                  ? "text/javascript"
                  : path.endsWith(".wasm")
                    ? "application/wasm"
                    : "application/octet-stream",
              },
            }),
          );
        } catch {}
      completed.add(path);
    }
    done += size;
    progress("Recursos de cámara preparados", done / total);
  }
}
