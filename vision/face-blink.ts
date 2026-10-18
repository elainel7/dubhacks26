const VISION_MODULE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/+esm";
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export type BlinkSample = {
  /** Average of the left and right eyelid closures, from 0 open to 1 shut. */
  score: number;
  faceVisible: boolean;
};

export type FaceBlink = {
  sample: (video: HTMLVideoElement, nowMs: number) => BlinkSample;
  close: () => void;
};

type BlendCategory = { categoryName?: string; score?: number };

type LandmarkerResult = {
  faceLandmarks?: unknown[];
  faceBlendshapes?: { categories?: BlendCategory[] }[];
};

type Landmarker = {
  detectForVideo: (video: HTMLVideoElement, timestamp: number) => LandmarkerResult;
  close: () => void;
};

type VisionModule = {
  FaceLandmarker: {
    createFromOptions: (fileset: unknown, options: unknown) => Promise<Landmarker>;
  };
  FilesetResolver: {
    forVisionTasks: (basePath: string) => Promise<unknown>;
  };
};

function closureScore(result: LandmarkerResult): BlinkSample {
  const categories = result.faceBlendshapes?.[0]?.categories;
  if (!result.faceLandmarks?.length || !categories?.length) {
    return { score: 0, faceVisible: false };
  }
  const scoreOf = (name: string) => categories.find((category) => category.categoryName === name)?.score ?? 0;
  return { score: (scoreOf("eyeBlinkLeft") + scoreOf("eyeBlinkRight")) / 2, faceVisible: true };
}

/** Loaded at runtime so the Next build does not have to resolve an npm package. */
async function loadVisionModule(): Promise<VisionModule> {
  const load = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<VisionModule>;
  return load(VISION_MODULE);
}

async function createLandmarker(vision: VisionModule, delegate: "GPU" | "CPU") {
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
  return vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    minFaceDetectionConfidence: 0.4,
    minFacePresenceConfidence: 0.4,
    minTrackingConfidence: 0.4,
  });
}

/** Eyelid closure from every camera frame. Loads the face landmarker once. */
export async function loadFaceBlink(): Promise<FaceBlink> {
  const vision = await loadVisionModule();
  let landmarker: Landmarker;
  try {
    landmarker = await createLandmarker(vision, "GPU");
  } catch {
    landmarker = await createLandmarker(vision, "CPU");
  }

  let lastTimestamp = -1;
  return {
    sample(video, nowMs) {
      const timestamp = Math.max(lastTimestamp + 1, Math.round(nowMs));
      lastTimestamp = timestamp;
      return closureScore(landmarker.detectForVideo(video, timestamp));
    },
    close() {
      landmarker.close();
    },
  };
}
