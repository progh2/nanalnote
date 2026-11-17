// 마크다운 저장 형식: 학년도 데이터 <-> .md 파일들
// 사람이 메모장/Obsidian 으로 읽고 고쳐도 되고, Claude 가 그대로 읽기 쉬운 형태를 목표로 한다.
//
//   {학년도}학년도/설정.md        교원정보·학교급·기본 시간표
//   {학년도}학년도/학생명단.md     | 번호 | 이름 |
//   {학년도}학년도/학사일정.md     - 2026-03-02: 입학식
//   {학년도}학년도/업무일지.md     - [x] 할 일 (작성 2026-03-02, 완료 2026-03-04)
//   {학년도}학년도/학급요록.md     ## 제목 / - 등록: / - 완료: / | 학생 | 내용 |
//   {학년도}학년도/일지/YYYY-MM-DD.md   하루치 수업일지·학생출결·상담일지

import { splitParagraphs, mentionedStudents } from './counsel.js';
import { koDate } from './util.js';

export const yearDir = (year) => `/${year}학년도`;
export const FILES = { settings: '설정.md', students: '학생명단.md', schedule: '학사일정.md', tasks: '업무일지.md', records: '학급요록.md' };
const DAY_COLS = new Set(['days', 'lessons', 'attendance', 'counsel']);

/** 항목이 저장되는 파일 경로 */
export function pathOf(year, col, item) {
  if (DAY_COLS.has(col)) return `${yearDir(year)}/일지/${item.date}.md`;
  return `${yearDir(year)}/${FILES[col]}`;
}

// ---------- 표 / 줄 이스케이프 ----------
const cellEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const cellUnesc = (s) => s.trim().replace(/<br\s*\/?>/gi, '\n').replace(/\\([\\|])/g, '$1');

function splitRow(line) {
  const t = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|\s*$/, '');
  const cells = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && i + 1 < t.length) { cur += t[i] + t[i + 1]; i++; }
    else if (t[i] === '|') { cells.push(cellUnesc(cur)); cur = ''; }
    else cur += t[i];
  }
  cells.push(cellUnesc(cur));
  return cells;
}

/** 마크다운 표 → 행 배열 (머리글·구분선 제외) */
function parseTable(lines) {
  const rows = lines.filter((l) => /^\s*\|/.test(l)).map(splitRow);
  return rows.filter((r, i) => !(i === 0) && !r.every((c) => /^:?-{2,}:?$/.test(c) || c === ''));
}

const table = (head, rows) => [
  `| ${head.join(' | ')} |`,
  `|${head.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.map(cellEsc).join(' | ')} |`),
].join('\n');

// 본문 줄이 '#' 으로 시작하면 제목으로 오인하지 않도록 '\' 를 붙인다
const escLine = (l) => (/^\\*#/.test(l) ? '\\' + l : l);
const unescLine = (l) => (/^\\+#/.test(l) ? l.slice(1) : l);
const escBlock = (s) => String(s ?? '').split('\n').map(escLine).join('\n');
const unescBlock = (s) => s.split('\n').map(unescLine).join('\n');
const oneLine = (s) => String(s ?? '').replace(/\r?\n/g, '<br>');
const fromOneLine = (s) => s.replace(/<br\s*\/?>/gi, '\n');

const DATE = /(\d{4}-\d{2}-\d{2})/;

/** '## 제목' 단위로 나누기 → [{title, lines}] (첫 '##' 앞은 title=null) */
function sections(text, level = 2) {
  const mark = '#'.repeat(level) + ' ';
  const out = [{ title: null, lines: [] }];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith(mark)) out.push({ title: line.slice(mark.length).trim(), lines: [] });
    else out[out.length - 1].lines.push(line);
  }
  return out;
}

const trimBlank = (lines) => {
  let a = 0, b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
};

// ---------- 직렬화 ----------
export function serialize(year, data) {
  const files = new Map();
  const dir = yearDir(year);
  const header = (t) => `# ${t} (${year}학년도)\n\n> 쌔미노트 Web 이 관리하는 파일입니다. 형식을 지키면 직접 고쳐도 됩니다.\n`;

  // 설정
  const s = data.settings.find((x) => x.key === 'main');
  if (s) {
    const v = s.value || {};
    const tt = v.timetable || {};
    const maxP = Math.max(v.schoolLevel === 'secondary' ? 8 : 6, ...[1, 2, 3, 4, 5].map((d) => (tt[d] || []).length));
    const rows = Array.from({ length: maxP }, (_, i) => [String(i + 1), ...[1, 2, 3, 4, 5].map((d) => tt[d]?.[i] || '')]);
    files.set(`${dir}/${FILES.settings}`, [
      header('설정'),
      `- 교원정보: ${oneLine(v.teacherInfo)}`,
      `- 학교급: ${v.schoolLevel === 'secondary' ? '중고' : '초등'}`,
      `- 최종수정일시 표시: ${v.showModified === false ? '아니오' : '예'}`,
      '', '## 기본 시간표', '', table(['교시', '월', '화', '수', '목', '금'], rows), '',
    ].join('\n'));
  }

  // 학생명단
  if (data.students.length) {
    const st = [...data.students].sort((a, b) => (a.no ?? 1e9) - (b.no ?? 1e9));
    files.set(`${dir}/${FILES.students}`, [header('학생명단'), table(['번호', '이름'], st.map((x) => [x.no ?? '', x.name])), ''].join('\n'));
  }

  // 학사일정
  if (data.schedule.length) {
    const sc = [...data.schedule].sort((a, b) => a.date.localeCompare(b.date));
    files.set(`${dir}/${FILES.schedule}`, [header('학사일정'), ...sc.map((x) => `- ${x.date}: ${oneLine(x.text)}`), ''].join('\n'));
  }

  // 업무일지
  if (data.tasks.length) {
    const tk = [...data.tasks].sort((a, b) => a.created.localeCompare(b.created));
    files.set(`${dir}/${FILES.tasks}`, [header('업무일지'),
      ...tk.map((t) => `- [${t.doneDate ? 'x' : ' '}] ${oneLine(t.text)} (작성 ${t.created}${t.doneDate ? `, 완료 ${t.doneDate}` : ''})`), ''].join('\n'));
  }

  // 학급요록
  if (data.records.length) {
    const rc = [...data.records].sort((a, b) => a.created.localeCompare(b.created));
    const parts = [header('학급요록')];
    for (const r of rc) {
      parts.push(`## ${oneLine(r.title)}`, '', `- 등록: ${r.created}`, `- 완료: ${r.doneDate || '진행 중'}`, '');
      const entries = Object.entries(r.entries || {}).filter(([, v]) => String(v).trim());
      parts.push(table(['학생', '내용'], entries), '');
    }
    files.set(`${dir}/${FILES.records}`, parts.join('\n'));
  }

  // 일지 (하루 한 파일)
  const dates = new Set();
  for (const c of DAY_COLS) for (const x of data[c]) dates.add(x.date);
  for (const date of [...dates].sort()) {
    const day = data.days.find((x) => x.date === date);
    const lessons = data.lessons.filter((x) => x.date === date).sort((a, b) => a.period - b.period);
    const att = data.attendance.filter((x) => x.date === date);
    const counsel = data.counsel.filter((x) => x.date === date).sort((a, b) => a.order - b.order);
    const out = ['---', `날짜: ${date}`];
    if (day?.updatedAt) out.push(`최종수정: ${day.updatedAt}`);
    out.push('---', `# ${koDate(date)} 교사수첩`, '');
    out.push('## 수업일지', '');
    for (const l of lessons) {
      out.push(`### ${l.period}교시${l.subject ? ` · ${oneLine(l.subject)}` : ''}`);
      if ((l.content || '').trim()) out.push(escBlock(l.content));
      out.push('');
    }
    out.push('## 학생출결', '');
    for (const a of att) out.push(`- ${[a.student, a.type, a.reason, oneLine(a.note)].map((x) => x || '-').join(' · ')}`);
    if (att.length) out.push('');
    out.push('## 상담일지', '');
    if (counsel.length) out.push(counsel.map((c) => escBlock(c.text)).join('\n\n'), '');
    if (day?.extra) out.push(day.extra.trimEnd(), '');
    files.set(`${dir}/일지/${date}.md`, out.join('\n'));
  }
  return files;
}

// ---------- 해석 ----------
/**
 * @param files Map<경로, 내용> (경로는 대소문자 무관하게 yearDir 기준)
 * @param makeId () => 새 id
 */
export function parse(year, files, makeId) {
  const dir = yearDir(year);
  const get = (name) => {
    for (const [p, t] of files) if (p.toLowerCase() === `${dir}/${name}`.toLowerCase()) return t;
    return null;
  };
  const data = { settings: [], students: [], schedule: [], days: [], lessons: [], tasks: [], attendance: [], counsel: [], records: [] };

  // 설정
  const st = get(FILES.settings);
  if (st != null) {
    const v = { teacherInfo: '', schoolLevel: 'elem', showModified: true, timetable: { 1: [], 2: [], 3: [], 4: [], 5: [] } };
    for (const line of st.split('\n')) {
      let m;
      if ((m = line.match(/^-\s*교원정보\s*:\s*(.*)$/))) v.teacherInfo = fromOneLine(m[1].trim());
      else if ((m = line.match(/^-\s*학교급\s*:\s*(.*)$/))) v.schoolLevel = /중|고|second/i.test(m[1]) ? 'secondary' : 'elem';
      else if ((m = line.match(/^-\s*최종수정일시 표시\s*:\s*(.*)$/))) v.showModified = !/아니|no|false/i.test(m[1]);
    }
    const tsec = sections(st).find((x) => x.title === '기본 시간표');
    if (tsec) {
      for (const r of parseTable(tsec.lines)) {
        const p = parseInt(r[0], 10);
        if (!p) continue;
        for (let d = 1; d <= 5; d++) if (r[d]) v.timetable[d][p - 1] = r[d];
      }
      for (let d = 1; d <= 5; d++) v.timetable[d] = Array.from(v.timetable[d], (x) => x || '');
    }
    data.settings.push({ id: makeId(), key: 'main', value: v });
  }

  // 학생명단
  const stu = get(FILES.students);
  if (stu != null) {
    for (const r of parseTable(stu.split('\n'))) {
      const name = (r[1] || '').trim();
      if (name) data.students.push({ id: makeId(), no: r[0] === '' || isNaN(+r[0]) ? null : +r[0], name });
    }
  }
  const names = data.students.map((x) => x.name);

  // 학사일정
  const sch = get(FILES.schedule);
  if (sch != null) {
    for (const line of sch.split('\n')) {
      const m = line.match(/^\s*[-*]\s*(\d{4}-\d{2}-\d{2})\s*[:：]?\s*(.*)$/);
      if (m && m[2].trim()) data.schedule.push({ id: makeId(), date: m[1], text: fromOneLine(m[2].trim()) });
    }
  }

  // 업무일지
  const tk = get(FILES.tasks);
  if (tk != null) {
    for (const line of tk.split('\n')) {
      const m = line.match(/^\s*[-*]\s*\[([ xX])\]\s*(.*)$/);
      if (!m) continue;
      let text = m[2], created = null, done = null;
      const meta = text.match(/\s*\(작성\s*(\d{4}-\d{2}-\d{2})(?:\s*,\s*완료\s*(\d{4}-\d{2}-\d{2}))?\)\s*$/);
      if (meta) { text = text.slice(0, meta.index); created = meta[1]; done = meta[2] || null; }
      created ||= `${year}-03-01`;
      if (m[1].toLowerCase() === 'x' && !done) done = created;
      if (m[1] === ' ') done = null;
      if (text.trim()) data.tasks.push({ id: makeId(), text: fromOneLine(text.trim()), created, doneDate: done });
    }
  }

  // 학급요록
  const rc = get(FILES.records);
  if (rc != null) {
    for (const sec of sections(rc).slice(1)) {
      const created = sec.lines.map((l) => l.match(/^-\s*등록\s*:\s*(\d{4}-\d{2}-\d{2})/)).find(Boolean)?.[1] || `${year}-03-01`;
      const done = sec.lines.map((l) => l.match(/^-\s*완료\s*:\s*(\d{4}-\d{2}-\d{2})/)).find(Boolean)?.[1] || null;
      const entries = {};
      for (const r of parseTable(sec.lines)) if (r[0] && (r[1] || '').trim()) entries[r[0]] = r[1];
      data.records.push({ id: makeId(), title: fromOneLine(sec.title), created, doneDate: done, entries });
    }
  }

  // 일지
  const dayRe = new RegExp(`^${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/일지/(\\d{4}-\\d{2}-\\d{2})\\.md$`, 'i');
  for (const [p, text] of files) {
    const dm = p.match(dayRe);
    if (!dm) continue;
    const date = dm[1];
    let body = text.replace(/\r\n?/g, '\n');
    let updatedAt = null;
    const fm = body.match(/^---\n([\s\S]*?)\n---\n?/);
    if (fm) {
      updatedAt = fm[1].match(/^최종수정\s*:\s*(.+)$/m)?.[1].trim() || null;
      body = body.slice(fm[0].length);
    }
    const extra = [];
    for (const sec of sections(body)) {
      if (sec.title == null) continue;
      if (sec.title === '수업일지') {
        for (const ls of sections(sec.lines.join('\n'), 3).slice(1)) {
          const m = ls.title.match(/^(\d+)\s*교시\s*(?:[·:\-]\s*(.*))?$/);
          if (!m) continue;
          data.lessons.push({ id: makeId(), date, period: +m[1], subject: fromOneLine((m[2] || '').trim()), content: unescBlock(trimBlank(ls.lines).join('\n')) });
        }
      } else if (sec.title === '학생출결') {
        for (const line of sec.lines) {
          const m = line.match(/^\s*[-*]\s+(.+)$/);
          if (!m) continue;
          const [student, type, reason, ...note] = m[1].split(/\s*·\s*/).map((x) => (x === '-' ? '' : x.trim()));
          if (student) data.attendance.push({ id: makeId(), date, student, type: type || '', reason: reason || '', note: fromOneLine(note.join(' · ')) });
        }
      } else if (sec.title === '상담일지') {
        splitParagraphs(unescBlock(trimBlank(sec.lines).join('\n'))).forEach((t, i) => {
          data.counsel.push({ id: makeId(), date, order: i, text: t, students: mentionedStudents(t, names) });
        });
      } else {
        extra.push(`## ${sec.title}\n${trimBlank(sec.lines).join('\n')}`);
      }
    }
    const day = { id: makeId(), date, updatedAt };
    if (extra.length) day.extra = extra.join('\n\n');
    data.days.push(day);
  }
  return data;
}
