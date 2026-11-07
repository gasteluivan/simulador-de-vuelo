import {
  FilesetResolver,
  PoseLandmarker,
  HandLandmarker,
} from "@mediapipe/tasks-vision";
let pose: PoseLandmarker,
  hand: HandLandmarker | undefined,
  delegate = "CPU";
let queue = Promise.resolve();
async function prepareHands() {
  if (hand) return;
  const files = await FilesetResolver.forVisionTasks("/wasm", true);
  // MediaPipe consumes and clears its module factory after each task creation.
  // Distinct module URLs re-run that factory for each task, including offline cache hits.
  files.wasmLoaderPath += "?task=hands";
  hand = await HandLandmarker.createFromOptions(files, {
    baseOptions: {
      modelAssetPath: "/models/hand_landmarker.task",
      delegate: "CPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
  });
}
// Serialize initialization and frame handling, including async model loading.
self.onmessage = (event: MessageEvent) => {
  const m = event.data;
  queue = queue
    .then(async () => {
      if (m.type === "init") {
        const files = await FilesetResolver.forVisionTasks("/wasm", true);
        const loader = files.wasmLoaderPath;
        files.wasmLoaderPath = loader + "?task=pose-gpu";
        const options = {
          runningMode: "VIDEO" as const,
          numPoses: 3,
          minPoseDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6,
        };
        try {
          pose = await PoseLandmarker.createFromOptions(files, {
            ...options,
            baseOptions: {
              modelAssetPath: "/models/pose_landmarker_lite.task",
              delegate: "GPU",
            },
          });
          delegate = "GPU";
        } catch {
          files.wasmLoaderPath = loader + "?task=pose-cpu";
          pose = await PoseLandmarker.createFromOptions(files, {
            ...options,
            baseOptions: {
              modelAssetPath: "/models/pose_landmarker_lite.task",
              delegate: "CPU",
            },
          });
        }
        if (m.hands) await prepareHands();
        // Run a throwaway frame before ready so graph initialization is paid during preparation.
        const blank = new OffscreenCanvas(64, 64);
        pose.detectForVideo(blank, 0);
        if (m.hands) hand!.detectForVideo(blank, 0);
        self.postMessage({ type: "ready", delegate, mode: m.mode });
      }
      if (m.type === "prepare") {
        if (m.hands) {
          await prepareHands();
          hand!.detectForVideo(
            new OffscreenCanvas(64, 64),
            Math.max(1, m.time),
          );
        }
        self.postMessage({ type: "prepared", delegate, mode: m.mode });
      }
      if (m.type === "frame") {
        try {
          const begin = performance.now();
          const result = pose.detectForVideo(m.frame, m.time);
          const hands = m.hands
            ? hand!.detectForVideo(m.frame, m.time)
            : undefined;
          self.postMessage({
            type: "result",
            poses: result.landmarks,
            hands: hands?.landmarks,
            handedness: hands?.handednesses,
            time: m.time,
            mode: m.mode,
            inferenceMs: performance.now() - begin,
          });
        } finally {
          m.frame.close();
        }
      }
    })
    .catch((error) =>
      self.postMessage({ type: "error", message: String(error) }),
    );
};
