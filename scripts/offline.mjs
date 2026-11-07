import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "dist/client";
const paths = ["/index.html"];
for (const dir of ["assets", "models", "wasm"])
  for (const f of await readdir(`${root}/${dir}`)) paths.push(`/${dir}/${f}`);
const files = {};
for (const path of paths) {
  const data = await readFile(`${root}${path}`);
  files[path] = {
    size: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}
const version = createHash("sha256")
  .update(JSON.stringify(files))
  .digest("hex")
  .slice(0, 16);
await writeFile(
  `${root}/resource-manifest.json`,
  JSON.stringify({ version, files }),
);
const shell = [
  ...paths.filter((p) => p === "/index.html" || p.startsWith("/assets/")),
  "/resource-manifest.json",
];
await writeFile(
  `${root}/sw.js`,
  `// Generated per build. No skipWaiting: never replace code during an active flight.
const CACHE='orbita-${version}';
const SHELL=${JSON.stringify(shell)};
const ALLOWED=new Set(${JSON.stringify([...paths, "/resource-manifest.json"])});
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('orbita-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(event.request.mode==='navigate'&&(url.pathname==='/'||url.pathname==='/controller')){event.respondWith(caches.open(CACHE).then(cache=>cache.match('/index.html')).then(hit=>hit||fetch(event.request)));return;}
 if(!ALLOWED.has(url.pathname))return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE);const hit=await cache.match(url.pathname);if(hit)return hit;const response=await fetch(event.request);if(response.ok)await cache.put(url.pathname,response.clone());return response;})());
});
`,
);
console.log(
  `Caché versionada: ${version} · ${shell.length} archivos de aplicación. Modelos se preparan al elegir cámara.`,
);
