// 모델 위치 설정 (model 폴더 안에)
const URL = "./model/"; // 실제 모델 파일이 위치한 경로를 정확히 지정하세요.
let model, webcam, maxPredictions;
let isWebcamPlaying = false; // 웹캠 재생 상태를 추적하는 변수
let animationFrameId; // loop 함수의 requestAnimationFrame ID 저장

// 영양 정보 (1인분 기준, 단위: kcal, g) - 필요에 따라 더 많은 음식 추가
const nutritionData = {
    "김치찌개": { calories: 150, carbs: 10, protein: 12, fat: 8 },
    "부대찌개": { calories: 350, carbs: 20, protein: 18, fat: 25 },
    "순두부찌개": { calories: 200, carbs: 5, protein: 14, fat: 15 },
    "갈비탕": { calories: 300, carbs: 8, protein: 25, fat: 20 },
    "비빔밥": { calories: 500, carbs: 65, protein: 15, fat: 10 },
    "떡볶이": { calories: 400, carbs: 70, protein: 8, fat: 7 },
    "된장찌개": { calories: 180, carbs: 12, protein: 10, fat: 9 },
    "잡채": { calories: 320, carbs: 45, protein: 10, fat: 12 },
    "제육볶음": { calories: 420, carbs: 15, protein: 25, fat: 30 },
    "불고기": { calories: 380, carbs: 20, protein: 22, fat: 22 },
    // 여기에 더 많은 음식 데이터를 추가할 수 있습니다.
};

// HTML 요소 가져오기
const imageUpload = document.getElementById('imageUpload');
const processUploadBtn = document.getElementById('processUploadBtn'); // 새로 정의된 버튼 ID
const uploadedImagePreview = document.getElementById('uploadedImagePreview');
const fileNameDisplay = document.getElementById('fileNameDisplay'); // 파일명 표시용 span
const webcamVideo = document.getElementById('webcam'); 
const webcamCanvas = document.getElementById('webcamCanvas'); 
const webcamPlaceholder = document.getElementById('webcamPlaceholder');
const resultDiv = document.getElementById("result");
const nutritionInfoDiv = document.getElementById("nutritionInfo");

// 파일 미리보기 데이터를 저장할 변수
let selectedFileBase64 = null; 

// 페이지 로딩 후 실행
window.onload = async () => {
    // "사진 찍기" 버튼 클릭 이벤트 리스너
    document.getElementById("capture").addEventListener("click", () => {
        if (!webcam || !isWebcamPlaying) {
            initWebcamAndPredict();
        } else {
            captureAndPredict();
        }
    });

    // "영양정보 보기" 버튼 클릭 이벤트 리스너 (수동 입력)
    document.getElementById("searchBtn").addEventListener("click", () => {
        const foodName = document.getElementById("manualInput").value.trim();
        showNutrition(foodName);
    });

    // ***** 이미지 파일 선택 시 동작 (input file의 change 이벤트) *****
    imageUpload.addEventListener('change', function(event) {
        if (event.target.files && event.target.files[0]) {
            const file = event.target.files[0];
            fileNameDisplay.innerText = file.name; // 파일 이름 표시
            
            const reader = new FileReader();
            reader.onload = function(e) {
                // 이미지 미리보기 표시 (아직 예측은 하지 않음, 데이터만 저장)
                uploadedImagePreview.innerHTML = `<img src="${e.target.result}" alt="업로드된 이미지">`;
                selectedFileBase64 = e.target.result; // 나중에 예측에 사용할 데이터를 저장
            };
            reader.readAsDataURL(file);
        } else {
            fileNameDisplay.innerText = "선택된 파일 없음"; // 파일 선택 취소 시
            uploadedImagePreview.innerHTML = ""; // 미리보기 초기화
            selectedFileBase64 = null; // 데이터 초기화
        }
    });

    // ***** "이미지 업로드" (실제 분석 시작) 버튼 클릭 시 동작 *****
    processUploadBtn.addEventListener('click', async () => {
        if (!selectedFileBase64) {
            resultDiv.innerHTML = "⚠️ 먼저 파일을 선택해주세요.";
            resultDiv.classList.add('warning');
            nutritionInfoDiv.innerHTML = "";
            return;
        }

        // 웹캠이 켜져 있다면 끄기
        if (webcam && isWebcamPlaying) {
            stopWebcam();
        }

        resultDiv.innerText = "업로드된 이미지를 분석 중입니다...";
        resultDiv.classList.remove('warning');
        nutritionInfoDiv.innerHTML = "";

        const img = new Image();
        img.onload = function() {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = 300; 
            tempCanvas.height = 225;
            const ctx = tempCanvas.getContext('2d');
            
            // 이미지 비율 유지하면서 캔버스에 그리기
            const scale = Math.min(tempCanvas.width / img.width, tempCanvas.height / img.height);
            const x = (tempCanvas.width / 2) - (img.width / 2) * scale;
            const y = (tempCanvas.height / 2) - (img.height / 2) * scale;
            ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

            predictImage(tempCanvas); // 캔버스 요소를 predictImage에 전달
        };
        img.src = selectedFileBase64; // 저장해둔 Base64 데이터를 사용하여 이미지 로드
    });

    // 페이지 로드 시 모델 미리 로드
    await loadModel();
    // resultDiv의 초기 메시지는 index.html에서 직접 설정되었으므로 여기서는 주석 처리
    // resultDiv.innerHTML = "환영합니다!<br>카메라 또는 이미지 업로드로 음식을 인식해보세요."; 
};

/**
 * @brief Teachable Machine 모델을 로드하는 함수
 */
async function loadModel() {
    try {
        const modelURL = URL + "model.json";
        const metadataURL = URL + "metadata.json";
        model = await tmImage.load(modelURL, metadataURL);
        maxPredictions = model.getTotalClasses();
    } catch (error) {
        resultDiv.innerHTML = "모델 로드에 실패했습니다. <br> 모델 파일 경로를 확인해주세요. <br>" + error.message;
        resultDiv.classList.add('warning');
    }
}

/**
 * @brief 웹캠을 초기화하고 재생을 시작하는 함수
 */
async function initWebcamAndPredict() {
    try {
        if (!webcam) {
            const flip = true;
            webcam = new tmImage.Webcam(300, 225, flip); 
            await webcam.setup();
            webcamVideo.srcObject = webcam.webcam.stream;
        }
        await webcam.play();
        isWebcamPlaying = true;
        animationFrameId = window.requestAnimationFrame(loop); 

        resultDiv.innerHTML = "웹캠이 활성화되었습니다. <br> 음식을 카메라에 비추고 <br> '사진 찍기'를 눌러주세요.";
        resultDiv.classList.remove('warning');
        nutritionInfoDiv.innerHTML = "";
        uploadedImagePreview.innerHTML = "";
        fileNameDisplay.innerText = "선택된 파일 없음"; // 웹캠 켜면 파일 선택 상태 초기화

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

/**
 * @brief 웹캠 스트림과 loop를 완전히 중지하는 함수
 */
function stopWebcam() {
    if (webcam && webcam.webcam && webcam.webcam.stream) {
        if (webcam.webcam.stream.active) { 
            webcam.webcam.stream.getTracks().forEach(track => track.stop());
        }
        webcamVideo.srcObject = null;
        webcam.stop();
        isWebcamPlaying = false;
        window.cancelAnimationFrame(animationFrameId);
        webcamCanvas.getContext('2d').clearRect(0, 0, webcamCanvas.width, webcamCanvas.height);
        webcamCanvas.style.display = 'none';
        webcamVideo.style.display = 'none';
        webcamPlaceholder.style.display = 'block';
    }
}

/**
 * @brief 웹캠의 현재 프레임을 canvas에 계속 그리는 루프 함수 (실시간 미리보기용)
 */
async function loop() {
    webcam.update();
    const ctx = webcamCanvas.getContext("2d");
    ctx.drawImage(webcam.webcam, 0, 0, webcamCanvas.width, webcamCanvas.height);
    if (isWebcamPlaying) { 
        animationFrameId = window.requestAnimationFrame(loop);
    }
}

/**
 * @brief "사진 찍기" 버튼 클릭 시 호출되어 현재 웹캠 프레임을 캡처하고 예측을 수행하는 함수
 */
async function captureAndPredict() {
    if (!webcam || !isWebcamPlaying) {
        resultDiv.innerHTML = "웹캠이 활성화되지 않았습니다. <br> '사진 찍기'를 다시 눌러주세요.";
        resultDiv.classList.add('warning');
        nutritionInfoDiv.innerHTML = "";
        return;
    }

    resultDiv.innerText = "사진을 분석 중입니다...";
    resultDiv.classList.remove('warning');
    nutritionInfoDiv.innerHTML = "";

    try {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = webcamCanvas.width;
        tempCanvas.height = webcamCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(webcam.webcam, 0, 0, tempCanvas.width, tempCanvas.height);

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
            showNutrition(foodName);
        }
    } catch (error) {
        console.error("사진 분석 중 오류 발생:", error);
        resultDiv.innerHTML = "사진 분석 중 오류가 발생했습니다. <br> 다시 시도해주세요.";
        resultDiv.classList.add('warning');
        nutritionInfoDiv.innerHTML = "";
    }
}

/**
 * @brief 이미지 파일로 예측을 수행하는 함수 (업로드된 이미지용)
 * @param {HTMLImageElement|HTMLCanvasElement} imageElement - 예측에 사용할 이미지 또는 캔버스 요소
 */
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
            showNutrition(foodName);
        }
    } catch (error) {
        console.error("이미지 예측 중 오류 발생:", error);
        resultDiv.innerHTML = "이미지 예측 중 오류가 발생했습니다. <br> 모델이 올바른지 확인해주세요.";
        resultDiv.classList.add('warning');
        nutritionInfoDiv.innerHTML = "";
    }
}

/**
 * @brief 음식 이름을 기반으로 영양 정보를 표시하는 함수
 * @param {string} foodName - 영양 정보를 조회할 음식 이름
 */
function showNutrition(foodName) {
    const data = nutritionData[foodName];

    if (data) {
        nutritionInfoDiv.innerHTML = `
            <h3>🥗 ${foodName}의 영양 정보 (1인분 기준)</h3>
            <ul>
                <li><strong>칼로리:</strong> ${data.calories} kcal</li>
                <li><strong>탄수화물:</strong> ${data.carbs} g</li>
                <li><strong>단백질:</strong> ${data.protein} g</li>
                <li><strong>지방:</strong> ${data.fat} g</li>
            </ul>
        `;
    } else {
        nutritionInfoDiv.innerHTML = `<p style="text-align: center;">해당 음식의 영양 정보를 찾을 수 없습니다 😢</p>`;
    }
}