// Word(docx) 내보내기 - 원본 쌔미노트(2024.12 이후)처럼 MS Word 파일로 생성 (한컴오피스에서도 열림)
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel,
  Footer, AlignmentType, PageBreak, ShadingType,
} from 'docx';
import { koDate, fmtDateTime, weekdayOf } from './util.js';

const FONT = '맑은 고딕';

const p = (text, opts = {}) => new Paragraph({ spacing: { after: 80 }, ...opts, children: [new TextRun({ text: String(text ?? ''), font: FONT, size: opts.size || 20, bold: opts.bold, color: opts.color })] });

const multiline = (text, opts = {}) => {
  const lines = String(text ?? '').split('\n');
  return new Paragraph({
    spacing: { after: 80 },
    children: lines.flatMap((l, i) => [new TextRun({ text: l, font: FONT, size: 20, break: i ? 1 : 0, ...opts })]),
  });
};

const heading = (text, level = HeadingLevel.HEADING_2) => new Paragraph({ heading: level, spacing: { before: 200, after: 100 }, children: [new TextRun({ text, font: FONT, bold: true })] });

function table(headers, rows, widths) {
  const cell = (text, head, w) => new TableCell({
    width: w ? { size: w, type: WidthType.PERCENTAGE } : undefined,
    shading: head ? { type: ShadingType.CLEAR, fill: 'E8E8E8', color: 'auto' } : undefined,
    children: [multiline(text, head ? { bold: true } : {})],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((hd, i) => cell(hd, true, widths?.[i])) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, false, widths?.[i])) })),
    ],
  });
}

/**
 * 하루치 교사수첩 내용
 * @param mode 'single' (오늘 일지: 보이는 업무 전체) | 'range' (기간: 완료한 업무만, 옵션으로 미완료 포함)
 */
function dayBlocks(store, date, specials, { mode = 'single', includeIncomplete = false } = {}) {
  const s = store.settings;
  const out = [];
  out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 120 }, children: [new TextRun({ text: `교사수첩  ${koDate(date)}`, font: FONT, bold: true })] }));
  if (s.teacherInfo) out.push(p(s.teacherInfo, { color: '555555' }));

  const sched = store.scheduleText(date);
  const sp = specials.map((x) => x.name + (x.holiday ? '(휴일)' : '')).join(', ');
  out.push(heading('학사일정'));
  out.push(multiline([sched, sp && `특일: ${sp}`].filter(Boolean).join('\n') || '-'));

  const lessons = store.lessonsFor(date, weekdayOf(date));
  out.push(heading('수업일지'));
  out.push(table(['교시', s.schoolLevel === 'secondary' ? '학반/교실' : '과목', '내용'], lessons.map((l) => [`${l.period}`, l.subject, l.content]), [8, 17, 75]));

  let tasks = store.visibleTasks(date);
  if (mode === 'range') tasks = tasks.filter((t) => t.doneDate === date || (includeIncomplete && !t.doneDate) || (includeIncomplete && t.doneDate > date));
  out.push(heading('업무일지'));
  if (!tasks.length) out.push(p('-'));
  for (const t of tasks) out.push(p(`${t.doneDate === date ? '☑' : '☐'} ${t.text}`));

  const att = store.work.attendance.filter((a) => a.date === date);
  out.push(heading('학생출결상황'));
  out.push(att.length ? table(['학생', '구분', '사유', '비고'], att.map((a) => [a.student, a.type, a.reason, a.note]), [20, 15, 15, 50]) : p('-'));

  const counsel = store.counselText(date);
  out.push(heading('학생 상담 일지 및 특이사항'));
  out.push(multiline(counsel || '-'));
  return out;
}

async function pack(children, footerText) {
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      footers: footerText ? { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: footerText, font: FONT, size: 16, color: '777777' })] })] }) } : undefined,
      children,
    }],
  });
  return Packer.toBlob(doc);
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
    if (i) children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(...dayBlocks(store, d, await specialsOf(d), { mode: 'range', includeIncomplete }));
  }
  return pack(children);
}

/** 과목별 수업일지 모음 */
export async function exportLessons(store, subject, lessons) {
  return pack([
    heading(`수업일지 모아보기 - ${subject || '전체'}`, HeadingLevel.HEADING_1),
    table(['날짜', '교시', '과목', '내용'], lessons.map((l) => [koDate(l.date), `${l.period}`, l.subject, l.content]), [22, 8, 15, 55]),
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
    table(['날짜', '학생', '구분', '사유', '비고'], rows.map((a) => [a.date, a.student, a.type, a.reason, a.note]), [20, 15, 12, 12, 41]),
  ]);
}

/** 학급요록 (제목 단위) */
export async function exportRecord(store, record) {
  const names = store.studentNames();
  return pack([
    heading(`학급요록 - ${record.title}`, HeadingLevel.HEADING_1),
    p(`등록일 ${record.created}${record.doneDate ? ` · 완료 ${record.doneDate}` : ''}`),
    table(['학생', '내용'], names.map((n) => [n, record.entries?.[n] || '']), [25, 75]),
  ]);
}
