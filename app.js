// ===== Teachable Machine 모델 경로 =====
const URL = "./model/"; // model.json / metadata.json 이 있는 폴더
const BACKEND_URL = "https://food-nutrition-ai-app.onrender.com"; // 이 줄이 추가되었습니다!

let model, maxPredictions;
let webcam, isWebcamPlaying = false, animationFrameId;

// ===== DOM =====
const imageUpload = document.getElementById('imageUpload');
const processUploadBtn = document.getElementById('processUploadBtn');
const uploadedImagePreview = document.getElementById('uploadedImagePreview');
const fileNameDisplay = document.getElementById('fileNameDisplay');

const webcamVideo = document.getElementById('webcam');
const webcamCanvas = document.getElementById('webcamCanvas');
const webcamPlaceholder = document.getElementById('webcamPlaceholder');
const resultDiv = document.getElementById("result");
const nutritionInfoDiv = document.getElementById("nutritionInfo");

const captureBtn = document.getElementById("capture");
const searchBtn = document.getElementById("searchBtn");
const manualInput = document.getElementById("manualInput");
// 미리보기 데이터
let selectedFileBase64 = null;

// ===== 유틸: 숫자 포맷 =====
const nfmt = (v, unit = "") => {
  if (v === undefined || v === null || String(v).trim() === "")
    return `정보 없음${unit ? ` ${unit}` : ""}`;
  const num = Number(String(v).replace(/,/g, ""));
  return Number.isNaN(num) ? `${v}${unit ? ` ${unit}` : ""}` : `${num}${unit ? ` ${unit}` : ""}`;
};
// ===== API 파싱: 이름/영양소 추출 =====
const pickName = (it) =>
  it.foodNm ?? it.food_nm ??
  it.DESC_KOR ?? it.desc_kor ??
  it.FOOD_NM_KR ?? it.food_nm_kr ??
  it.FOOD_NAME ?? it.food_name ??
  it.PRDLST_NM ?? it.prdlst_nm ?? "정보 없음";
// 1) 표준 키 기반
function pickNutriByNames(it) {
  const get = (...keys) => {
    for (const k of keys) {
      if (it[k] !== undefined && it[k] !== null && String(it[k]).trim() !== "") return it[k];
    }
    return undefined;
  };
  return {
    kcal:    get("NUTR_CONT1","nutr_cont1","ENERC_KCAL","ENERGY_KCAL","KCAL","calorie","ENERC","enerc","energy","kcal"),
    carb:    get("NUTR_CONT2","nutr_cont2","CARB","CARBOHYDRATE","CHOAVL","CHO","CHOCDF","chocdf"),
    protein: get("NUTR_CONT3","nutr_cont3","PROTEIN","PROCNT","PROT","prot"),
    fat:     get("NUTR_CONT4","nutr_cont4","FAT","FATCE","fatce"),
    sugar:   get("NUTR_CONT5","nutr_cont5","SUGARS","SUGAR","sugar"),
    sodium:  get("NUTR_CONT6","nutr_cont6","SODIUM","NA","nat"),
  };
}

// 2) 식약처 DB Inq02 스타일(AMT_NUM*) — 추정 매핑
const AMT_INDEX = { kcal: 1, carb: 3, protein: 4, fat: 5, sugar: 7, sodium: 12 };
function pickNutriByAmt(it) {
  const read = (idx) => it[`AMT_NUM${idx}`] ?? it[`AMT_NUM${String(idx).padStart(2,"0")}`];
  return {
    kcal:    read(AMT_INDEX.kcal),
    carb:    read(AMT_INDEX.carb),
    protein: read(AMT_INDEX.protein),
    fat:     read(AMT_INDEX.fat),
    sugar:   read(AMT_INDEX.sugar),
    sodium:  read(AMT_INDEX.sodium),
  };
}

// 통합 추출
function pickNutri(it) {
  const byNames = pickNutriByNames(it);
  const hasByNames = Object.values(byNames).some(v => v !== undefined && String(v).trim() !== "");
  if (hasByNames) return byNames;
  const hasAmt = Object.keys(it).some(k => /^AMT_NUM\d+$/i.test(k));
  if (hasAmt) return pickNutriByAmt(it);
  // 마지막 휴리스틱 (키에 단서가 있는 AMT_*)
  const keys = Object.keys(it || {});
  const findAmt = (re) => {
    const k = keys.find((kk) => re.test(kk) && it[kk] != null && String(it[kk]).trim() !== "");
    return k ? it[k] : undefined;
  };
  return {
    kcal:   findAmt(/^AMT_.*(K?CAL|ENERC)/i),
    carb:   findAmt(/^AMT_.*(CARB|CHO)/i),
    protein:findAmt(/^AMT_.*PROT/i),
    fat:    findAmt(/^AMT_.*FAT/i),
    sugar:  findAmt(/^AMT_.*SUGAR/i),
    sodium: findAmt(/^AMT_.*(NA|SOD)/i),
  };
}
const hasAnyNutri = (n) => Object.values(n).some(v => v !== undefined && String(v).trim() !== "");
// ===== API 호출 =====
async function fetchNutrition(foodName) {
  // 이 부분이 수정되었습니다!
  const res = await fetch(`${BACKEND_URL}/api/nutrition?foodName=${encodeURIComponent(foodName)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ===== 렌더링 =====
function renderItem(item) {
  const name = pickName(item);
  const n = pickNutri(item);
  const serving = item.SERVING_SIZE || item.serving_size || item.SERVING_SIZE_DESC || "100 g";
  // 디버깅 원하면 주석 해제
  // console.log("[RAW]", item);
  // console.log("[NUTRI]", n, "serving:", serving);
  nutritionInfoDiv.innerHTML = `
    <div class="card">
      <h3>🥗 ${name}</h3>
      <p class="muted">기준: ${serving}</p>
      <ul class="nutri-list">
        <li><strong>칼로리:</strong> ${nfmt(n.kcal, "kcal")}</li>
        <li><strong>탄수화물:</strong> ${nfmt(n.carb, "g")}</li>
        <li><strong>단백질:</strong> ${nfmt(n.protein, "g")}</li>
        <li><strong>지방:</strong> ${nfmt(n.fat, "g")}</li>
        <li><strong>당류:</strong> ${nfmt(n.sugar, "g")}</li>
        <li><strong>나트륨:</strong> ${nfmt(n.sodium, "mg")}</li>
      </ul>
    </div>
   `;
}

async function doSearch(foodName) {
  resultDiv.textContent = `🔎 "${foodName}" 조회 중...`;
  nutritionInfoDiv.innerHTML = "";
  try {
    const json = await fetchNutrition(foodName);
    let items = json?.response?.body?.items ?? [];
    if (!Array.isArray(items)) items = items ? [items] : [];
    if (!items.length) {
      const msg = json?.response?.header?.resultMsg || "해당 음식의 영양 정보를 찾을 수 없습니다.";
      resultDiv.textContent = `😢 ${msg}`;
      return;
    }
    const picked = items.find((it) => hasAnyNutri(pickNutri(it))) || items[0];
    renderItem(picked);
    resultDiv.textContent = "✅ 결과를 찾았습니다!";
  } catch (err) {
    console.error("❌ 프록시 호출 실패:", err);
    resultDiv.textContent = "데이터 호출 중 오류가 발생했습니다.";
  }
}

// ====== TM 모델 ======
async function loadModel() {
  try {
    model = await tmImage.load(URL + "model.json", URL + "metadata.json");
    maxPredictions = model.getTotalClasses();
  } catch (error) {
    resultDiv.innerHTML = "모델 로드에 실패했습니다. <br> 모델 파일 경로를 확인해주세요. <br>" + error.message;
    resultDiv.classList.add('warning');
  }
}

// ====== 웹캠 ======
async function initWebcamAndPredict() {
  try {
    if (!webcam) {
      const flip = true;
      webcam = new tmImage.Webcam(300, 225, flip);
      await webcam.setup(); // 권한요청
      webcamVideo.srcObject = webcam.webcam.stream;
    }
    await webcam.play();
    isWebcamPlaying = true;
    animationFrameId = window.requestAnimationFrame(loop);
    resultDiv.innerHTML = "웹캠이 활성화되었습니다. <br> 음식을 비추고 '사진 찍기'를 다시 눌러주세요.";
    resultDiv.classList.remove('warning');
    nutritionInfoDiv.innerHTML = "";
    uploadedImagePreview.innerHTML = "";
    fileNameDisplay.innerText = "선택된 파일 없음";

    webcamCanvas.style.display = 'block';
    webcamVideo.style.display = 'block';
    webcamPlaceholder.style.display = 'none';
  } catch (error) {
    console.error("웹캠 초기화 실패:", error);
    resultDiv.innerHTML = "⚠️ 웹캠 초기화에 실패했습니다. <br> 카메라 권한을 허용했는지 확인하거나 <br> 다른 카메라를 시도해주세요.";
    resultDiv.classList.add('warning');
    webcamCanvas.style.display = 'none';
    webcamVideo.style.display = 'none';
    webcamPlaceholder.style.display = 'block';
  }
}

function stopWebcam() {
  if (webcam && webcam.webcam && webcam.webcam.stream) {
    if (webcam.webcam.stream.active) {
      webcam.webcam.stream.getTracks().forEach(track => track.stop());
    }
    webcamVideo.srcObject = null;
    webcam.stop();
    isWebcamPlaying = false;
    window.cancelAnimationFrame(animationFrameId);
    const ctx = webcamCanvas.getContext('2d');
    ctx.clearRect(0, 0, webcamCanvas.width, webcamCanvas.height);
    webcamCanvas.style.display = 'none';
    webcamVideo.style.display = 'none';
    webcamPlaceholder.style.display = 'block';
  }
}

async function loop() {
  webcam.update();
  const ctx = webcamCanvas.getContext("2d");
  ctx.drawImage(webcam.webcam, 0, 0, webcamCanvas.width, webcamCanvas.height);
  if (isWebcamPlaying) {
    animationFrameId = window.requestAnimationFrame(loop);
  }
}

async function captureAndPredict() {
  if (!webcam || !isWebcamPlaying) {
    // 처음 누르면 웹캠 켜기
    await initWebcamAndPredict();
    return;
  }

  resultDiv.innerText = "사진을 분석 중입니다...";
  resultDiv.classList.remove('warning');
  nutritionInfoDiv.innerHTML = "";
  try {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = webcamCanvas.width || 300;
    tempCanvas.height = webcamCanvas.height || 225;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(webcam.webcam, 0, 0, tempCanvas.width, tempCanvas.height);

    if (!model) await loadModel();
    const prediction = await model.predict(tempCanvas);
    prediction.sort((a, b) => b.probability - a.probability);

    const top = prediction[0];
    const foodName = top.className;
    const probability = (top.probability * 100).toFixed(1);
    if (top.probability < 0.85) {
      resultDiv.innerHTML = "⚠️ 음식이 정확히 인식되지 않았습니다. <br> 다시 시도해 주세요.";
      resultDiv.classList.add('warning');
      nutritionInfoDiv.innerHTML = "";
    } else {
      resultDiv.innerText = `🤖 ${foodName} (${probability}%)`;
      resultDiv.classList.remove('warning');
      await doSearch(foodName);
    }
  } catch (error) {
    console.error("사진 분석 중 오류 발생:", error);
    resultDiv.innerHTML = "사진 분석 중 오류가 발생했습니다. <br> 다시 시도해주세요.";
    resultDiv.classList.add('warning');
    nutritionInfoDiv.innerHTML = "";
  }
}

// ====== 업로드 예측 ======
async function predictImage(imageElement) {
  if (!model) {
    resultDiv.innerHTML = "모델이 로드되지 않았습니다. <br> 잠시 후 다시 시도해주세요.";
    resultDiv.classList.add('warning');
    return;
  }
  try {
    const prediction = await model.predict(imageElement);
    prediction.sort((a, b) => b.probability - a.probability);
    const top = prediction[0];
    const foodName = top.className;
    const probability = (top.probability * 100).toFixed(1);
    if (top.probability < 0.85) {
      resultDiv.innerHTML = "⚠️ 음식이 정확히 인식되지 않았습니다. <br> 다른 이미지를 시도해 주세요.";
      resultDiv.classList.add('warning');
      nutritionInfoDiv.innerHTML = "";
    } else {
      resultDiv.innerText = `🤖 ${foodName} (${probability}%)`;
      resultDiv.classList.remove('warning');
      await doSearch(foodName);
    }
  } catch (error) {
    console.error("이미지 예측 중 오류 발생:", error);
    resultDiv.innerHTML = "이미지 예측 중 오류가 발생했습니다. <br> 모델이 올바른지 확인해주세요.";
    resultDiv.classList.add('warning');
    nutritionInfoDiv.innerHTML = "";
  }
}

// ====== 초기 바인딩 ======
window.onload = async () => {
  // 사진 찍기
  captureBtn.addEventListener("click", () => {
    if (!webcam || !isWebcamPlaying) initWebcamAndPredict();
    else captureAndPredict();
  });
  // 수동 검색
  searchBtn.addEventListener("click", () => {
    const foodName = manualInput.value.trim();
    if (!foodName) {
      resultDiv.innerHTML = "⚠️ 음식 이름을 입력해 주세요.";
      resultDiv.classList.add('warning');
      nutritionInfoDiv.innerHTML = "";
      return;
    }
    doSearch(foodName);
  });
  // 파일 선택 미리보기
  imageUpload.addEventListener('change', (event) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      fileNameDisplay.innerText = file.name;

      const reader = new FileReader();
      reader.onload = function(e) {
        uploadedImagePreview.innerHTML = `<img src="${e.target.result}" alt="업로드된 이미지">`;
        selectedFileBase64 = e.target.result;
      };
      reader.readAsDataURL(file);
    } else {
      fileNameDisplay.innerText = "선택된 파일 없음";
      uploadedImagePreview.innerHTML = "";
      selectedFileBase64 = null;
    }
  });
  // 이미지 업로드(분석 시작)
  processUploadBtn.addEventListener('click', async () => {
    if (!selectedFileBase64) {
      resultDiv.innerHTML = "⚠️ 먼저 파일을 선택해주세요.";
      resultDiv.classList.add('warning');
      nutritionInfoDiv.innerHTML = "";
      return;
    }

    // 웹캠이 켜져 있으면 끄기
    if (webcam && isWebcamPlaying) stopWebcam();

    resultDiv.innerText = "업로드된 이미지를 분석 중입니다...";
    resultDiv.classList.remove('warning');
    nutritionInfoDiv.innerHTML = "";

    const img = new Image();
    img.onload = async function() {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 300;
      tempCanvas.height = 225;
      const ctx = tempCanvas.getContext('2d');

      const scale = Math.min(tempCanvas.width / img.width, tempCanvas.height / img.height);
      const x = (tempCanvas.width / 2) - (img.width / 2) * scale;
      const y = (tempCanvas.height / 2) - (img.height / 2) * scale;
      ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
      if (!model) await loadModel();
      await predictImage(tempCanvas);
    };
    img.src = selectedFileBase64;
  });

  // 모델 미리 로드
  await loadModel();
};

