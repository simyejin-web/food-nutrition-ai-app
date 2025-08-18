// server.js — 메뉴명(김치찌개/불고기/갈비탕 등) 영양정보 조회
// 설치: npm i express axios

const express = require('express');
const axios   = require('axios');
const http    = require('http');
const https   = require('https');
const app = express();
const port = 3000;

/* ① 공공데이터포털 '일반 인증키(Decoding)'를 환경 변수에서 가져오기 */
const SERVICE_KEY = process.env.SERVICE_KEY; // 이 부분이 수정되었습니다!

/* ② 식약처(MFDS) 엔드포인트 (승인 화면의 버전: FoodNtrCpntDbInfo02) */
const MFDS_BASES = [
  'https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02',
  'http://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02', // 네트워크 환경에 따라 http가 더 잘될 수 있음
];
/* ③ 오퍼레이션 이름 — Swagger에서 확인: getFoodNtrCpntDbInq02 */
const MFDS_OPS = [
  'getFoodNtrCpntDbInq02',  // ← 네 스샷 기준 확정된 이름
  // 예비 후보(남겨둬도 무방):
  'getFoodNtrCpntDbInfoList2',
  'getFoodNtrCpntDbInfoList',
  'getFoodNtrCpntDbInfo',
  'getFoodNtrCpntDbInfoSearch',
];
/* axios 공통 */
const client = axios.create({
  headers: { Accept: 'application/json', 'User-Agent': 'nutrition-proxy/menu/1.4' },
  httpAgent:  new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
  maxRedirects: 5,
  validateStatus: () => true,
});
/* 유틸 */
const toList = (n) => Array.isArray(n) ? n
  : Array.isArray(n?.item) ? n.item
  : n?.item ? [n.item]
  : n ? [n] : [];

const norm = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/[()\[\]{}·・ㆍ’'"\s]/g, '');
function bestName(r){ return r.FOOD_NM_KR ?? r.DESC_KOR ?? r.desc_kor ?? r.foodNm ?? r.식품명 ?? ''; }
function scoreName(name, qn){
  const nn = norm(name);
  if (nn === qn) return 0;
  if (nn.startsWith(qn)) return 1;
  if (nn.endsWith(qn)) return 2;
  if (nn.includes(qn)) return 3;
  return 9 + Math.abs(nn.length - qn.length) * 0.01;
}
function extractNutri(r){
  const pick=(...ks)=>{ for(const k of ks){ if(r?.[k]!=null && String(r[k]).trim()!=='') return r[k]; } };
  return {
    // 양쪽 스키마를 모두 커버(키 이름이 데이터셋에 따라 약간씩 달라짐)
    kcal:    pick('ENERC_KCAL','NUTR_CONT1','kcal','ENERGY_KCAL'),
    carb:    pick('CHOCDF','NUTR_CONT2','CARB'),
    protein: pick('PROCNT','PROT','NUTR_CONT3'),
    fat:     pick('FATCE','FAT','NUTR_CONT4'),
    sugar:   pick('SUGAR','SUGARS','NUTR_CONT5'),
    sodium:  pick('NA','SODIUM','NUTR_CONT6'),
  };
}
const hasNutri = (r)=>Object.values(extractNutri(r)).some(v=>v!=null && String(v).trim()!=='');
/* MFDS 호출 — 메뉴 한글명 파라미터는 'FOOD_NM_KR' */
async function mfdsFetch(foodNameKr){
  const qs = new URLSearchParams({
    serviceKey: SERVICE_KEY,  // Decoding 키!
    type: 'json',             // Swagger 기본은 xml → 반드시 json 지정
    FOOD_NM_KR: foodNameKr,   // ★ 핵심: desc_kor가 아니라 FOOD_NM_KR
    pageNo: '1',
    numOfRows: '50',
  }).toString();
  for (const base of MFDS_BASES) {
    for (const op of MFDS_OPS) {
      const url = `${base}/${op}?${qs}`;
      console.log('MFDS TRY →', url.replace(SERVICE_KEY, '<KEY>'));
      const r = await client.get(url, { timeout: 20000 });

      const items = Array.isArray(r.data?.body?.items) ? r.data.body.items
        : Array.isArray(r.data?.body?.items?.item) ? r.data.body.items.item
        : r.data?.body?.items ? [r.data.body.items] : [];

      if (r.status === 200 && items.length) {
        console.log(`MFDS OK: ${items.length} item(s)`);
        return items;
      }
    }
  }
  return [];
}

/* CORS */
app.use((_, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});
/* 라우트 */
app.get('/api/nutrition', async (req, res) => {
  const q = (req.query.foodName || '').trim();
  if (!q) return res.status(400).json({ error: 'foodName 쿼리 파라미터가 필요합니다.' });

  console.log(`➡️ /api/nutrition q="${q}"`);
  const qn = norm(q);

  try {
    const items = await mfdsFetch(q);

    if (!items.length) {
      return res.status(200).json({
        response: { header: { resultCode: '00', resultMsg: 'NO_MATCH' }, body: { items: [], totalCount: 0 } },
        note: { hint: "오퍼레이션명(getFoodNtrCpntDbInq02)과 'FOOD_NM_KR' 파라미터, Decoding 키를 확인하세요." }
      });
    }

    // 영양성분 있는 항목 우선 + 이름 유사도 정렬
    const strong = items.filter(hasNutri);
    const pool   = strong.length ? strong : items;

    pool.sort((a, b) => {
      const sa = scoreName(bestName(a), qn);
      const sb = scoreName(bestName(b), qn);
      if (sa !== sb) return sa - sb;
      return Math.abs((bestName(a)||'').length - q.length) - Math.abs((bestName(b)||'').length - q.length);
    });
    const top = pool.slice(0, 10);
    return res.status(200).json({
      response: { header: { resultCode: '00', resultMsg: 'OK' }, body: { items: top, totalCount: top.length } },
      note: { source: strong.length ? 'MFDS (nutrients present)' : 'MFDS (any)' }
    });
  } catch (e) {
    console.error('[ERR /api/nutrition]', e.message);
    return res.status(200).json({
      response: { header: { resultCode: '99', resultMsg: 'UPSTREAM_UNAVAILABLE' }, body: { items: [], totalCount: 0 } },
      note: { reason: e.message || 'unknown' }
    });
  }
});

/* 서버 시작 */
app.listen(port, () => {
  console.log(`✅ 프록시 서버가 http://localhost:${port} 에서 실행 중입니다.`);
});
