// 마크다운 저장 형식: 학년도 데이터 <-> .md 파일들
// 사람이 메모장/Obsidian 으로 읽고 고쳐도 되고, Claude 가 그대로 읽기 쉬운 형태를 목표로 한다.
//
//   {학년도}학년도/설정.md        교원정보·학교급·기본 시간표
//   {학년도}학년도/학생명단.md     | 번호 | 이름 |
//   {학년도}학년도/학사일정.md     - 2026-03-02: 입학식
//   {학년도}학년도/업무일지.md     - [x] 할 일 (작성 2026-03-02, 완료 2026-03-04)
//   {학년도}학년도/학급요록.md     ## 제목 / - 등록: / - 완료: / | 학생 | 내용 |
//   {학년도}학년도/사람·기관.md    | 구분 | 이름 | 호칭 | 소속 | 전화 | 이메일 | 다른 이름 | 메모 |
//   {학년도}학년도/태그.md         | 태그 | 상태 | 시작 | 끝 | 고정 | 설명 |
//   {학년도}학년도/일지/YYYY-MM-DD.md   하루치 수업일지·학생출결·상담일지

import { splitParagraphs } from './counsel.js';
import { buildIndex, labelOf, newUid, sortStudents } from './students.js';
import { normPerson, sortPeople, mentionedStudentUids, KINDS } from './people.js';
import { ttCell, ttIsEmpty, courseOf } from '../store.js';
import { koDate } from './util.js';
import { bellOf, rawBell, periodLabel, parsePeriodLabel, fmtRange, EVENING_BASE } from './bell.js';

export const yearDir = (year) => `/${year}학년도`;
export const FILES = { settings: '설정.md', students: '학생명단.md', schedule: '학사일정.md', tasks: '업무일지.md', records: '학급요록.md', notes: '포스트잇.md', docs: '학사일정자료.md', people: '사람·기관.md', tagcards: '태그.md' };
const DAY_COLS = new Set(['days', 'lessons', 'attendance', 'counsel', 'trips']);

/** 항목이 저장되는 파일 경로 */
export function pathOf(year, col, item) {
  if (DAY_COLS.has(col)) return `${yearDir(year)}/일지/${item.date}.md`;
  if (!FILES[col]) return `${yearDir(year)}/${col}.md`;
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

/** 머리글 이름으로 열을 찾는 표 파서 → [{열이름: 값}] */
function parseTableObjects(lines) {
  const all = lines.filter((l) => /^\s*\|/.test(l)).map(splitRow);
  if (!all.length) return [];
  const head = all[0];
  return all.slice(1).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c) || c === '')).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** 시간표 칸: 초등은 "국어", 중고는 "정보 / 1-2 / 컴퓨터실" */
const ttStr = (v) => { const c = ttCell(v); return [c.subject, c.cls, c.room].map((x) => x || '').join(' / ').replace(/( \/ )+$/, ''); };
const ttParse = (s) => { if (!s.includes(' / ')) return s; const [subject = '', cls = '', room = ''] = s.split(' / ').map((x) => x.trim()); return { subject, cls, room }; };
const dash = (x) => (x ? oneLine(x) : '-');
const undash = (x) => (x == null || x.trim() === '-' ? '' : fromOneLine(x.trim()));

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
export function serialize(year, input) {
  const data = { settings: [], students: [], schedule: [], days: [], lessons: [], tasks: [], attendance: [], counsel: [], records: [], trips: [], notes: [], docs: [], people: [], tagcards: [], ...input };
  const files = new Map();
  const dir = yearDir(year);
  const header = (t) => `# ${t} (${year}학년도)\n\n> 나날노트가 관리하는 파일입니다. 형식을 지키면 직접 고쳐도 됩니다.\n`;

  // 설정 (+ 일과 시간 + 기본 시간표)
  const s = data.settings.find((x) => x.key === 'main');
  if (s) {
    const v = s.value || {};
    const tt = v.timetable || {};
    const b = rawBell(v);
    const lastWithData = Math.max(0, ...[1, 2, 3, 4, 5].flatMap((d) => (tt[d] || []).slice(0, EVENING_BASE).map((x, i) => (ttIsEmpty(x) ? 0 : i + 1))));
    const rows = [];
    for (let p = 1; p <= Math.max(b.periodCount, lastWithData); p++) {
      rows.push([`${p}교시`, fmtRange(b.times[p - 1] || {}), ...[1, 2, 3, 4, 5].map((d) => ttStr(tt[d]?.[p - 1]))]);
    }
    b.evening.forEach((e, k) => rows.push([e.label, fmtRange(e), ...[1, 2, 3, 4, 5].map((d) => ttStr(tt[d]?.[EVENING_BASE + k]))]));
    const list = (title, arr) => ['', `## ${title}`, '', ...(arr?.length ? arr.map((x) => `- ${oneLine(x)}`) : ['- (없음)'])];
    files.set(`${dir}/${FILES.settings}`, [
      header('설정'),
      `- 교원정보: ${oneLine(v.teacherInfo)}`,
      `- 학교급: ${v.schoolLevel === 'secondary' ? '중고' : '초등'}`,
      `- 최종수정일시 표시: ${v.showModified === false ? '아니오' : '예'}`,
      '', '## 일과 시간', '',
      `- 등교: ${b.arrival || '-'}`,
      `- 정규 교시: ${b.periodCount}`,
      `- 점심: ${b.lunch.after ? `${fmtRange(b.lunch) || '-'} (${b.lunch.after}교시 다음)` : '없음'}`,
      `- 저녁: ${b.dinner.enabled ? fmtRange(b.dinner) || '-' : '없음'}`,
      `- 수업 시간: ${b.lessonLen}분, 쉬는 시간: ${b.breakLen}분`,
      `- 수능대비 시간표: 날짜별 (점심 ${fmtRange(b.csat.lunch) || '-'}, 4교시 ${fmtRange(b.csat.p4) || '-'})`,
      '', '## 기본 시간표', '',
      '> 시간표의 "방과후" 줄은 저녁 방과후·자율학습입니다. 이름을 바꿔도 됩니다. 중·고등학교 칸은 "수업명 / 학반 / 교실" 입니다.', '',
      table(['교시', '시간', '월', '화', '수', '목', '금'], rows),
      ...list('내 수업', (v.courses || []).map(courseOf).map((c) => (c.short ? `${c.name} | ${c.short}` : c.name))),
      ...list('교실·실습실', v.rooms), ...list('담당 학반', v.classes),
      '', '## 담임', '', table(['학반', '담임', '부담임'], Object.entries(v.homerooms || {}).filter(([, x]) => x?.main || x?.sub).map(([k, x]) => [k, x.main || '', x.sub || ''])), '',
    ].join('\n'));
  }

  // 학생명단
  if (data.students.length) {
    const st = sortStudents(data.students);
    files.set(`${dir}/${FILES.students}`, [header('학생명단'),
      '> 학번은 학년도마다 바뀝니다. ID 는 여러 학년도에 걸쳐 같은 학생을 잇는 값이니 지우지 마세요.', '',
      table(['학번', '학년', '반', '번호', '이름', '성별', '이메일', '전화번호', '사진', 'ID'], st.map((x) => [x.studentNo || '', x.grade ?? '', x.cls ?? '', x.no ?? '', x.name, x.gender || '', x.email || '', x.phone || '', x.photo || '', x.uid || ''])), ''].join('\n'));
  }

  // 학사일정
  if (data.schedule.length) {
    const sc = [...data.schedule].sort((a, b) => a.date.localeCompare(b.date));
    files.set(`${dir}/${FILES.schedule}`, [header('학사일정'), ...sc.map((x) => `- ${x.date}: ${x.holiday ? '[휴업] ' : ''}${x.csat ? '[수능대비] ' : ''}${oneLine(x.text)}`.trimEnd()), ''].join('\n'));
  }

  // 업무일지
  if (data.tasks.length) {
    const tk = [...data.tasks].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.created.localeCompare(b.created));
    const pl = { A: '(A) ', B: '(B) ', C: '(C) ', Z: '(언젠가) ' };
    files.set(`${dir}/${FILES.tasks}`, [header('업무일지'),
      '> 앞의 (A)(B)(C)(언젠가)는 중요도입니다.', '',
      ...tk.map((t) => `- [${t.doneDate ? 'x' : ' '}] ${t.priority ? pl[t.priority] || '' : ''}${oneLine(t.text)} (작성 ${t.created}${t.due ? `, 마감 ${t.due}` : ''}${t.doneDate ? `, 완료 ${t.doneDate}` : ''}${t.order != null ? `, 순서 ${t.order}` : ''})`), ''].join('\n'));
  }

  // 학급요록
  const idx = buildIndex(data.students);
  const lab = (ref) => labelOf(ref, idx);
  if (data.records.length) {
    const rc = [...data.records].sort((a, b) => a.created.localeCompare(b.created));
    const parts = [header('학급요록')];
    for (const r of rc) {
      parts.push(`## ${oneLine(r.title)}`, '', `- 등록: ${r.created}`, `- 완료: ${r.doneDate || '진행 중'}`, ...(r.cls ? [`- 대상: ${r.cls}`] : []), '');
      const entries = Object.entries(r.entries || {}).filter(([, v]) => String(v).trim()).map(([k, v]) => [lab(k), v]);
      parts.push(table(['학생', '내용'], entries), '');
    }
    files.set(`${dir}/${FILES.records}`, parts.join('\n'));
  }

  // 포스트잇
  if (data.notes.length) {
    const parts = [header('포스트잇')];
    data.notes.forEach((n, i) => {
      parts.push(`## 메모 ${i + 1}`, `<!-- color=${n.color || 'yellow'} x=${Math.round(n.x || 0)} y=${Math.round(n.y || 0)} w=${Math.round(n.w || 220)} h=${Math.round(n.h || 160)}${n.min ? ' min=1' : ''} -->`, escBlock(n.text || ''), '');
    });
    files.set(`${dir}/${FILES.notes}`, parts.join('\n'));
  }

  // 사람·기관 명부
  if (data.people.length) {
    files.set(`${dir}/${FILES.people}`, [header('사람·기관'),
      '> 글 속의 "김민수 선생님", "교육청에" 같은 이름을 알아보는 명부입니다. 다른 이름은 쉼표로 나눕니다.', '',
      table(['구분', '이름', '호칭', '소속', '전화', '이메일', '다른 이름', '메모'],
        sortPeople(data.people).map((x) => [KINDS[x.kind] || '사람', x.name, x.title || '', x.org || '', x.phone || '', x.email || '', (x.aliases || []).join(', '), x.memo || ''])), ''].join('\n'));
  }

  // 태그 카드
  if (data.tagcards.length) {
    const tc = [...data.tagcards].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.tag.localeCompare(b.tag, 'ko'));
    files.set(`${dir}/${FILES.tagcards}`, [header('태그'),
      '> #태그(사업·행사·프로젝트)마다 설명·기간·상태를 적어 두는 카드입니다.', '',
      table(['태그', '상태', '시작', '끝', '고정', '설명'], tc.map((c) => [`#${c.tag}`, c.status === 'done' ? '끝남' : c.status === 'active' ? '진행 중' : '', c.start || '', c.end || '', c.pinned ? '📌' : '', c.memo || ''])), ''].join('\n'));
  }

  // 학사일정 자료 (연간·월중·주간 이미지/PDF 목록)
  if (data.docs.length) {
    const kinds = { annual: '연간', monthly: '월중', weekly: '주간', contacts: '연락처' };
    const dc = [...data.docs].sort((a, b) => (a.kind + (a.period || '') + a.title + String(a.rev || 1).padStart(3, '0')).localeCompare(b.kind + (b.period || '') + b.title + String(b.rev || 1).padStart(3, '0')));
    files.set(`${dir}/${FILES.docs}`, [header('학사일정 · 연락처 자료'), '> 파일은 같은 폴더의 "학사일정자료", "연락처자료" 폴더에 있습니다. 같은 제목의 문서는 판(개정판)으로 묶입니다.', '',
      ...dc.map((d) => {
        const extra = [d.uploaded ? `올림 ${d.uploaded}` : '', d.src ? `형식 ${d.src}` : '', d.pages?.length ? `쪽 ${d.pages.join(', ')}` : '', d.textFile ? `본문 ${d.textFile}` : ''].filter(Boolean);
        return `- [${kinds[d.kind] || d.kind}] ${d.period || '-'} · ${oneLine(d.title) || '-'} · ${d.rev || 1}판 · ${d.file}${extra.length ? ` · ${extra.join(' · ')}` : ''}`;
      }), ''].join('\n'));
  }

  // 일지 (하루 한 파일)
  const sv = s?.value || {};
  const dates = new Set();
  for (const c of DAY_COLS) for (const x of data[c]) dates.add(x.date);
  for (const date of [...dates].sort()) {
    const day = data.days.find((x) => x.date === date);
    const lessons = data.lessons.filter((x) => x.date === date).sort((a, b) => a.period - b.period);
    const att = data.attendance.filter((x) => x.date === date);
    const counsel = data.counsel.filter((x) => x.date === date).sort((a, b) => a.order - b.order);
    const trips = data.trips.filter((x) => x.date === date);
    const out = ['---', `날짜: ${date}`];
    if (day?.updatedAt) out.push(`최종수정: ${day.updatedAt}`);
    out.push('---', `# ${koDate(date)} 교사수첩`, '');
    out.push('## 수업일지', '');
    for (const l of lessons) {
      const fields = [l.subject, l.cls, l.room].map((x) => x || '');
      while (fields.length && !fields.at(-1)) fields.pop();
      out.push(`### ${[periodLabel(sv, l.period), ...fields.map(dash)].join(' · ')}`);
      if ((l.content || '').trim()) out.push(escBlock(l.content));
      out.push('');
    }
    out.push('## 학생출결', '');
    for (const a of att) {
      const lesson = a.periods?.length ? `[${a.periods.join('·')}교시${a.subject ? ` ${oneLine(a.subject)}` : ''}${a.cls ? ` ${a.cls}` : ''}] ` : '';
      out.push(`- ${lesson}${[lab(a.student), a.type, a.reason, oneLine(a.note)].map((x) => x || '-').join(' · ')}`);
    }
    if (att.length) out.push('');
    if (trips.length) {
      out.push('## 출장', '');
      for (const t of trips) out.push(`- ${[t.time, t.place, t.purpose].map(dash).join(' · ')}`);
      out.push('');
    }
    if (day?.note) out.push('## 노트', '', escBlock(day.note), '');
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
  const data = { settings: [], students: [], schedule: [], days: [], lessons: [], tasks: [], attendance: [], counsel: [], records: [], trips: [], notes: [], docs: [], people: [], tagcards: [] };

  // 포스트잇
  const nt = get(FILES.notes);
  if (nt != null) {
    for (const sec of sections(nt).slice(1)) {
      const lines = [...sec.lines];
      const meta = lines.findIndex((l) => /^<!--.*-->$/.test(l.trim()));
      const n = { id: makeId(), text: '', color: 'yellow', x: 0, y: 0, w: 220, h: 160 };
      if (meta >= 0) {
        for (const [, k, v] of lines[meta].matchAll(/(\w+)=(\S+)/g)) n[k] = ['x', 'y', 'w', 'h'].includes(k) ? +v : k === 'min' ? v === '1' : v;
        lines.splice(meta, 1);
      }
      n.text = unescBlock(trimBlank(lines).join('\n'));
      data.notes.push(n);
    }
  }

  // 사람·기관 (상담일지의 학생 인식에 쓰므로 일지보다 먼저)
  const pp = get(FILES.people);
  if (pp != null) {
    for (const r of parseTableObjects(pp.split('\n'))) {
      if (!(r['이름'] || '').trim()) continue;
      data.people.push(normPerson({ id: makeId(), kind: r['구분'] === '기관' ? 'org' : 'person', name: r['이름'], title: r['호칭'], org: r['소속'], phone: r['전화'], email: r['이메일'], aliases: r['다른 이름'], memo: r['메모'] }));
    }
  }

  // 태그 카드
  const tgc = get(FILES.tagcards);
  if (tgc != null) {
    for (const r of parseTableObjects(tgc.split('\n'))) {
      const tag = (r['태그'] || '').trim().replace(/^#/, '');
      if (!tag) continue;
      const c = { id: makeId(), tag };
      const st = (r['상태'] || '').trim();
      if (st === '끝남') c.status = 'done'; else if (st === '진행 중') c.status = 'active';
      if ((r['시작'] || '').trim()) c.start = r['시작'].trim();
      if ((r['끝'] || '').trim()) c.end = r['끝'].trim();
      if ((r['고정'] || '').trim()) c.pinned = true;
      if ((r['설명'] || '').trim()) c.memo = r['설명'];
      data.tagcards.push(c);
    }
  }

  // 학사일정 자료
  const dcs = get(FILES.docs);
  if (dcs != null) {
    const kinds = { 연간: 'annual', 월중: 'monthly', 주간: 'weekly', 연락처: 'contacts' };
    for (const line of dcs.split('\n')) {
      const m = line.match(/^\s*[-*]\s*\[(연간|월중|주간|연락처)\]\s*(\S+)\s*·\s*(.+)$/);
      if (!m) continue;
      const parts = m[3].split(/\s*·\s*/);
      const title = undash(parts.shift() || '');
      let rev = 1;
      if (/^\d+판$/.test(parts[0] || '')) rev = parseInt(parts.shift(), 10);
      const file = (parts.shift() || '').trim();
      const d = { id: makeId(), kind: kinds[m[1]], period: m[2] === '-' ? '' : m[2], title, file, rev };
      for (const p of parts) {
        let mm;
        if ((mm = p.match(/^올림\s+(\S+)/))) d.uploaded = mm[1];
        else if ((mm = p.match(/^형식\s+(\S+)/))) d.src = mm[1];
        else if ((mm = p.match(/^쪽\s+(.+)$/))) d.pages = mm[1].split(/\s*,\s*/).filter(Boolean);
        else if ((mm = p.match(/^본문\s+(.+)$/))) d.textFile = mm[1].trim();
      }
      if (file) data.docs.push(d);
    }
  }

  // 설정
  const st = get(FILES.settings);
  if (st != null) {
    const v = { teacherInfo: '', schoolLevel: 'elem', showModified: true, timetable: { 1: [], 2: [], 3: [], 4: [], 5: [] } };
    const range = (t) => { const m = String(t || '').match(/(\d{1,2}:\d{2})?\s*[~\-–]?\s*(\d{1,2}:\d{2})?/); return { start: m?.[1] || '', end: m?.[2] || '' }; };
    const bellRaw = {};
    for (const line of st.split('\n')) {
      let m;
      if ((m = line.match(/^-\s*교원정보\s*:\s*(.*)$/))) v.teacherInfo = fromOneLine(m[1].trim());
      else if ((m = line.match(/^-\s*학교급\s*:\s*(.*)$/))) v.schoolLevel = /중|고|second/i.test(m[1]) ? 'secondary' : 'elem';
      else if ((m = line.match(/^-\s*최종수정일시 표시\s*:\s*(.*)$/))) v.showModified = !/아니|no|false/i.test(m[1]);
      else if ((m = line.match(/^-\s*등교\s*:\s*(.*)$/))) bellRaw.arrival = range(m[1]).start;
      else if ((m = line.match(/^-\s*정규 교시\s*:\s*(\d+)/))) bellRaw.periodCount = +m[1];
      else if ((m = line.match(/^-\s*점심\s*:\s*(.*)$/))) {
        const after = m[1].match(/(\d+)\s*교시/);
        bellRaw.lunch = /없음/.test(m[1]) ? { start: '', end: '', after: 0 } : { ...range(m[1]), after: after ? +after[1] : 4 };
      } else if ((m = line.match(/^-\s*저녁\s*:\s*(.*)$/))) bellRaw.dinner = /없음/.test(m[1]) ? { enabled: false } : { enabled: true, ...range(m[1]) };
      else if ((m = line.match(/^-\s*수업 시간\s*:\s*(\d+)\s*분(?:\s*,\s*쉬는 시간\s*:\s*(\d+)\s*분)?/))) { bellRaw.lessonLen = +m[1]; if (m[2]) bellRaw.breakLen = +m[2]; }
      else if ((m = line.match(/^-\s*수능대비 시간표\s*:\s*[^(]*(?:\(점심\s*([^,]*),\s*4교시\s*([^)]*)\))?/))) {
        bellRaw.csat = { lunch: range(m[1]), p4: range(m[2]) };
      }
    }
    const tsec = sections(st).find((x) => x.title === '기본 시간표');
    if (tsec) {
      const all = tsec.lines.filter((l) => /^\s*\|/.test(l)).map(splitRow);
      const hasTime = (all[0] || []).some((c) => c === '시간');
      const off = hasTime ? 2 : 1;
      const times = [];
      const evening = [];
      for (const r of parseTable(tsec.lines)) {
        let p = /^\d+\s*(교시)?$/.test(r[0]) ? parseInt(r[0], 10) : null;
        if (p == null && r[0]) { evening.push({ label: r[0], ...range(hasTime ? r[1] : '') }); p = EVENING_BASE + evening.length; }
        if (!p) continue;
        if (p <= EVENING_BASE && hasTime) times[p - 1] = range(r[1]);
        for (let d = 1; d <= 5; d++) if (r[d + off - 1]) v.timetable[d][p - 1] = ttParse(r[d + off - 1]);
      }
      for (let d = 1; d <= 5; d++) v.timetable[d] = Array.from(v.timetable[d], (x) => x || '');
      bellRaw.times = Array.from(times, (t) => t || { start: '', end: '' });
      while (bellRaw.times.length && !bellRaw.times.at(-1).start && !bellRaw.times.at(-1).end) bellRaw.times.pop();
      bellRaw.evening = evening;
    }
    if (Object.keys(bellRaw).length) v.bell = rawBell({ schoolLevel: v.schoolLevel, bell: bellRaw });
    const listOf = (title) => {
      const sec = sections(st).find((x) => x.title === title);
      return sec ? sec.lines.map((l) => l.match(/^\s*[-*]\s+(.+)$/)?.[1].trim()).filter((x) => x && x !== '(없음)').map(fromOneLine) : [];
    };
    v.courses = listOf('내 수업').map((x) => { const [name, short] = x.split(/\s*\|\s*/); return short ? { name, short } : name; });
    v.rooms = listOf('교실·실습실'); v.classes = listOf('담당 학반');
    const hsec = sections(st).find((x) => x.title === '담임');
    v.homerooms = {};
    if (hsec) for (const r of parseTableObjects(hsec.lines)) if (r['학반']) v.homerooms[r['학반']] = { main: r['담임'] || '', sub: r['부담임'] || '' };
    data.settings.push({ id: makeId(), key: 'main', value: v });
  }

  // 학생명단
  const stu = get(FILES.students);
  if (stu != null) {
    const num = (x) => (x === '' || x == null || isNaN(+x) ? null : +x);
    for (const r of parseTableObjects(stu.split('\n'))) {
      const name = (r['이름'] || '').trim();
      if (!name) continue;
      const st = { id: makeId(), uid: (r.ID || '').trim() || newUid(), studentNo: (r['학번'] || '').trim(), grade: num(r['학년']), cls: num(r['반']), no: num(r['번호']), name, photo: (r['사진'] || '').trim() };
      for (const [k, col] of [['gender', '성별'], ['email', '이메일'], ['phone', '전화번호']]) if ((r[col] || '').trim()) st[k] = r[col].trim();
      data.students.push(st);
    }
  }

  // 학사일정
  const sch = get(FILES.schedule);
  if (sch != null) {
    for (const line of sch.split('\n')) {
      const m = line.match(/^\s*[-*]\s*(\d{4}-\d{2}-\d{2})\s*[:：]?\s*(.*)$/);
      if (!m || !m[2].trim()) continue;
      let rest = m[2].trim();
      const flags = {};
      let fm;
      while ((fm = rest.match(/^\[(휴업|수능대비)\]\s*/))) { flags[fm[1]] = true; rest = rest.slice(fm[0].length); }
      const item = { id: makeId(), date: m[1], text: fromOneLine(rest.trim()) };
      if (flags['휴업']) item.holiday = true;
      if (flags['수능대비']) item.csat = true;
      data.schedule.push(item);
    }
  }

  // 업무일지
  const tk = get(FILES.tasks);
  if (tk != null) {
    for (const line of tk.split('\n')) {
      const m = line.match(/^\s*[-*]\s*\[([ xX])\]\s*(.*)$/);
      if (!m) continue;
      let text = m[2], created = null, done = null;
      let due = null;
      let order = null, priority = null;
      const meta = text.match(/\s*\(작성\s*(\d{4}-\d{2}-\d{2})(?:\s*,\s*마감\s*(\d{4}-\d{2}-\d{2}))?(?:\s*,\s*완료\s*(\d{4}-\d{2}-\d{2}))?(?:\s*,\s*순서\s*(\d+))?\)\s*$/);
      if (meta) { text = text.slice(0, meta.index); created = meta[1]; due = meta[2] || null; done = meta[3] || null; order = meta[4] ? +meta[4] : null; }
      const pm = text.match(/^\((A|B|C|언젠가)\)\s*/i);
      if (pm) { priority = { a: 'A', b: 'B', c: 'C' }[pm[1].toLowerCase()] || 'Z'; text = text.slice(pm[0].length); }
      created ||= `${year}-03-01`;
      if (m[1].toLowerCase() === 'x' && !done) done = created;
      if (m[1] === ' ') done = null;
      if (!text.trim()) continue;
      const t = { id: makeId(), text: fromOneLine(text.trim()), created, doneDate: done };
      if (due) t.due = due;
      if (priority) t.priority = priority;
      if (order != null) t.order = order;
      data.tasks.push(t);
    }
  }

  // 학급요록
  const rc = get(FILES.records);
  if (rc != null) {
    for (const sec of sections(rc).slice(1)) {
      const created = sec.lines.map((l) => l.match(/^-\s*등록\s*:\s*(\d{4}-\d{2}-\d{2})/)).find(Boolean)?.[1] || `${year}-03-01`;
      const done = sec.lines.map((l) => l.match(/^-\s*완료\s*:\s*(\d{4}-\d{2}-\d{2})/)).find(Boolean)?.[1] || null;
      const target = sec.lines.map((l) => l.match(/^-\s*대상\s*:\s*(.+)$/)).find(Boolean)?.[1].trim() || '';
      const entries = {};
      for (const r of parseTable(sec.lines)) if (r[0] && (r[1] || '').trim()) entries[r[0]] = r[1];
      const rec = { id: makeId(), title: fromOneLine(sec.title), created, doneDate: done, entries };
      if (target) rec.cls = target;
      data.records.push(rec);
    }
  }

  // 일지
  const sv = data.settings[0]?.value || {};
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
    let note = '';
    for (const sec of sections(body)) {
      if (sec.title == null) continue;
      if (sec.title === '수업일지') {
        for (const ls of sections(sec.lines.join('\n'), 3).slice(1)) {
          const m = ls.title.match(/^(.+?)\s*(?:(?:[·:]|\s-\s)\s*(.*))?$/);
          const period = m && parsePeriodLabel(sv, m[1]);
          if (!period) continue;
          const [subject, cls, room] = (m[2] || '').split(/\s*·\s*/).map(undash);
          data.lessons.push({ id: makeId(), date, period, subject: subject || '', cls: cls || '', room: room || '', content: unescBlock(trimBlank(ls.lines).join('\n')) });
        }
      } else if (sec.title === '학생출결') {
        for (const line of sec.lines) {
          const m = line.match(/^\s*[-*]\s+(.+)$/);
          if (!m) continue;
          let rest = m[1];
          const lm = rest.match(/^\[(\d+(?:[·,]\d+)*)교시\s*([^\]]*)\]\s*/);
          const lesson = {};
          if (lm) {
            rest = rest.slice(lm[0].length);
            lesson.periods = lm[1].split(/[·,]/).map(Number);
            const words = lm[2].trim().split(/\s+/).filter(Boolean);
            if (words.length && /^\d+-\d+$/.test(words.at(-1))) lesson.cls = words.pop();
            if (words.length) lesson.subject = fromOneLine(words.join(' '));
          }
          const [student, type, reason, ...note] = rest.split(/\s*·\s*/).map((x) => (x === '-' ? '' : x.trim()));
          if (student) data.attendance.push({ id: makeId(), date, student, type: type || '', reason: reason || '', note: fromOneLine(note.join(' · ')), ...lesson });
        }
      } else if (sec.title === '상담일지') {
        splitParagraphs(unescBlock(trimBlank(sec.lines).join('\n'))).forEach((t, i) => {
          data.counsel.push({ id: makeId(), date, order: i, text: t, students: mentionedStudentUids(t, data.students, data.people) });
        });
      } else if (sec.title === '노트') {
        note = unescBlock(trimBlank(sec.lines).join('\n'));
      } else if (sec.title === '출장') {
        for (const line of sec.lines) {
          const m = line.match(/^\s*[-*]\s+(.+)$/);
          if (!m) continue;
          const [time, place, ...purpose] = m[1].split(/\s*·\s*/);
          data.trips.push({ id: makeId(), date, time: undash(time), place: undash(place), purpose: undash(purpose.join(' · ')) });
        }
      } else {
        extra.push(`## ${sec.title}\n${trimBlank(sec.lines).join('\n')}`);
      }
    }
    const day = { id: makeId(), date, updatedAt };
    if (extra.length) day.extra = extra.join('\n\n');
    if (note) day.note = note;
    data.days.push(day);
  }
  return data;
}
