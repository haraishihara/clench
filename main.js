const videoElement = document.querySelector(".input-video");
const canvasElement = document.querySelector(".output-canvas");
const statusElement = document.querySelector(".status");
const mouthScaleInput = document.getElementById("mouthScale");
const eyeSensitivityInput = document.getElementById("eyeSensitivity");

const canvasCtx = canvasElement.getContext("2d");
const offscreenCanvas = document.createElement("canvas");
const offscreenCtx = offscreenCanvas.getContext("2d");

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const LANDMARKS = {
  leftEyeUpper: 159,
  leftEyeLower: 145,
  leftEyeLeft: 33,
  leftEyeRight: 133,
  rightEyeUpper: 386,
  rightEyeLower: 374,
  rightEyeLeft: 362,
  rightEyeRight: 263,
  mouthLeft: 61,
  mouthRight: 291,
  mouthUpper: 13,
  mouthLower: 14,
};

const updateStatus = (message) => {
  statusElement.textContent = message;
};

const distance = (a, b) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
};

const computeEyeOpenness = (landmarks) => {
  const leftOpen = distance(
    landmarks[LANDMARKS.leftEyeUpper],
    landmarks[LANDMARKS.leftEyeLower]
  );
  const leftWidth = distance(
    landmarks[LANDMARKS.leftEyeLeft],
    landmarks[LANDMARKS.leftEyeRight]
  );
  const rightOpen = distance(
    landmarks[LANDMARKS.rightEyeUpper],
    landmarks[LANDMARKS.rightEyeLower]
  );
  const rightWidth = distance(
    landmarks[LANDMARKS.rightEyeLeft],
    landmarks[LANDMARKS.rightEyeRight]
  );

  const leftRatio = leftOpen / leftWidth;
  const rightRatio = rightOpen / rightWidth;
  return (leftRatio + rightRatio) / 2;
};

const drawMouthWarp = (landmarks, scale) => {
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

  const centerY = ((mouthUpper.y + mouthLower.y) / 2) * canvasElement.height;
  const targetHeight = sh * scale;
  const dy = centerY - targetHeight / 2;

  canvasCtx.drawImage(
    offscreenCanvas,
    sx,
    sy,
    sw,
    sh,
    sx,
    dy,
    sw,
    targetHeight
  );
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
  const eyeOpenness = computeEyeOpenness(landmarks);
  const sensitivity = Number(eyeSensitivityInput.value);
  const mouthScaleMax = Number(mouthScaleInput.value);

  const normalized = clamp((eyeOpenness - sensitivity) * 20, 0, 1);
  const mouthScale = 1 + normalized * (mouthScaleMax - 1);

  drawMouthWarp(landmarks, mouthScale);

  updateStatus(`目の開き: ${eyeOpenness.toFixed(3)} / 口の拡大: ${mouthScale.toFixed(2)}x`);
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
    updateStatus("カメラ起動中...目を開閉してみてください。");
  })
  .catch((error) => {
    console.error(error);
    updateStatus("カメラを起動できませんでした。権限を確認してください。");
  });
