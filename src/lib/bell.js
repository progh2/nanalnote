// 시정표(일과 시간): 등교, 교시별 시각, 점심·저녁 식사, 저녁 방과후
//
// settings.bell = {
//   arrival: '08:30',                       등교 시각
//   periodCount: 6,                         정규 교시 수 (4~8)
//   times: [{ start, end }, ...],           정규 교시별 시각 (index = 교시-1)
//   lunch: { start, end, after: 4 },        점심 (after 교시 다음에 표시)
//   dinner: { enabled, start, end },        저녁 식사 (고등학교 등)
//   evening: [{ label, start, end }, ...],  저녁 방과후/자율학습 (수업일지 교시 번호 11, 12, ...)
// }

export const EVENING_BASE = 10; // 저녁 방과후 i번째(0부터) = 교시 번호 11+i
export const MAX_EVENING = 4;

export function defaultBell(level = 'elem') {
  return {
    arrival: '',
    periodCount: level === 'secondary' ? 7 : 6,
    times: [],
    lunch: { start: '', end: '', after: 4 },
    dinner: { enabled: false, start: '', end: '' },
    evening: [],
  };
}

/** 저장된 설정을 빈 값까지 채운 형태로 정규화 */
export function bellOf(settings) {
  const d = defaultBell(settings?.schoolLevel);
  const b = settings?.bell || {};
  return {
    arrival: b.arrival || '',
    periodCount: clampInt(b.periodCount, 1, 9, d.periodCount),
    times: Array.isArray(b.times) ? b.times.map((t) => ({ start: t?.start || '', end: t?.end || '' })) : [],
    lunch: { start: b.lunch?.start || '', end: b.lunch?.end || '', after: clampInt(b.lunch?.after, 0, 9, 4) },
    dinner: { enabled: !!b.dinner?.enabled, start: b.dinner?.start || '', end: b.dinner?.end || '' },
    evening: Array.isArray(b.evening) ? b.evening.slice(0, MAX_EVENING).map((e, i) => ({ label: e?.label || `방과후${i + 1}`, start: e?.start || '', end: e?.end || '' })) : [],
  };
}

function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

/** 수업일지에 쓰는 교시 목록: 정규 1..N + 저녁 방과후 */
export function periodList(settings) {
  const b = bellOf(settings);
  const out = [];
  for (let p = 1; p <= b.periodCount; p++) out.push({ p, label: `${p}교시`, start: b.times[p - 1]?.start || '', end: b.times[p - 1]?.end || '', kind: 'period' });
  b.evening.forEach((e, i) => out.push({ p: EVENING_BASE + 1 + i, label: e.label, start: e.start, end: e.end, kind: 'evening' }));
  return out;
}

export function periodLabel(settings, p) {
  if (p > EVENING_BASE) return bellOf(settings).evening[p - EVENING_BASE - 1]?.label || `방과후${p - EVENING_BASE}`;
  return `${p}교시`;
}

/** '3교시' / '방과후1' / 사용자가 붙인 저녁 이름 → 교시 번호 */
export function parsePeriodLabel(settings, label) {
  const s = String(label || '').trim();
  let m = s.match(/^(\d+)\s*교시$/) || s.match(/^(\d+)$/);
  if (m) return +m[1];
  const ev = bellOf(settings).evening.findIndex((e) => e.label === s);
  if (ev >= 0) return EVENING_BASE + 1 + ev;
  m = s.match(/^방과후\s*(\d+)$/);
  if (m) return EVENING_BASE + +m[1];
  return null;
}

/** 하루 일과 행: 등교 → 교시들(점심 끼워 넣기) → 저녁 식사 → 저녁 방과후 */
export function dayRows(settings) {
  const b = bellOf(settings);
  const periods = periodList(settings);
  const rows = [];
  if (b.arrival) rows.push({ kind: 'arrival', label: '등교', start: b.arrival, end: '' });
  const lunchRow = { kind: 'lunch', label: '점심', start: b.lunch.start, end: b.lunch.end };
  const showLunch = b.lunch.start || b.lunch.end;
  if (showLunch && b.lunch.after === 0) rows.push(lunchRow);
  for (const r of periods.filter((x) => x.kind === 'period')) {
    rows.push(r);
    if (showLunch && b.lunch.after === r.p) rows.push(lunchRow);
  }
  if (showLunch && b.lunch.after > b.periodCount) rows.push(lunchRow);
  if (b.dinner.enabled) rows.push({ kind: 'dinner', label: '저녁', start: b.dinner.start, end: b.dinner.end });
  rows.push(...periods.filter((x) => x.kind === 'evening'));
  return rows;
}

export const fmtRange = (r) => (r.start && r.end ? `${r.start}~${r.end}` : r.start || r.end || '');

const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
const fromMin = (n) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

/** 지금 시각(HH:MM)에 해당하는 행 */
export function currentRow(rows, now) {
  const n = toMin(now);
  return rows.find((r) => { const a = toMin(r.start), b = toMin(r.end); return a != null && b != null && n >= a && n < b; }) || null;
}

/** 1교시 시작·수업 길이·쉬는 시간·점심으로 정규 교시 시각 자동 계산 */
export function autoTimes({ first, lesson, rest, count, lunchAfter, lunchLen }) {
  let t = toMin(first);
  if (t == null) return null;
  const times = [];
  let lunch = null;
  for (let p = 1; p <= count; p++) {
    times.push({ start: fromMin(t), end: fromMin(t + lesson) });
    t += lesson;
    if (p === lunchAfter && lunchLen > 0) { lunch = { start: fromMin(t), end: fromMin(t + lunchLen) }; t += lunchLen; }
    else t += rest;
  }
  return { times, lunch };
}
