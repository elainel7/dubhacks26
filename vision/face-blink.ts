import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

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

function closureScore(result: ReturnType<FaceLandmarker["detectForVideo"]>): BlinkSample {
  const categories = result.faceBlendshapes?.[0]?.categories;
  if (!result.faceLandmarks?.length || !categories?.length) {
    return { score: 0, faceVisible: false };
  }
  const scoreOf = (name: string) => categories.find((category) => category.categoryName === name)?.score ?? 0;
  return { score: (scoreOf("eyeBlinkLeft") + scoreOf("eyeBlinkRight")) / 2, faceVisible: true };
}

async function createLandmarker(delegate: "GPU" | "CPU") {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  return FaceLandmarker.createFromOptions(fileset, {
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
  let landmarker: FaceLandmarker;
  try {
    landmarker = await createLandmarker("GPU");
  } catch {
    landmarker = await createLandmarker("CPU");
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
