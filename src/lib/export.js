// 내려받기: 한글(.hwpx, 기본) 또는 Word(.docx)
// 내용은 형식과 상관없는 블록 목록으로 만들고, 마지막에 고른 형식으로 바꾼다.
//   {t:'title'|'h'|'p'|'ml'|'small', text, bold?, color?} · {t:'table', headers, rows, widths(%)} · {t:'break'}
import { koDate, fmtDateTime, weekdayOf } from './util.js';
import { dayRows, fmtRange } from './bell.js';

const FORMAT_KEY = 'sn:exportFormat';
export const FORMATS = { hwpx: '한글', docx: 'Word' };
/** 이 기기에서 고른 내려받기 형식 ('hwpx' 기본) */
export function exportFormat() {
  try { const f = localStorage.getItem(FORMAT_KEY); return FORMATS[f] ? f : 'hwpx'; } catch { return 'hwpx'; }
}
export function setExportFormat(f) { try { localStorage.setItem(FORMAT_KEY, f); } catch { /* 무시 */ } }
/** 파일 확장자 */
export const fileExt = () => exportFormat();
/** 버튼 글자: "⬇ 한글" */
export const dlLabel = (prefix = '⬇ ') => `${prefix}${FORMATS[exportFormat()]}`;

const p = (text, opts = {}) => ({ t: 'p', text: String(text ?? ''), ...opts });
const multiline = (text) => ({ t: 'ml', text: String(text ?? '') });
const heading = (text, level = 2) => ({ t: level === 1 ? 'title' : 'h', text });
const table = (headers, rows, widths) => ({ t: 'table', headers, rows: rows.map((r) => r.map((c) => String(c ?? ''))), widths });
const PAGE_BREAK = { t: 'break' };
const HeadingLevel = { HEADING_1: 1, HEADING_2: 2 };

/**
 * 하루치 교사수첩 내용
 * @param mode 'single' (오늘 일지: 보이는 업무 전체) | 'range' (기간: 완료한 업무만, 옵션으로 미완료 포함)
 */
function dayBlocks(store, date, specials, { mode = 'single', includeIncomplete = false } = {}) {
  const s = store.settings;
  const out = [];
  out.push(heading(`교사수첩  ${koDate(date)}`, 1));
  if (s.teacherInfo) out.push({ t: 'small', text: s.teacherInfo });

  const sched = store.scheduleText(date);
  const sp = specials.map((x) => x.name + (x.holiday ? '(휴일)' : '')).join(', ');
  out.push(heading('학사일정'));
  out.push(multiline([store.isSchoolHoliday(date) ? '[학교 휴업일]' : '', store.isCsat(date) ? '[수능대비 시간표]' : '', sched, sp && `특일: ${sp}`].filter(Boolean).join('\n') || '-'));

  const lessons = store.lessonsFor(date, weekdayOf(date));
  out.push(heading('수업일지'));
  // 시정표 순서대로 (등교·점심·저녁 줄 포함), 시정표에 없는 기록은 뒤에
  const sec = s.schoolLevel === 'secondary';
  const cols = (l) => (sec ? [l?.subject || '', l?.cls || '', l?.room || ''] : [l?.subject || '']);
  const rows = [];
  const used = new Set();
  for (const r of dayRows(s, store.bellOpts(date))) {
    if (r.p == null) { rows.push([r.label, fmtRange(r), ...cols(null), '']); continue; }
    const l = lessons.find((x) => x.period === r.p);
    used.add(r.p);
    rows.push([r.label, fmtRange(r), ...cols(l), l?.content || '']);
  }
  for (const l of lessons) if (!used.has(l.period)) rows.push([store.periodLabel(l.period), '', ...cols(l), l.content]);
  out.push(sec
    ? table(['교시', '시간', '수업명', '학반', '교실', '내용'], rows, [9, 12, 13, 7, 11, 48])
    : table(['교시', '시간', '과목', '내용'], rows, [10, 14, 16, 60]));

  let tasks = store.visibleTasks(date);
  if (mode === 'range') tasks = tasks.filter((t) => t.doneDate === date || (includeIncomplete && !t.doneDate) || (includeIncomplete && t.doneDate > date));
  out.push(heading('업무일지'));
  if (!tasks.length) out.push(p('-'));
  for (const t of tasks) out.push(p(`${t.doneDate === date ? '☑' : '☐'} [${{ A: 'A', B: 'B', C: 'C', Z: '언젠가' }[t.priority] || 'B'}] ${t.text}${t.due ? ` (마감 ${t.due})` : ''}`));

  const att = store.work.attendance.filter((a) => a.date === date);
  out.push(heading('학생출결상황'));
  out.push(att.length ? table(['수업', '학생', '구분', '사유', '비고'], att.map((a) => [a.periods?.length ? `${a.periods.join('·')}교시 ${a.subject || ''} ${a.cls || ''}` : '종일', store.label(a.student), a.type, a.reason, a.note]), [22, 20, 11, 11, 36]) : p('-'));

  const trips = store.tripsOn(date);
  if (trips.length) {
    out.push(heading('출장'));
    out.push(table(['시간', '출장지', '목적·내용'], trips.map((t) => [t.time, t.place, t.purpose]), [20, 30, 50]));
  }

  const note = store.dayNote(date);
  if (note) { out.push(heading('노트')); out.push(multiline(note)); }

  const day = store.day(date);
  if (day && (day.body || day.mind || day.health || day.thanks || day.study)) {
    const stars = (n) => (n ? `${'★'.repeat(n)}${'☆'.repeat(5 - n)}` : '-');
    out.push(heading('하루 돌아보기'));
    out.push(table(['몸', '마음', '건강', '감사한 일', '공부한 것'], [[stars(day.body), stars(day.mind), day.health || '', day.thanks || '', day.study || '']], [12, 12, 24, 26, 26]));
  }

  const counsel = store.counselText(date);
  out.push(heading('학생 상담 일지 및 특이사항'));
  out.push(multiline(counsel || '-'));
  return out;
}

/** 블록 → 고른 형식의 Blob */
async function pack(blocks, footerText) {
  if (exportFormat() === 'docx') {
    const { renderDocx } = await import('./export-docx.js');
    return renderDocx(blocks, footerText);
  }
  const { buildHwpx } = await import('./hwpx.js');
  return buildHwpx(blocks, { footer: footerText });
}

/** 오늘 일지 다운로드 (최종수정일시 꼬리말 포함) */
export async function exportDay(store, date, specials) {
  const upd = store.day(date)?.updatedAt;
  const footer = store.settings.showModified && upd ? `최종수정일시: ${fmtDateTime(upd)}` : '';
  return pack(dayBlocks(store, date, specials, { mode: 'single' }), footer);
}

/** 기간지정 다운로드 (최종수정일시 제외, 완료 업무만 / 옵션: 미완료 포함) */
export async function exportRange(store, dates, specialsOf, { includeIncomplete }) {
  const children = [];
  for (const [i, d] of dates.entries()) {
    if (i) children.push(PAGE_BREAK);
    children.push(...dayBlocks(store, d, await specialsOf(d), { mode: 'range', includeIncomplete }));
  }
  return pack(children);
}

/** 수업일지 모음 (수업명·학반별) */
export async function exportLessons(store, title, lessons) {
  const sec = store.settings.schoolLevel === 'secondary';
  return pack([
    heading(`수업일지 모아보기 - ${title || '전체'}`, HeadingLevel.HEADING_1),
    sec
      ? table(['날짜', '교시', '수업명', '학반', '교실', '내용'], lessons.map((l) => [koDate(l.date), store.periodLabel(l.period), l.subject, l.cls || '', l.room || '', l.content]), [20, 9, 12, 7, 10, 42])
      : table(['날짜', '교시', '과목', '내용'], lessons.map((l) => [koDate(l.date), store.periodLabel(l.period), l.subject, l.content]), [22, 10, 15, 53]),
  ]);
}

/** 출장 목록 */
export async function exportTrips(list, range) {
  const days = new Set(list.map((t) => t.date)).size;
  return pack([
    heading(`출장 (${range.start} ~ ${range.end})`, HeadingLevel.HEADING_1),
    p(`총 ${list.length}건 · ${days}일`),
    table(['날짜', '시간', '출장지', '목적·내용'], list.map((t) => [koDate(t.date), t.time, t.place, t.purpose]), [22, 16, 24, 38]),
  ]);
}

/** 학생별 상담 일지 모음 */
export async function exportCounsel(name, items) {
  return pack([
    heading(`학생 상담 일지 - ${name}`, HeadingLevel.HEADING_1),
    ...items.flatMap((c) => [p(koDate(c.date), { bold: true }), multiline(c.text)]),
  ]);
}

/** 학생출결 모아보기 */
export async function exportAttendance(rows, range) {
  return pack([
    heading(`학생출결 (${range.start} ~ ${range.end})`, HeadingLevel.HEADING_1),
    table(['날짜', '수업', '학생', '구분', '사유', '비고'], rows.map((a) => [a.date, a.periods?.length ? `${a.periods.join('·')}교시 ${a.subject || ''} ${a.cls || ''}` : '종일', a.student, a.type, a.reason, a.note]), [15, 20, 15, 10, 10, 30]),
  ]);
}

/** 학급요록 (제목 단위) */
export async function exportRecord(store, record) {
  const studs = store.studentsOf(record.cls || '');
  return pack([
    heading(`학급요록 - ${record.title}${record.cls ? ` (${record.cls})` : ''}`, HeadingLevel.HEADING_1),
    p(`등록일 ${record.created}${record.doneDate ? ` · 완료 ${record.doneDate}` : ''}`),
    table(['학생', '내용'], studs.map((x) => [store.label(x.uid), record.entries?.[x.uid] || '']), [25, 75]),
  ]);
}

/** 하루 돌아보기 모아보기 */
export async function exportReflect(rows, range) {
  const stars = (n) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');
  const avg = (k) => { const v = rows.map((r) => r[k]).filter(Boolean); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '-'; };
  return pack([
    heading(`하루 돌아보기 (${range.start} ~ ${range.end})`, 1),
    p(`기록 ${rows.length}일 · 평균 몸 ${avg('body')} · 마음 ${avg('mind')}`),
    table(['날짜', '몸', '마음', '건강', '감사한 일', '공부한 것'], rows.map((r) => [koDate(r.date), stars(r.body), stars(r.mind), r.health, r.thanks, r.study]), [17, 10, 10, 21, 21, 21]),
  ]);
}
