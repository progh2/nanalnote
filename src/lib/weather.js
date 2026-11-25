// 서울 기준 그날 날씨 (Open-Meteo, 키 없이 쓰는 공개 API — 고정 좌표만 보내고 기록 내용은 보내지 않는다)
// 최근·앞으로 16일은 예보 API, 그보다 지난 날은 과거 관측 API. 지난 날은 바뀌지 않으므로 브라우저에 보관한다.

const LAT = 37.5665, LON = 126.978;
const CACHE_KEY = 'sn:weather';
const mem = new Map();

/** WMO 날씨 코드 → [아이콘, 설명] */
export function describe(code) {
  if (code == null) return ['', ''];
  if (code === 0) return ['☀️', '맑음'];
  if (code <= 2) return ['🌤️', '구름 조금'];
  if (code === 3) return ['☁️', '흐림'];
  if (code === 45 || code === 48) return ['🌫️', '안개'];
  if (code >= 51 && code <= 57) return ['🌦️', '이슬비'];
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['🌧️', '비'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['🌨️', '눈'];
  if (code >= 95) return ['⛈️', '뇌우'];
  return ['🌥️', ''];
}

const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}

/** date(YYYY-MM-DD)의 서울 날씨 { code, max, min, rain(%)|null, mm|null } — 알 수 없으면 null */
export async function seoulWeather(date, today, fetcher = fetch) {
  const diff = dayDiff(date, today);
  if (diff > 15) return null;
  const past = diff < -3; // 사흘보다 지난 날은 값이 굳었다고 보고 보관
  if (past) {
    const c = loadCache()[date];
    if (c) return c;
  }
  const key = `${date}|${today}`;
  if (!mem.has(key)) mem.set(key, fetchDay(date, diff, fetcher).catch(() => { mem.delete(key); return null; }));
  const w = await mem.get(key);
  if (w && past) {
    const all = loadCache();
    all[date] = w;
    const keys = Object.keys(all).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete all[k];
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(all)); } catch { /* 저장 공간 부족은 무시 */ }
  }
  return w;
}

async function fetchDay(date, diff, fetcher) {
  const forecast = diff >= -60;
  const base = forecast ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
  const extra = forecast ? 'precipitation_probability_max,precipitation_sum' : 'precipitation_sum';
  const url = `${base}?latitude=${LAT}&longitude=${LON}&daily=weather_code,temperature_2m_max,temperature_2m_min,${extra}`
    + `&timezone=Asia%2FSeoul&start_date=${date}&end_date=${date}`;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const d = (await res.json()).daily || {};
  const code = d.weather_code?.[0];
  if (code == null) return null;
  return {
    code,
    max: d.temperature_2m_max?.[0] ?? null,
    min: d.temperature_2m_min?.[0] ?? null,
    rain: diff >= 0 ? (d.precipitation_probability_max?.[0] ?? null) : null,
    mm: d.precipitation_sum?.[0] ?? null,
  };
}

/** 한 줄 글: "☀️ 맑음 -4° / 6° · 비 30%" */
export function weatherText(w) {
  if (!w) return '';
  const [icon, label] = describe(w.code);
  const t = (v) => (v == null ? '–' : `${Math.round(v)}°`);
  let s = `${icon} ${label} ${t(w.min)} / ${t(w.max)}`;
  if (w.rain != null && w.rain >= 20) s += ` · 비 ${w.rain}%`;
  else if (w.rain == null && w.mm != null && w.mm >= 1) s += ` · 강수 ${Math.round(w.mm * 10) / 10}mm`;
  return s.replace(/\s+/g, ' ').trim();
}
