const videoElement = document.querySelector(".input-video");
const canvasElement = document.querySelector(".output-canvas");
const statusElement = document.querySelector(".status");
const mouthScaleInput = document.getElementById("mouthScale");
const periodScaleInput = document.getElementById("periodScale");
const stageElement = document.querySelector('.stage');

const canvasCtx = canvasElement.getContext("2d");
const offscreenCanvas = document.createElement("canvas");
const offscreenCtx = offscreenCanvas.getContext("2d");
const meshCanvas = document.createElement("canvas");
const meshCtx = meshCanvas.getContext("2d");

let stageSizeInitialized = false;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const PERIOD_MS = 1500; // 1秒周期
const BASE_OPEN = 0.2;
const OPEN_DURATION = 0.85; // 開く時間の割合（85%）

// イージング関数（ease-out: 最初は速く、最後は遅く）
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

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

// アフィン変換行列を計算（3点から）
const getAffineTransform = (srcTri, dstTri) => {
  const [x1, y1] = srcTri[0];
  const [x2, y2] = srcTri[1];
  const [x3, y3] = srcTri[2];
  const [u1, v1] = dstTri[0];
  const [u2, v2] = dstTri[1];
  const [u3, v3] = dstTri[2];

  // アフィン変換の係数を計算
  const denom = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
  if (Math.abs(denom) < 1e-10) return null;

  const a = ((u2 - u1) * (y3 - y1) - (u3 - u1) * (y2 - y1)) / denom;
  const b = ((x2 - x1) * (u3 - u1) - (x3 - x1) * (u2 - u1)) / denom;
  const c = u1 - a * x1 - b * y1;
  const d = ((v2 - v1) * (y3 - y1) - (v3 - v1) * (y2 - y1)) / denom;
  const e = ((x2 - x1) * (v3 - v1) - (x3 - x1) * (v2 - v1)) / denom;
  const f = v1 - d * x1 - e * y1;

  return { a, b, c, d, e, f };
};

// アフィン変換を適用して点を変換
const transformPoint = (transform, x, y) => {
  return {
    x: transform.a * x + transform.b * y + transform.c,
    y: transform.d * x + transform.e * y + transform.f
  };
};

// メッシュベースの変形を適用（最適化版 - 口周辺のみ）
const applyMeshWarp = (sourceCanvas, sourcePoints, targetPoints, delaunay, mouthRegion, drawX, drawY, drawWidth, drawHeight) => {
  meshCanvas.width = canvasElement.width;
  meshCanvas.height = canvasElement.height;
  
  // まず元の画像を正しい位置とサイズで描画
  meshCtx.clearRect(0, 0, meshCanvas.width, meshCanvas.height);
  meshCtx.drawImage(sourceCanvas, drawX, drawY, drawWidth, drawHeight);

  // 口周辺の領域のみをクリッピング
  meshCtx.save();
  meshCtx.beginPath();
  meshCtx.rect(mouthRegion.minX, mouthRegion.minY, 
               mouthRegion.maxX - mouthRegion.minX, 
               mouthRegion.maxY - mouthRegion.minY);
  meshCtx.clip();

  // 各三角形に対してアフィン変換を適用（口周辺の領域のみ）
  const triangles = delaunay.triangles;
  // パフォーマンス向上のため、変形が必要な三角形のみ処理
  for (let i = 0; i < triangles.length; i += 3) {
    const i0 = triangles[i];
    const i1 = triangles[i + 1];
    const i2 = triangles[i + 2];

    // 境界ポイントはスキップ
    if (i0 < 0 || i1 < 0 || i2 < 0) continue;

    const srcTri = [
      [sourcePoints[i0].x, sourcePoints[i0].y],
      [sourcePoints[i1].x, sourcePoints[i1].y],
      [sourcePoints[i2].x, sourcePoints[i2].y]
    ];
    const dstTri = [
      [targetPoints[i0].x, targetPoints[i0].y],
      [targetPoints[i1].x, targetPoints[i1].y],
      [targetPoints[i2].x, targetPoints[i2].y]
    ];

    // 三角形が変形されているかチェック（変形されていない場合はスキップ）
    const hasDeformation = srcTri.some((src, idx) => {
      const dst = dstTri[idx];
      return Math.abs(src[0] - dst[0]) > 0.5 || Math.abs(src[1] - dst[1]) > 0.5;
    });
    if (!hasDeformation) continue;

    // パスを作成してクリッピング
    const path = new Path2D();
    path.moveTo(dstTri[0][0], dstTri[0][1]);
    path.lineTo(dstTri[1][0], dstTri[1][1]);
    path.lineTo(dstTri[2][0], dstTri[2][1]);
    path.closePath();

    meshCtx.save();
    meshCtx.clip(path);

    // アフィン変換を適用して描画
    // ソース座標とターゲット座標はCanvas座標系
    // sourceCanvasは元の画像サイズなので、座標系を変換する必要がある
    const scaleX = drawWidth / sourceCanvas.width;
    const scaleY = drawHeight / sourceCanvas.height;
    
    // ソース座標を元の画像座標系に変換
    const srcTriImage = srcTri.map(([x, y]) => [
      (x - drawX) / scaleX,
      (y - drawY) / scaleY
    ]);
    
    // ターゲット座標を元の画像座標系に変換
    const dstTriImage = dstTri.map(([x, y]) => [
      (x - drawX) / scaleX,
      (y - drawY) / scaleY
    ]);
    
    // 元の画像座標系でアフィン変換を計算
    const transformImage = getAffineTransform(srcTriImage, dstTriImage);
    if (!transformImage) {
      meshCtx.restore();
      continue;
    }
    
    // アフィン変換を適用（元の画像座標系からCanvas座標系に変換）
    meshCtx.setTransform(
      transformImage.a * scaleX, transformImage.d * scaleY,
      transformImage.b * scaleX, transformImage.e * scaleY,
      transformImage.c * scaleX + drawX, transformImage.f * scaleY + drawY
    );
    meshCtx.drawImage(sourceCanvas, 0, 0);
    meshCtx.restore();
  }
  
  meshCtx.restore();

  return meshCanvas;
};

// 簡易的なフェザーマスク（パフォーマンス向上のため簡略化）
const createFeatherMask = (width, height, maskPath, featherRadius = 10) => {
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext("2d");

  // マスクを描画
  maskCtx.fillStyle = "white";
  maskCtx.fill(maskPath);

  // 簡易的なブラー効果（Canvas 2D APIのfilterを使用）
  // パフォーマンス向上のため、ガウシアンブラーは使用しない
  // 代わりに、シンプルなグラデーションマスクを使用
  return maskCanvas;
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

const drawMouthWarp = (landmarks, openAmount, drawX, drawY, drawWidth, drawHeight, imageWidth, imageHeight) => {
  // ランドマークの座標をCanvasのサイズに合わせて調整
  // ランドマークは0-1の正規化された座標（元の画像サイズ基準）
  // Canvasに描画された画像の位置とサイズに合わせて調整
  const scaleX = drawWidth / imageWidth;
  const scaleY = drawHeight / imageHeight;
  
  // ランドマークを調整（正規化座標をCanvas座標に変換）
  const adjustedLandmarks = landmarks.map(point => ({
    x: (point.x * imageWidth * scaleX + drawX) / canvasElement.width,
    y: (point.y * imageHeight * scaleY + drawY) / canvasElement.height
  }));
  
  const mouthLeft = adjustedLandmarks[LANDMARKS.mouthLeft];
  const mouthRight = adjustedLandmarks[LANDMARKS.mouthRight];
  const mouthUpper = adjustedLandmarks[LANDMARKS.mouthUpper];
  const mouthLower = adjustedLandmarks[LANDMARKS.mouthLower];

  // 下唇の移動量を計算（口の開き具合に関係なく、顔の幅に基づいた固定値を使用）
  const faceWidth = Math.abs(mouthRight.x - mouthLeft.x) * canvasElement.width;
  const baseOffset = faceWidth * 0.2;
  const offsetDistance = baseOffset * openAmount;

  // 顔の中心線に沿った移動ベクトルを計算（調整済みランドマークを使用）
  const forehead = adjustedLandmarks[LANDMARKS.forehead];
  const chin = adjustedLandmarks[LANDMARKS.chin];
  
  const dx = (chin.x - forehead.x) * canvasElement.width;
  const dy = (chin.y - forehead.y) * canvasElement.height;
  const length = Math.sqrt(dx * dx + dy * dy);
  
  const offsetVector = length === 0 
    ? { x: 0, y: offsetDistance }
    : { x: (dx / length) * offsetDistance, y: (dy / length) * offsetDistance };

  // 顎周辺のランドマーク（顎を動かすために追加）
  // MediaPipeの顔メッシュでは、顎周辺のランドマークは以下の通り
  const CHIN_REGION = [
    LANDMARKS.chin, // 18: 顎の中央
    175, 199, // 顎の左側
    396, 369, // 顎の右側
    172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, // 顎周辺の追加ポイント
  ];
  
  // メッシュ用のポイントを準備（口周辺のランドマークを含む）
  // 下唇のポイントのみを移動し、それ以外は固定
  const mouthRegionIndices = [
    ...LIP_OUTLINE,
    ...INNER_MOUTH,
    ...LOWER_LIP,
    ...CHIN_REGION, // 顎周辺のランドマークを追加
    13, 14, 78, 95, 88, 178, 87, 317, 402, 318, 324, 191
  ];
  
  // 重複を除去
  const uniqueIndices = [...new Set(mouthRegionIndices)];
  
  // 元の位置のポイント（調整済みランドマークを使用）
  const sourcePoints = uniqueIndices.map(index => {
    const point = adjustedLandmarks[index];
    return {
      x: point.x * canvasElement.width,
      y: point.y * canvasElement.height,
      index: index
    };
  });

  // 変形後の位置のポイント
  // 下唇のポイントは移動のみ、顎は口の動きの半分で移動、それ以外は固定
  const targetPoints = sourcePoints.map(point => {
    const isLowerLip = LOWER_LIP.includes(point.index) || 
                       point.index === LANDMARKS.mouthLeft || 
                       point.index === LANDMARKS.mouthRight ||
                       point.index === LANDMARKS.mouthLower;
    
    // 下唇のポイントは完全に移動（変形なし）
    if (isLowerLip) {
      return {
        x: point.x + offsetVector.x,
        y: point.y + offsetVector.y,
        index: point.index
      };
    }
    
    // 顎のポイントは口の動きの半分（0.5倍）で移動
    // ただし、より目立つように少し増やす
    const isChin = CHIN_REGION.includes(point.index) || point.index === LANDMARKS.chin;
    if (isChin) {
      return {
        x: point.x + offsetVector.x * 0.6, // 0.5から0.6に増やしてより目立つように
        y: point.y + offsetVector.y * 0.6, // 0.5から0.6に増やしてより目立つように
        index: point.index
      };
    }
    
    // 下唇の周辺のポイント（顎以外）は少し移動して自然に見せる
    // 下唇から距離に応じて移動量を減らす
    const lowerLipCenterY = Math.min(...sourcePoints.filter(p => 
      LOWER_LIP.includes(p.index) || p.index === LANDMARKS.mouthLower
    ).map(p => p.y));
    
    const distanceFromLowerLip = Math.abs(point.y - lowerLipCenterY);
    const maxDistance = 100; // 最大距離（ピクセル）
    const influenceFactor = Math.max(0, 1 - distanceFromLowerLip / maxDistance);
    
    if (influenceFactor > 0 && point.y > lowerLipCenterY) {
      // 下唇より下にあるポイントは、距離に応じて少し移動（顎以外）
      return {
        x: point.x + offsetVector.x * influenceFactor * 0.3,
        y: point.y + offsetVector.y * influenceFactor * 0.3,
        index: point.index
      };
    }
    
    // それ以外はそのまま
    return { ...point };
  });

  // 境界ポイントを追加（メッシュの安定性のため）
  const padding = 50;
  const bounds = {
    minX: Math.min(...sourcePoints.map(p => p.x)) - padding,
    maxX: Math.max(...sourcePoints.map(p => p.x)) + padding,
    minY: Math.min(...sourcePoints.map(p => p.y)) - padding,
    maxY: Math.max(...sourcePoints.map(p => p.y)) + padding
  };

  // 境界ポイントを追加
  const boundaryPoints = [
    { x: bounds.minX, y: bounds.minY, index: -1 },
    { x: bounds.maxX, y: bounds.minY, index: -2 },
    { x: bounds.maxX, y: bounds.maxY, index: -3 },
    { x: bounds.minX, y: bounds.maxY, index: -4 }
  ];

  const allSourcePoints = [...sourcePoints, ...boundaryPoints];
  const allTargetPoints = [...targetPoints, ...boundaryPoints];

  // 口周辺と顎周辺の領域を定義（メッシュ変形を適用する範囲）
  // 顎も含めるため、下方向のパディングを増やす
  const mouthRegionPadding = 100;
  
  // 顎のポイントのY座標を取得（顎が含まれているか確認）
  const chinPoints = sourcePoints.filter(p => CHIN_REGION.includes(p.index) || p.index === LANDMARKS.chin);
  const maxChinY = chinPoints.length > 0 ? Math.max(...chinPoints.map(p => p.y)) : 0;
  const maxSourceY = Math.max(...sourcePoints.map(p => p.y));
  // 顎のポイントが含まれている場合、顎の下まで含める
  const chinPadding = maxChinY > maxSourceY ? 200 : 150;
  
  const mouthRegion = {
    minX: Math.max(0, Math.min(...sourcePoints.map(p => p.x)) - mouthRegionPadding),
    maxX: Math.min(canvasElement.width, Math.max(...sourcePoints.map(p => p.x)) + mouthRegionPadding),
    minY: Math.max(0, Math.min(...sourcePoints.map(p => p.y)) - mouthRegionPadding),
    maxY: Math.min(canvasElement.height, Math.max(maxSourceY, maxChinY) + chinPadding)
  };

  // Delaunay三角分割を実行
  const points = allSourcePoints.map(p => [p.x, p.y]);
  const delaunay = d3.Delaunay.from(points);

  // まず元の画像を描画
  canvasCtx.drawImage(offscreenCanvas, drawX, drawY, drawWidth, drawHeight);

  // 口の中の領域（下唇が移動した後の空白部分）の色を取得
  // 元の画像（offscreenCanvas）から、下唇が移動した後の位置に対応する色を取得
  const mouthOpeningPath = buildMouthOpeningPath(adjustedLandmarks, offsetVector);
  
  // 口の中の領域の境界ボックスを計算（Canvas座標系）
  const mouthPathBounds = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity
  };
  
  // 口の中のパスの主要なポイントから境界を計算
  const upperInnerPoints = INNER_MOUTH.slice(0, 6);
  const lowerInnerPoints = INNER_MOUTH.slice(6);
  
  // 上唇の内側ポイント
  upperInnerPoints.forEach(index => {
    const point = adjustedLandmarks[index];
    mouthPathBounds.minX = Math.min(mouthPathBounds.minX, point.x * canvasElement.width);
    mouthPathBounds.maxX = Math.max(mouthPathBounds.maxX, point.x * canvasElement.width);
    mouthPathBounds.minY = Math.min(mouthPathBounds.minY, point.y * canvasElement.height);
    mouthPathBounds.maxY = Math.max(mouthPathBounds.maxY, point.y * canvasElement.height);
  });
  
  // 下唇の内側ポイント（移動後）
  lowerInnerPoints.forEach(index => {
    const point = adjustedLandmarks[index];
    const movedX = point.x * canvasElement.width + offsetVector.x;
    const movedY = point.y * canvasElement.height + offsetVector.y;
    mouthPathBounds.minX = Math.min(mouthPathBounds.minX, movedX);
    mouthPathBounds.maxX = Math.max(mouthPathBounds.maxX, movedX);
    mouthPathBounds.minY = Math.min(mouthPathBounds.minY, movedY);
    mouthPathBounds.maxY = Math.max(mouthPathBounds.maxY, movedY);
  });
  
  // 元の画像座標系に変換して色を取得
  const imageScaleX = drawWidth / imageWidth;
  const imageScaleY = drawHeight / imageHeight;
  
  // 口の中の中心位置を計算（下唇が移動した後の位置）
  const mouthCenterCanvasX = (mouthPathBounds.minX + mouthPathBounds.maxX) / 2;
  const mouthCenterCanvasY = (mouthPathBounds.minY + mouthPathBounds.maxY) / 2;
  
  // Canvas座標系から元の画像座標系に変換
  const mouthCenterImageX = (mouthCenterCanvasX - drawX) / imageScaleX;
  const mouthCenterImageY = (mouthCenterCanvasY - drawY) / imageScaleY;
  
  // 元の画像から色をサンプリング（下唇が移動した後の位置 = 元の画像では下唇の下側）
  const sampleSize = 30;
  const sampleX = Math.max(0, Math.min(imageWidth - sampleSize, Math.floor(mouthCenterImageX - sampleSize / 2)));
  const sampleY = Math.max(0, Math.min(imageHeight - sampleSize, Math.floor(mouthCenterImageY - sampleSize / 2)));
  
  // 一時的なCanvasで元の画像から色を取得
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = sampleSize;
  tempCanvas.height = sampleSize;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(offscreenCanvas, sampleX, sampleY, sampleSize, sampleSize, 0, 0, sampleSize, sampleSize);
  
  const imageData = tempCtx.getImageData(0, 0, sampleSize, sampleSize);
  const data = imageData.data;
  let totalR = 0, totalG = 0, totalB = 0;
  let pixelCount = 0;
  
  // 中心付近のピクセルの色をサンプリング
  for (let y = 0; y < sampleSize; y++) {
    for (let x = 0; x < sampleSize; x++) {
      const distFromCenter = Math.sqrt((x - sampleSize / 2) ** 2 + (y - sampleSize / 2) ** 2);
      const maxDist = sampleSize / 2;
      
      if (distFromCenter < maxDist) {
        const idx = (y * sampleSize + x) * 4;
        totalR += data[idx];
        totalG += data[idx + 1];
        totalB += data[idx + 2];
        pixelCount++;
      }
    }
  }
  
  // 口の中の色を取得
  let mouthColor = { r: 0, g: 0, b: 0 };
  if (pixelCount > 0) {
    mouthColor = {
      r: Math.floor(totalR / pixelCount),
      g: Math.floor(totalG / pixelCount),
      b: Math.floor(totalB / pixelCount)
    };
  }
  
  // 1. 下唇の元の位置を削除
  const lowerLipPathOriginal = buildLowerLipPath(adjustedLandmarks);
  canvasCtx.save();
  canvasCtx.globalCompositeOperation = 'destination-out';
  canvasCtx.fill(lowerLipPathOriginal);
  canvasCtx.restore();

  // 2. 口の中を取得した色で塗りつぶす（少し暗くして自然に）
  canvasCtx.save();
  const gradient = canvasCtx.createLinearGradient(
    mouthLeft.x * canvasElement.width,
    mouthUpper.y * canvasElement.height,
    mouthLeft.x * canvasElement.width,
    (mouthLower.y + offsetVector.y / canvasElement.height) * canvasElement.height
  );
  
  // 取得した色を少し暗くしてグラデーションを作成
  const darkenFactor = 0.6; // 60%の明るさに
  const topColor = {
    r: Math.floor(mouthColor.r * darkenFactor),
    g: Math.floor(mouthColor.g * darkenFactor),
    b: Math.floor(mouthColor.b * darkenFactor)
  };
  const middleColor = {
    r: Math.floor(mouthColor.r * darkenFactor * 0.8),
    g: Math.floor(mouthColor.g * darkenFactor * 0.8),
    b: Math.floor(mouthColor.b * darkenFactor * 0.8)
  };
  const bottomColor = {
    r: Math.floor(mouthColor.r * darkenFactor * 0.6),
    g: Math.floor(mouthColor.g * darkenFactor * 0.6),
    b: Math.floor(mouthColor.b * darkenFactor * 0.6)
  };
  
  gradient.addColorStop(0, `rgba(${topColor.r}, ${topColor.g}, ${topColor.b}, 0.95)`);
  gradient.addColorStop(0.5, `rgba(${middleColor.r}, ${middleColor.g}, ${middleColor.b}, 0.98)`);
  gradient.addColorStop(1, `rgba(${bottomColor.r}, ${bottomColor.g}, ${bottomColor.b}, 1)`);
  canvasCtx.fillStyle = gradient;
  canvasCtx.fill(mouthOpeningPath);
  canvasCtx.restore();

  // 3. メッシュベースの変形を適用（口周辺の領域のみ、下唇は除外）
  // 下唇の領域を除外してメッシュ変形を適用
  const lowerLipPathMoved = buildLowerLipPathMoved(adjustedLandmarks, offsetVector);
  
  // 下唇の領域を除外したメッシュ変形領域を定義
  const meshRegionWithoutLip = {
    minX: mouthRegion.minX,
    maxX: mouthRegion.maxX,
    minY: mouthRegion.minY,
    maxY: mouthRegion.maxY
  };
  
  const warpedCanvas = applyMeshWarp(
    offscreenCanvas,
    allSourcePoints,
    allTargetPoints,
    delaunay,
    meshRegionWithoutLip,
    drawX,
    drawY,
    drawWidth,
    drawHeight
  );

  // 4. 変形した口周辺の領域を描画（下唇の領域は除外）
  canvasCtx.save();
  canvasCtx.beginPath();
  canvasCtx.rect(meshRegionWithoutLip.minX, meshRegionWithoutLip.minY, 
                 meshRegionWithoutLip.maxX - meshRegionWithoutLip.minX, 
                 meshRegionWithoutLip.maxY - meshRegionWithoutLip.minY);
  // 下唇の移動後の領域を除外
  canvasCtx.rect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.clip(lowerLipPathMoved, 'evenodd');
  canvasCtx.globalCompositeOperation = 'source-over';
  canvasCtx.drawImage(warpedCanvas, 0, 0);
  canvasCtx.restore();

  // 5. 下唇を単純に切り抜いて移動させて描画（変形なし）
  // 下唇の境界ボックスを計算（元の画像座標系）
  const lowerLipPoints = [
    mouthLeft,
    mouthRight,
    ...LOWER_LIP.map(index => adjustedLandmarks[index])
  ];
  
  let minLipX = Infinity, maxLipX = -Infinity;
  let minLipY = Infinity, maxLipY = -Infinity;
  
  lowerLipPoints.forEach(point => {
    const x = point.x * canvasElement.width;
    const y = point.y * canvasElement.height;
    minLipX = Math.min(minLipX, x);
    maxLipX = Math.max(maxLipX, x);
    minLipY = Math.min(minLipY, y);
    maxLipY = Math.max(maxLipY, y);
  });

  // 元の画像座標系での下唇の位置を計算（imageScaleX, imageScaleYは既に定義済み）
  const lipPadding = 5;
  const lipSx = Math.max(0, (minLipX - drawX) / imageScaleX - lipPadding);
  const lipSy = Math.max(0, (minLipY - drawY) / imageScaleY - lipPadding);
  const lipSw = Math.min(imageWidth - lipSx, (maxLipX - minLipX) / imageScaleX + lipPadding * 2);
  const lipSh = Math.min(imageHeight - lipSy, (maxLipY - minLipY) / imageScaleY + lipPadding * 2);

  // 下唇を切り抜いて下に移動させて描画（変形なし、単純な移動のみ）
  canvasCtx.save();
  canvasCtx.clip(lowerLipPathMoved);
  canvasCtx.globalCompositeOperation = 'source-over';
  canvasCtx.drawImage(
    offscreenCanvas,
    lipSx,
    lipSy,
    lipSw,
    lipSh,
    drawX + lipSx * imageScaleX + offsetVector.x,
    drawY + lipSy * imageScaleY + offsetVector.y,
    lipSw * imageScaleX,
    lipSh * imageScaleY
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

  if (!stageElement) return;

  // カメラ映像のアスペクト比を取得（実際のカメラ映像のサイズを使用）
  const imageAspectRatio = results.image.width / results.image.height;
  
  // カメラ映像が縦型か横型かを判定
  const isPortrait = results.image.height > results.image.width;
  
  // 縦型の場合のアスペクト比を計算
  // カメラは720x1280（縦型）を想定しているが、実際の映像サイズを使用
  const portraitAspectRatio = isPortrait ? imageAspectRatio : (results.image.height / results.image.width);
  
  // フルスクリーン状態をチェック
  const isFullscreen = !!getFullscreenElement() || 
                       stageElement.classList.contains('fullscreen-mode');
  
  // 初回のみ.stageのサイズを設定（循環参照を防ぐ）
  // フルスクリーン時は常に再計算
  if (!stageSizeInitialized || isFullscreen) {
    let availableWidth, availableHeight;
    
    if (isFullscreen) {
      // フルスクリーン時は画面全体を使用
      availableWidth = window.innerWidth;
      availableHeight = window.innerHeight;
    } else {
      // 通常時は親要素のサイズを取得
      const appElement = document.querySelector('.app');
      const appWidth = appElement ? appElement.clientWidth : window.innerWidth;
      const appHeight = appElement ? appElement.clientHeight : window.innerHeight;
      
      // 画面の利用可能なサイズを計算（パディングを考慮）
      availableWidth = Math.min(appWidth - 32, window.innerWidth - 32);
      availableHeight = Math.min(appHeight - 32, window.innerHeight - 32);
    }
    
    // カメラ映像の実際のアスペクト比を使用
    // 縦型の場合: height/width (1より大きい値)
    // 横型の場合: width/height (1より小さい値)
    const cameraAspectRatioForStage = isPortrait
      ? (results.image.height / results.image.width)  // 縦型: 高さ/幅
      : (results.image.width / results.image.height); // 横型: 幅/高さ
    
    let stageWidth, stageHeight;
    
    // 画面のアスペクト比（高さ/幅）
    const screenAspectRatio = availableHeight / availableWidth;
    
    if (isPortrait) {
      // 縦型カメラ映像の場合
      if (screenAspectRatio > cameraAspectRatioForStage) {
        // 画面がより縦長の場合、幅に合わせる（アスペクト比を維持）
        stageWidth = availableWidth;
        stageHeight = stageWidth * cameraAspectRatioForStage;
      } else {
        // 画面がより横長の場合、高さに合わせる（アスペクト比を維持）
        stageHeight = availableHeight;
        stageWidth = stageHeight / cameraAspectRatioForStage;
      }
    } else {
      // 横型カメラ映像の場合
      const screenAspectRatioWidth = availableWidth / availableHeight; // 幅/高さ
      
      if (screenAspectRatioWidth > cameraAspectRatioForStage) {
        // 画面がより横長の場合、高さに合わせる（アスペクト比を維持）
        stageHeight = availableHeight;
        stageWidth = stageHeight * cameraAspectRatioForStage;
      } else {
        // 画面がより縦長の場合、幅に合わせる（アスペクト比を維持）
        stageWidth = availableWidth;
        stageHeight = stageWidth / cameraAspectRatioForStage;
      }
    }
    
    // .stageのサイズを設定
    stageElement.style.width = `${stageWidth}px`;
    stageElement.style.height = `${stageHeight}px`;
    
    // フルスクリーン時は再計算を許可しない（通常時のみ初期化フラグを設定）
    if (!isFullscreen) {
      stageSizeInitialized = true;
    }
  }

  // .stageのサイズを取得（固定されたサイズ）
  const displayWidth = stageElement.clientWidth;
  const displayHeight = stageElement.clientHeight;
  
  // Canvasのサイズを.stageのサイズに合わせる
  const canvasWidth = displayWidth;
  const canvasHeight = displayHeight;

  // Canvasのサイズを設定（表示サイズと同じ）
  canvasElement.width = canvasWidth;
  canvasElement.height = canvasHeight;
  offscreenCanvas.width = results.image.width;
  offscreenCanvas.height = results.image.height;
  
  // Canvasの表示サイズを設定
  canvasElement.style.width = `${canvasWidth}px`;
  canvasElement.style.height = `${canvasHeight}px`;
  
  canvasCtx.clearRect(0, 0, canvasWidth, canvasHeight);

  // カメラ映像を縦型で表示（アスペクト比を保持）
  // Canvasのサイズに合わせて、カメラ映像のアスペクト比を維持しながらスケール
  let drawWidth, drawHeight, drawX, drawY;
  
  // カメラ映像の実際のアスペクト比を使用
  // 縦型の場合: height/width (1より大きい値)
  // 横型の場合: width/height (1より小さい値)
  const cameraAspectRatio = isPortrait 
    ? (results.image.height / results.image.width)  // 縦型: 高さ/幅
    : (results.image.width / results.image.height); // 横型: 幅/高さ
  
  // Canvasのアスペクト比（高さ/幅）
  const canvasAspectRatio = canvasHeight / canvasWidth;
  
  if (isPortrait) {
    // 縦型カメラ映像の場合
    if (canvasAspectRatio > cameraAspectRatio) {
      // Canvasがより縦長の場合、幅に合わせる（アスペクト比を維持）
      drawWidth = canvasWidth;
      drawHeight = drawWidth * cameraAspectRatio;
      drawX = 0;
      drawY = (canvasHeight - drawHeight) / 2;
    } else {
      // Canvasがより横長の場合、高さに合わせる（アスペクト比を維持）
      drawHeight = canvasHeight;
      drawWidth = drawHeight / cameraAspectRatio;
      drawX = (canvasWidth - drawWidth) / 2;
      drawY = 0;
    }
  } else {
    // 横型カメラ映像の場合
    const cameraAspectRatioWidth = cameraAspectRatio; // width/height
    const canvasAspectRatioWidth = canvasWidth / canvasHeight; // width/height
    
    if (canvasAspectRatioWidth > cameraAspectRatioWidth) {
      // Canvasがより横長の場合、高さに合わせる（アスペクト比を維持）
      drawHeight = canvasHeight;
      drawWidth = drawHeight * cameraAspectRatioWidth;
      drawX = (canvasWidth - drawWidth) / 2;
      drawY = 0;
    } else {
      // Canvasがより縦長の場合、幅に合わせる（アスペクト比を維持）
      drawWidth = canvasWidth;
      drawHeight = drawWidth / cameraAspectRatioWidth;
      drawX = 0;
      drawY = (canvasHeight - drawHeight) / 2;
    }
  }
  
  offscreenCtx.drawImage(results.image, 0, 0, offscreenCanvas.width, offscreenCanvas.height);

  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    // 顔が検出されない場合は元の画像をそのまま表示
    canvasCtx.drawImage(offscreenCanvas, drawX, drawY, drawWidth, drawHeight);
    updateStatus("顔を検出できませんでした。カメラに顔を向けてください。");
    return;
  }

  const landmarks = results.multiFaceLandmarks[0];
  const mouthScaleMax = Number(mouthScaleInput.value);

  const elapsed = performance.now();
  // ユーザーが設定した周期を取得（秒単位からミリ秒に変換）
  const currentPeriod = Number(periodScaleInput.value) * 1000;
  // 周期内での進行度を計算（0から1まで）
  const progress = (elapsed % currentPeriod) / currentPeriod;
  
  let normalized;
  if (progress < OPEN_DURATION) {
    // 開く：0から1まで線形に増加
    normalized = progress / OPEN_DURATION;
  } else {
    // 閉じる：1から0までイージングを使って「ヒュンッ」と戻る
    const closeProgress = (progress - OPEN_DURATION) / (1 - OPEN_DURATION);
    // ease-outイージングを適用（最初は速く、最後は遅く）
    const eased = easeOutCubic(closeProgress);
    normalized = 1 - eased;
  }
  
  const forcedOpen = BASE_OPEN + normalized * (1 - BASE_OPEN);
  // 口の開け具合に関係なく、常に一定の開きを維持（アニメーション用）
  // 実際の口の開き具合は無視して、強制的に開いた状態を維持
  const openAmount = forcedOpen * mouthScaleMax;

  // drawMouthWarp内で元の画像全体を含むwarpedCanvasを描画するため、
  // ここでは元の画像を描画しない
  drawMouthWarp(landmarks, openAmount, drawX, drawY, drawWidth, drawHeight, results.image.width, results.image.height);

  updateStatus(`自動開閉中: 口の開き ${openAmount.toFixed(2)}x`);
});

const camera = new Camera(videoElement, {
  onFrame: async () => {
    await faceMesh.send({ image: videoElement });
  },
  width: 720,
  height: 1280, // 縦長（スマホ対応）
  facingMode: 'user', // フロントカメラを使用
});

// カメラ許可モーダルの制御（モーダルは表示しないが、エラー回避のため関数を定義）
const retryCameraBtn = document.getElementById('retryCameraBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const cameraPermissionModal = document.getElementById('cameraPermissionModal');

const hideCameraPermissionModal = () => {
  // モーダルは表示しないため、何もしない
};

// カメラ許可状態をチェック
const checkCameraPermission = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    // 許可が取れたらストリームを停止
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch (error) {
    console.error('カメラ許可エラー:', error);
    return false;
  }
};

// カメラ起動
const startCamera = async () => {
  try {
    await camera.start();
    updateStatus("カメラ起動中...口の自動開閉を確認してください。");
  } catch (error) {
    console.error('カメラ起動エラー:', error);
    updateStatus("カメラを起動できませんでした。権限を確認してください。");
  }
};

// 初回カメラ起動
startCamera();

// 再試行ボタン（存在する場合のみ）
if (retryCameraBtn) {
  retryCameraBtn.addEventListener('click', () => {
    hideCameraPermissionModal();
    startCamera();
  });
}

// 閉じるボタン（存在する場合のみ）
if (closeModalBtn) {
  closeModalBtn.addEventListener('click', () => {
    hideCameraPermissionModal();
  });
}

// モーダルのオーバーレイをクリックしても閉じる（存在する場合のみ）
if (cameraPermissionModal) {
  const overlay = cameraPermissionModal.querySelector('.modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', () => {
      hideCameraPermissionModal();
    });
  }
}

// フルスクリーン機能
const fullscreenBtn = document.querySelector('.fullscreen-btn');

// iOSを検出
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// モバイルデバイスを検出
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                 (window.innerWidth <= 768);

// フルスクリーンAPIが利用可能かチェック
const isFullscreenAPIAvailable = () => {
  return !!(document.fullscreenEnabled ||
            document.webkitFullscreenEnabled ||
            document.mozFullScreenEnabled ||
            document.msFullscreenEnabled);
};

// フルスクリーンAPIのベンダープレフィックス対応
const getFullscreenElement = () => {
  return document.fullscreenElement ||
         document.webkitFullscreenElement ||
         document.mozFullScreenElement ||
         document.msFullscreenElement ||
         null;
};

// CSSベースのフルスクリーン実装（iOS/モバイル用）
const enterFullscreenCSS = () => {
  // ステージを全画面表示
  stageElement.classList.add('fullscreen-mode');
  stageElement.style.position = 'fixed';
  stageElement.style.top = '50%';
  stageElement.style.left = '50%';
  stageElement.style.transform = 'translate(-50%, -50%)';
  stageElement.style.zIndex = '9999';
  stageElement.style.margin = '0';
  stageElement.style.borderRadius = '0';
  stageElement.style.maxWidth = '100vw';
  stageElement.style.maxHeight = '100vh';
  // widthとheightはJavaScriptで計算された値を維持（上書きしない）
  
  // bodyのスクロールを無効化
  document.body.style.overflow = 'hidden';
  
  // 画面の向きをロック（可能な場合）
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('portrait').catch(() => {
      // ロックに失敗しても続行
    });
  }
  
  // フルスクリーン状態が変わったので、サイズを再計算
  stageSizeInitialized = false;
  
  return Promise.resolve();
};

const exitFullscreenCSS = () => {
  // ステージを元に戻す
  stageElement.classList.remove('fullscreen-mode');
  stageElement.style.position = '';
  stageElement.style.top = '';
  stageElement.style.left = '';
  stageElement.style.transform = '';
  stageElement.style.zIndex = '';
  stageElement.style.margin = '';
  stageElement.style.borderRadius = '';
  stageElement.style.maxWidth = '';
  stageElement.style.maxHeight = '';
  // widthとheightはJavaScriptで計算された値を維持（上書きしない）
  
  // bodyのスクロールを有効化
  document.body.style.overflow = '';
  
  // 画面の向きのロックを解除
  if (screen.orientation && screen.orientation.unlock) {
    screen.orientation.unlock();
  }
  
  // 通常モードに戻ったので、サイズを再計算
  stageSizeInitialized = false;
  
  return Promise.resolve();
};

const requestFullscreen = (element) => {
  // iOSまたはモバイルでフルスクリーンAPIが利用できない場合はCSS実装を使用
  if (isIOS || (isMobile && !isFullscreenAPIAvailable())) {
    return enterFullscreenCSS();
  }
  
  // フルスクリーンAPIを試行
  if (element.requestFullscreen) {
    return element.requestFullscreen();
  } else if (element.webkitRequestFullscreen) {
    return element.webkitRequestFullscreen();
  } else if (element.mozRequestFullScreen) {
    return element.mozRequestFullScreen();
  } else if (element.msRequestFullscreen) {
    return element.msRequestFullscreen();
  } else {
    // APIが利用できない場合はCSS実装にフォールバック
    return enterFullscreenCSS();
  }
};

const exitFullscreen = () => {
  // CSS実装のフルスクリーン状態をチェック
  if (stageElement.classList.contains('fullscreen-mode')) {
    return exitFullscreenCSS();
  }
  
  // フルスクリーンAPIを試行
  if (document.exitFullscreen) {
    return document.exitFullscreen();
  } else if (document.webkitExitFullscreen) {
    return document.webkitExitFullscreen();
  } else if (document.mozCancelFullScreen) {
    return document.mozCancelFullScreen();
  } else if (document.msExitFullscreen) {
    return document.msExitFullscreen();
  } else {
    // APIが利用できない場合はCSS実装を解除
    return exitFullscreenCSS();
  }
};

const toggleFullscreen = async () => {
  const isFullscreen = !!getFullscreenElement() || 
                       stageElement.classList.contains('fullscreen-mode');
  
  if (!isFullscreen) {
    // フルスクリーンに入る
    try {
      await requestFullscreen(stageElement);
      updateFullscreenButton();
    } catch (error) {
      console.error('フルスクリーンに失敗しました:', error);
      updateStatus("フルスクリーンに失敗しました。");
    }
  } else {
    // フルスクリーンから出る
    try {
      await exitFullscreen();
      updateFullscreenButton();
    } catch (error) {
      console.error('フルスクリーン解除に失敗しました:', error);
      updateStatus("フルスクリーン解除に失敗しました。");
    }
  }
};

// フルスクリーンボタンのクリックイベント
fullscreenBtn.addEventListener('click', toggleFullscreen);

// フルスクリーン状態の変更を監視（ベンダープレフィックス対応）
const updateFullscreenButton = () => {
  const isFullscreen = !!getFullscreenElement() || 
                       stageElement.classList.contains('fullscreen-mode');
  
  if (isFullscreen) {
    fullscreenBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
      </svg>
    `;
    fullscreenBtn.setAttribute('aria-label', 'フルスクリーン解除');
    fullscreenBtn.setAttribute('title', 'フルスクリーン解除');
  } else {
    fullscreenBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3m0-18v3a2 2 0 0 1-2 2h-3m0 18h-3a2 2 0 0 1-2-2v-3"/>
      </svg>
    `;
    fullscreenBtn.setAttribute('aria-label', 'フルスクリーン');
    fullscreenBtn.setAttribute('title', 'フルスクリーン');
  }
  
  // フルスクリーン状態が変わったら、サイズを再計算
  stageSizeInitialized = false;
};

// 各ブラウザのフルスクリーン変更イベントを監視
document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
document.addEventListener('mozfullscreenchange', updateFullscreenButton);
document.addEventListener('MSFullscreenChange', updateFullscreenButton);

// キーボードショートカット（F11またはEsc）
document.addEventListener('keydown', (e) => {
  if (e.key === 'F11') {
    e.preventDefault();
    toggleFullscreen();
  }
});
