const videoElement = document.querySelector(".input-video");
const canvasElement = document.querySelector(".output-canvas");
const statusElement = document.querySelector(".status");
const mouthScaleInput = document.getElementById("mouthScale");

const canvasCtx = canvasElement.getContext("2d");
const offscreenCanvas = document.createElement("canvas");
const offscreenCtx = offscreenCanvas.getContext("2d");

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const PERIOD_MS = 3000;
const BASE_OPEN = 0.2;

const LANDMARKS = {
  mouthLeft: 61,
  mouthRight: 291,
  mouthUpper: 13,
  mouthLower: 14,
};

const LIP_OUTLINE = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308,
];

const LOWER_LIP = [17, 314, 405, 321, 375, 291];

const updateStatus = (message) => {
  statusElement.textContent = message;
};

const buildLipPath = (landmarks, offsetY) => {
  const path = new Path2D();
  const first = landmarks[LIP_OUTLINE[0]];
  path.moveTo(first.x * canvasElement.width, first.y * canvasElement.height);
  const upperY = landmarks[LANDMARKS.mouthUpper].y * canvasElement.height;
  LIP_OUTLINE.slice(1).forEach((index) => {
    const point = landmarks[index];
    const y = point.y * canvasElement.height;
    const adjustedY = y > upperY ? y + offsetY : y;
    path.lineTo(point.x * canvasElement.width, adjustedY);
  });
  path.closePath();
  return path;
};

const buildLowerLipPath = (landmarks, offsetY) => {
  const path = new Path2D();
  const left = landmarks[LANDMARKS.mouthLeft];
  const right = landmarks[LANDMARKS.mouthRight];
  const upperY = landmarks[LANDMARKS.mouthUpper].y * canvasElement.height;
  path.moveTo(left.x * canvasElement.width, left.y * canvasElement.height);
  LOWER_LIP.forEach((index) => {
    const point = landmarks[index];
    const y = point.y * canvasElement.height;
    const adjustedY = y > upperY ? y + offsetY : y;
    path.lineTo(point.x * canvasElement.width, adjustedY);
  });
  path.lineTo(right.x * canvasElement.width, right.y * canvasElement.height);
  path.closePath();
  return path;
};

const drawMouthWarp = (landmarks, openAmount) => {
  const mouthLeft = landmarks[LANDMARKS.mouthLeft];
  const mouthRight = landmarks[LANDMARKS.mouthRight];
  const mouthUpper = landmarks[LANDMARKS.mouthUpper];
  const mouthLower = landmarks[LANDMARKS.mouthLower];

  const paddingX = 0.04;
  const paddingY = 0.08;

  const minX = Math.min(mouthLeft.x, mouthRight.x) - paddingX;
  const maxX = Math.max(mouthLeft.x, mouthRight.x) + paddingX;
  const minY = Math.min(mouthUpper.y, mouthLower.y) - paddingY;
  const maxY = Math.max(mouthUpper.y, mouthLower.y) + paddingY;

  const sx = clamp(minX, 0, 1) * canvasElement.width;
  const sy = clamp(minY, 0, 1) * canvasElement.height;
  const sw = (clamp(maxX, 0, 1) - clamp(minX, 0, 1)) * canvasElement.width;
  const sh = (clamp(maxY, 0, 1) - clamp(minY, 0, 1)) * canvasElement.height;

  if (sw <= 0 || sh <= 0) return;

  const jawOffset = sh * 0.45 * openAmount;
  const lipPath = buildLipPath(landmarks, jawOffset);
  const lowerLipPath = buildLowerLipPath(landmarks, jawOffset);

  canvasCtx.save();
  canvasCtx.clip(lipPath);
  canvasCtx.fillStyle = "rgba(8, 6, 10, 0.95)";
  canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);

  canvasCtx.save();
  canvasCtx.clip(lowerLipPath);
  canvasCtx.drawImage(
    offscreenCanvas,
    0,
    jawOffset,
    canvasElement.width,
    canvasElement.height
  );
  canvasCtx.restore();

  canvasCtx.restore();
};

const faceMesh = new FaceMesh({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
});

faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6,
});

faceMesh.onResults((results) => {
  if (!results.image) return;

  canvasElement.width = results.image.width;
  canvasElement.height = results.image.height;
  offscreenCanvas.width = results.image.width;
  offscreenCanvas.height = results.image.height;

  offscreenCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(offscreenCanvas, 0, 0, canvasElement.width, canvasElement.height);

  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    updateStatus("顔を検出できませんでした。カメラに顔を向けてください。");
    return;
  }

  const landmarks = results.multiFaceLandmarks[0];
  const mouthScaleMax = Number(mouthScaleInput.value);

  const elapsed = performance.now();
  const normalized = (Math.sin((2 * Math.PI * elapsed) / PERIOD_MS) + 1) / 2;
  const forcedOpen = BASE_OPEN + normalized * (1 - BASE_OPEN);
  const openAmount = forcedOpen * mouthScaleMax;

  drawMouthWarp(landmarks, openAmount);

  updateStatus(`自動開閉中: 口の開き ${openAmount.toFixed(2)}x`);
});

const camera = new Camera(videoElement, {
  onFrame: async () => {
    await faceMesh.send({ image: videoElement });
  },
  width: 1280,
  height: 720,
});

camera
  .start()
  .then(() => {
    updateStatus("カメラ起動中...口の自動開閉を確認してください。");
  })
  .catch((error) => {
    console.error(error);
    updateStatus("カメラを起動できませんでした。権限を確認してください。");
  });
