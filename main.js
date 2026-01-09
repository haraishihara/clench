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
  forehead: 10, // 額の中央
  chin: 18, // 顎の中央
  noseTip: 4, // 鼻の先
};

const LIP_OUTLINE = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308,
];

const LOWER_LIP = [17, 314, 405, 321, 375, 291];
const INNER_MOUTH = [
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 191,
];

const updateStatus = (message) => {
  statusElement.textContent = message;
};

// 下唇のパスを作成（元の位置）
const buildLowerLipPath = (landmarks) => {
  const path = new Path2D();
  const left = landmarks[LANDMARKS.mouthLeft];
  const right = landmarks[LANDMARKS.mouthRight];
  path.moveTo(left.x * canvasElement.width, left.y * canvasElement.height);
  LOWER_LIP.forEach((index) => {
    const point = landmarks[index];
    path.lineTo(point.x * canvasElement.width, point.y * canvasElement.height);
  });
  path.lineTo(right.x * canvasElement.width, right.y * canvasElement.height);
  path.closePath();
  return path;
};

// 顔の中心線に沿った移動ベクトルを計算
const calculateFaceCenterVector = (landmarks, offsetDistance) => {
  const forehead = landmarks[LANDMARKS.forehead];
  const chin = landmarks[LANDMARKS.chin];
  
  // 顔の中心線の方向ベクトル（上から下へ）
  const dx = (chin.x - forehead.x) * canvasElement.width;
  const dy = (chin.y - forehead.y) * canvasElement.height;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  // 正規化して、移動距離を掛ける
  if (length === 0) {
    return { x: 0, y: offsetDistance };
  }
  
  const normalizedX = dx / length;
  const normalizedY = dy / length;
  
  return {
    x: normalizedX * offsetDistance,
    y: normalizedY * offsetDistance
  };
};

// 下唇を移動した後のパスを作成（顔の中心線に沿って）
const buildLowerLipPathMoved = (landmarks, offsetVector) => {
  const path = new Path2D();
  const left = landmarks[LANDMARKS.mouthLeft];
  const right = landmarks[LANDMARKS.mouthRight];
  path.moveTo(
    left.x * canvasElement.width + offsetVector.x,
    left.y * canvasElement.height + offsetVector.y
  );
  LOWER_LIP.forEach((index) => {
    const point = landmarks[index];
    path.lineTo(
      point.x * canvasElement.width + offsetVector.x,
      point.y * canvasElement.height + offsetVector.y
    );
  });
  path.lineTo(
    right.x * canvasElement.width + offsetVector.x,
    right.y * canvasElement.height + offsetVector.y
  );
  path.closePath();
  return path;
};

// 口の中（黒で塗りつぶす領域）のパスを作成
// 上唇の下側（内側）と下唇の上側（内側）に沿う（顔の中心線に沿って移動）
const buildMouthOpeningPath = (landmarks, offsetVector) => {
  const path = new Path2D();
  const left = landmarks[LANDMARKS.mouthLeft];
  const right = landmarks[LANDMARKS.mouthRight];
  
  // 上唇の内側のポイント（INNER_MOUTHの上半分）
  const upperInnerPoints = INNER_MOUTH.slice(0, 6);
  // 下唇の内側のポイント（INNER_MOUTHの下半分）
  const lowerInnerPoints = INNER_MOUTH.slice(6);
  
  // 左端（mouthLeft）から開始し、上唇の内側のY座標を使用
  const leftUpperInner = landmarks[upperInnerPoints[0]];
  path.moveTo(left.x * canvasElement.width, leftUpperInner.y * canvasElement.height);
  
  // 上唇の内側のポイントを追加（左右の端は除く）
  upperInnerPoints.slice(1, -1).forEach((index) => {
    const point = landmarks[index];
    path.lineTo(point.x * canvasElement.width, point.y * canvasElement.height);
  });
  
  // 右端（mouthRight）で上唇の内側のY座標を使用
  const rightUpperInner = landmarks[upperInnerPoints[upperInnerPoints.length - 1]];
  path.lineTo(right.x * canvasElement.width, rightUpperInner.y * canvasElement.height);
  
  // 下唇の内側のポイント（移動後）を追加（右端から左端へ、顔の中心線に沿って）
  const rightLowerInner = landmarks[lowerInnerPoints[lowerInnerPoints.length - 1]];
  path.lineTo(
    right.x * canvasElement.width + offsetVector.x,
    rightLowerInner.y * canvasElement.height + offsetVector.y
  );
  
  lowerInnerPoints.slice(0, -1).reverse().forEach((index) => {
    const point = landmarks[index];
    path.lineTo(
      point.x * canvasElement.width + offsetVector.x,
      point.y * canvasElement.height + offsetVector.y
    );
  });
  
  // 左端で下唇の内側のY座標を使用
  const leftLowerInner = landmarks[lowerInnerPoints[0]];
  path.lineTo(
    left.x * canvasElement.width + offsetVector.x,
    leftLowerInner.y * canvasElement.height + offsetVector.y
  );
  
  path.closePath();
  return path;
};

const drawMouthWarp = (landmarks, openAmount) => {
  const mouthLeft = landmarks[LANDMARKS.mouthLeft];
  const mouthRight = landmarks[LANDMARKS.mouthRight];
  const mouthUpper = landmarks[LANDMARKS.mouthUpper];
  const mouthLower = landmarks[LANDMARKS.mouthLower];

  // 下唇の移動量を計算（口の開き具合に関係なく、顔の幅に基づいた固定値を使用）
  const faceWidth = Math.abs(mouthRight.x - mouthLeft.x) * canvasElement.width;
  // 顔の幅の一定割合を移動量として使用（口の開き具合に依存しない）
  const baseOffset = faceWidth * 0.15; // 顔の幅の15%を基準移動量とする
  const offsetDistance = baseOffset * openAmount; // アニメーション値でスケール

  // 顔の中心線に沿った移動ベクトルを計算
  const offsetVector = calculateFaceCenterVector(landmarks, offsetDistance);

  // 下唇の元の位置と移動後の位置のパスを作成
  const lowerLipPathOriginal = buildLowerLipPath(landmarks);
  const lowerLipPathMoved = buildLowerLipPathMoved(landmarks, offsetVector);
  
  // 下唇の境界ボックスを計算（切り抜き用）
  const lowerLipPoints = [
    mouthLeft,
    mouthRight,
    ...LOWER_LIP.map(index => landmarks[index])
  ];
  
  let minLipX = Infinity, maxLipX = -Infinity;
  let minLipY = Infinity, maxLipY = -Infinity;
  
  lowerLipPoints.forEach(point => {
    minLipX = Math.min(minLipX, point.x);
    maxLipX = Math.max(maxLipX, point.x);
    minLipY = Math.min(minLipY, point.y);
    maxLipY = Math.max(maxLipY, point.y);
  });

  const padding = 0.02;
  const lipSx = clamp(minLipX - padding, 0, 1) * canvasElement.width;
  const lipSy = clamp(minLipY - padding, 0, 1) * canvasElement.height;
  const lipSw = (clamp(maxLipX + padding, 0, 1) - clamp(minLipX - padding, 0, 1)) * canvasElement.width;
  const lipSh = (clamp(maxLipY + padding, 0, 1) - clamp(minLipY - padding, 0, 1)) * canvasElement.height;

  // 1. 下唇の元の位置を削除（切り抜く）
  canvasCtx.save();
  canvasCtx.globalCompositeOperation = 'destination-out';
  canvasCtx.fill(lowerLipPathOriginal);
  canvasCtx.restore();

  // 2. 口の中（開いた部分）を黒で塗りつぶす
  const mouthOpeningPath = buildMouthOpeningPath(landmarks, offsetVector);
  canvasCtx.save();
  canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.98)';
  canvasCtx.fill(mouthOpeningPath);
  canvasCtx.restore();

  // 3. 下唇を切り抜いて顔の中心線に沿って移動させて描画
  canvasCtx.save();
  canvasCtx.clip(lowerLipPathMoved);
  // 下唇の領域を元の位置から切り抜いて、顔の中心線に沿って移動した位置に描画
  canvasCtx.drawImage(
    offscreenCanvas,
    lipSx,
    lipSy,
    lipSw,
    lipSh,
    lipSx + offsetVector.x,
    lipSy + offsetVector.y,
    lipSw,
    lipSh
  );
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
  // 口の開け具合に関係なく、常に一定の開きを維持（アニメーション用）
  // 実際の口の開き具合は無視して、強制的に開いた状態を維持
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
