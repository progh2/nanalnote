// 특일 정보(국경일·공휴일·기념일·24절기)
// 내장 데이터 (양력 고정 국경일/기념일 + 2025~2030 음력 공휴일 + 24절기 근사일)
// (getMonth 의 fetcher 를 넘기면 외부 API 를 우선 쓰도록 되어 있다)

import { pad } from './util.js';

const FIXED = [
  ['01-01', '신정', true], ['03-01', '삼일절', true], ['04-05', '식목일', false],
  ['04-19', '4·19혁명 기념일', false], ['04-20', '장애인의 날', false], ['04-21', '과학의 날', false],
  ['05-01', '근로자의 날', false], ['05-05', '어린이날', true], ['05-08', '어버이날', false],
  ['05-15', '스승의 날', false], ['05-18', '5·18민주화운동 기념일', false], ['06-06', '현충일', true],
  ['06-25', '6·25전쟁일', false], ['07-17', '제헌절', false], ['08-15', '광복절', true],
  ['10-01', '국군의 날', false], ['10-03', '개천절', true], ['10-09', '한글날', true],
  ['10-25', '독도의 날', false], ['11-03', '학생독립운동 기념일', false], ['12-25', '기독탄신일', true],
];

// 음력 공휴일 및 대체공휴일 (내장)
const LUNAR = {
  2025: [['01-28', '설날 연휴'], ['01-29', '설날'], ['01-30', '설날 연휴'], ['03-03', '대체공휴일(삼일절)'], ['05-05', '부처님오신날'], ['05-06', '대체공휴일'], ['10-05', '추석 연휴'], ['10-06', '추석'], ['10-07', '추석 연휴'], ['10-08', '대체공휴일']],
  2026: [['02-16', '설날 연휴'], ['02-17', '설날'], ['02-18', '설날 연휴'], ['03-02', '대체공휴일(삼일절)'], ['05-24', '부처님오신날'], ['05-25', '대체공휴일'], ['06-03', '전국동시지방선거'], ['08-17', '대체공휴일(광복절)'], ['09-24', '추석 연휴'], ['09-25', '추석'], ['09-26', '추석 연휴'], ['10-05', '대체공휴일(개천절)']],
  2027: [['02-06', '설날 연휴'], ['02-07', '설날'], ['02-08', '설날 연휴'], ['02-09', '대체공휴일'], ['05-13', '부처님오신날'], ['08-16', '대체공휴일(광복절)'], ['09-14', '추석 연휴'], ['09-15', '추석'], ['09-16', '추석 연휴'], ['10-04', '대체공휴일(개천절)'], ['10-11', '대체공휴일(한글날)']],
  2028: [['01-26', '설날 연휴'], ['01-27', '설날'], ['01-28', '설날 연휴'], ['05-02', '부처님오신날'], ['10-02', '추석 연휴'], ['10-03', '추석'], ['10-04', '추석 연휴'], ['10-05', '대체공휴일']],
  2029: [['02-12', '설날 연휴'], ['02-13', '설날'], ['02-14', '설날 연휴'], ['05-07', '대체공휴일(어린이날)'], ['05-20', '부처님오신날'], ['05-21', '대체공휴일'], ['09-21', '추석 연휴'], ['09-22', '추석'], ['09-23', '추석 연휴'], ['09-24', '대체공휴일']],
  2030: [['02-02', '설날 연휴'], ['02-03', '설날'], ['02-04', '설날 연휴'], ['02-05', '대체공휴일'], ['05-09', '부처님오신날'], ['09-11', '추석 연휴'], ['09-12', '추석'], ['09-13', '추석 연휴']],
};

// 24절기 근사일 (실제와 ±1일 차이가 날 수 있음)
const SOLAR_TERMS = [
  ['01-05', '소한'], ['01-20', '대한'], ['02-04', '입춘'], ['02-19', '우수'], ['03-05', '경칩'], ['03-20', '춘분'],
  ['04-05', '청명'], ['04-20', '곡우'], ['05-05', '입하'], ['05-21', '소만'], ['06-06', '망종'], ['06-21', '하지'],
  ['07-07', '소서'], ['07-22', '대서'], ['08-07', '입추'], ['08-23', '처서'], ['09-07', '백로'], ['09-23', '추분'],
  ['10-08', '한로'], ['10-23', '상강'], ['11-07', '입동'], ['11-22', '소설'], ['12-07', '대설'], ['12-22', '동지'],
];

/** 내장 데이터로 특정 월의 특일 목록 생성 */
export function builtinMonth(year, month) {
  const mm = pad(month);
  const out = [];
  for (const [md, name, holiday] of FIXED) if (md.startsWith(mm)) out.push({ date: `${year}-${md}`, name, holiday });
  for (const [md, name] of LUNAR[year] || []) if (md.startsWith(mm)) out.push({ date: `${year}-${md}`, name, holiday: true });
  for (const [md, name] of SOLAR_TERMS) if (md.startsWith(mm)) out.push({ date: `${year}-${md}`, name: `${name}(절기)`, holiday: false });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const CACHE_KEY = 'sn:holidays';
const memCache = new Map();

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}

/**
 * 월별 특일 정보를 가져온다. fetcher(year, month)가 있으면 API 사용, 실패 시 내장 데이터.
 * 원본처럼 한 달 단위로 캐시하며, 이번 달 정보는 앱 실행 시 1회 새로 가져온다.
 */
export async function getMonth(year, month, fetcher, { refresh = false } = {}) {
  const key = `${year}-${pad(month)}`;
  if (!refresh && memCache.has(key)) return memCache.get(key);
  const cache = loadCache();
  if (!refresh && cache[key]) { memCache.set(key, cache[key]); return cache[key]; }
  let list = null;
  if (fetcher) {
    try { list = await fetcher(year, month); } catch (e) { console.warn('특일정보 API 실패, 내장 데이터 사용', e); }
  }
  const fromApi = Array.isArray(list) && list.length > 0;
  if (!fromApi) list = builtinMonth(year, month);
  memCache.set(key, list);
  if (fromApi) { cache[key] = list; localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }
  return list;
}

export async function getDay(date, fetcher) {
  const [y, m] = date.split('-').map(Number);
  const list = await getMonth(y, m, fetcher);
  return list.filter((x) => x.date === date);
}
