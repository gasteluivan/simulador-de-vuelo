import { mkdir, copyFile, readdir, writeFile } from "node:fs/promises";
const root = "client/public";
await mkdir(`${root}/models`, { recursive: true });
await mkdir(`${root}/wasm`, { recursive: true });
for (const file of await readdir("node_modules/@mediapipe/tasks-vision/wasm"))
  await copyFile(
    `node_modules/@mediapipe/tasks-vision/wasm/${file}`,
    `${root}/wasm/${file}`,
  );
for (const [name, url] of Object.entries({
  pose_landmarker_lite:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
  hand_landmarker:
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
})) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`${name}: ${response.status}`);
  await writeFile(
    `${root}/models/${name}.task`,
    Buffer.from(await response.arrayBuffer()),
  );
  console.log(`Modelo descargado: ${name}`);
}
