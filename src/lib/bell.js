// 시정표(일과 시간): 등교, 교시별 시각, 점심·저녁 식사, 저녁 방과후
//
// settings.bell = {
//   arrival: '08:30',                       등교 시각
//   periodCount: 6,                         정규 교시 수 (4~8)
//   times: [{ start, end }, ...],           정규 교시별 시각 (index = 교시-1)
//   lunch: { start, end, after: 4 },        점심 (after 교시 다음에 표시)
//   dinner: { enabled, start, end },        저녁 식사 (고등학교 등)
//   evening: [{ label, start, end }, ...],  저녁 방과후/자율학습 (수업일지 교시 번호 11, 12, ...)
//   lessonLen: 50, breakLen: 10,            수업·쉬는 시간(분) — 시작 시각만 넣으면 끝·다음 교시 자동 계산
//   csat: { lunch: {start,end}, p4: {start,end} }   수능대비 시간표 시각 (적용 여부는 날짜별: 학사일정의 csat 표시)
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
    lessonLen: level === 'secondary' ? 50 : 40,
    breakLen: 10,
    csat: { lunch: { start: '', end: '' }, p4: { start: '', end: '' } },
  };
}

/** 저장된 설정 그대로 (수능대비 시간표를 적용하지 않음) — 설정 화면 편집용 */
export function rawBell(settings) {
  const d = defaultBell(settings?.schoolLevel);
  const b = settings?.bell || {};
  return {
    arrival: b.arrival || '',
    periodCount: clampInt(b.periodCount, 1, 9, d.periodCount),
    times: Array.isArray(b.times) ? b.times.map((t) => ({ start: t?.start || '', end: t?.end || '' })) : [],
    lunch: { start: b.lunch?.start || '', end: b.lunch?.end || '', after: clampInt(b.lunch?.after, 0, 9, 4) },
    dinner: { enabled: !!b.dinner?.enabled, start: b.dinner?.start || '', end: b.dinner?.end || '' },
    evening: Array.isArray(b.evening) ? b.evening.slice(0, MAX_EVENING).map((e, i) => ({ label: e?.label || `방과후${i + 1}`, start: e?.start || '', end: e?.end || '' })) : [],
    lessonLen: clampInt(b.lessonLen, 10, 180, d.lessonLen),
    breakLen: clampInt(b.breakLen, 0, 60, d.breakLen),
    csat: {
      lunch: { start: b.csat?.lunch?.start || '', end: b.csat?.lunch?.end || '' },
      p4: { start: b.csat?.p4?.start || '', end: b.csat?.p4?.end || '' },
    },
  };
}

/** 수능대비 시간표 시각: 설정값, 비어 있으면 3교시 끝 → 점심(평소 점심 길이) → 4교시(수업 길이)로 계산 */
export function csatTimes(b) {
  const lunchLen = b.lunch.start && b.lunch.end ? Math.max(20, toMin(b.lunch.end) - toMin(b.lunch.start)) : 50;
  const p3end = b.times[2]?.end || '';
  const lunch = { start: b.csat.lunch.start || p3end, end: b.csat.lunch.end || (b.csat.lunch.start || p3end ? addMin(b.csat.lunch.start || p3end, lunchLen) : '') };
  const p4 = { start: b.csat.p4.start || lunch.end, end: b.csat.p4.end || (b.csat.p4.start || lunch.end ? addMin(b.csat.p4.start || lunch.end, b.lessonLen) : '') };
  return { lunch, p4 };
}

/**
 * 실제로 쓰는 시정표.
 * @param opts.csat 그 날이 수능대비 시간표인 날이면 true → 점심을 3교시 다음으로, 4교시 시각 교체
 */
export function bellOf(settings, { csat = false } = {}) {
  const b = rawBell(settings);
  if (csat) {
    const t = csatTimes(b);
    b.lunch = { ...t.lunch, after: 3 };
    b.times = [...b.times];
    b.times[3] = { ...t.p4 };
    b.csatDay = true;
  }
  return b;
}
const pick = (t) => Object.fromEntries(Object.entries(t || {}).filter(([, v]) => v));

export const addMin = (t, n) => { const m = toMin(t); return m == null ? '' : fromMin(m + n); };

/**
 * p교시 시작 시각을 바꿨을 때: p교시 끝 = 시작+수업 길이, 그 뒤 교시들은 점심 전까지(또는 끝까지) 이어서 채운다.
 * 점심 바로 앞 교시가 바뀌면 점심 시작을, 점심 바로 뒤 교시가 바뀌면 점심 끝을 맞춘다.
 * @param b rawBell 형태 (직접 고침)
 */
export function cascadeFrom(b, p) {
  const t = (b.times[p - 1] ||= { start: '', end: '' });
  if (!t.start) return b;
  t.end = addMin(t.start, b.lessonLen);
  const lunchAfter = b.lunch.after;
  for (let q = p + 1; q <= b.periodCount && q - 1 !== lunchAfter; q++) {
    const prev = b.times[q - 2];
    b.times[q - 1] = { start: addMin(prev.end, b.breakLen), end: addMin(addMin(prev.end, b.breakLen), b.lessonLen) };
  }
  const before = b.times[lunchAfter - 1];
  if (lunchAfter && before?.end && (p <= lunchAfter)) b.lunch.start = before.end;
  const after = b.times[lunchAfter];
  if (lunchAfter && after?.start && p === lunchAfter + 1) b.lunch.end = after.start;
  return b;
}

function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

/** 수업일지에 쓰는 교시 목록: 정규 1..N + 저녁 방과후 */
export function periodList(settings, opts = {}) {
  const b = bellOf(settings, opts);
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
export function dayRows(settings, opts = {}) {
  const b = bellOf(settings, opts);
  const periods = periodList(settings, opts);
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
