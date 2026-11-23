// 학생 식별
// - 학생 레코드는 학년도마다 따로 있다: { id, uid, studentNo(학번), grade, cls, no, name, photo }
// - uid 는 학년도가 바뀌어도 유지되는 학생 고유 ID (지난 학년도 기록 연결용). 학번은 해마다 바뀐다.
// - 상담·출결·요록은 uid 로 학생을 가리킨다. 파일에는 사람이 읽을 수 있는 "학번 이름" 으로 쓰고, 읽을 때 다시 uid 로 바꾼다.
// - 더 있는 칸: entryYear(입학 학년도), dept(학과, 비우면 설정의 학과 규칙으로), pastNos({1:'1학년 때 학번', 2:'2학년 때 학번'})
// - 신입생(입학 예정)은 "임시1101" 처럼 임시 학번을 쓰다가 정식 학번을 받는다.

export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const newUid = () => `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** 학번 글자 다듬기: 숫자만, 앞의 "임시"는 살린다 ("임시 1101" → "임시1101") */
export function cleanNo(v) {
  const t = String(v ?? '').trim();
  const d = t.match(/\d+/)?.[0] || '';
  return d && /^임시/.test(t) ? `임시${d}` : d;
}
/** 학번 → 학년·반·번호 (5자리 10203, 4자리 2105, 임시1101 도) */
export function partsOfNo(no) {
  const d = String(no ?? '').replace(/^임시/, '');
  const m = d.match(/^(\d)(\d{2})(\d{2})$/) || d.match(/^(\d)(\d)(\d{2})$/);
  return m ? { grade: +m[1], cls: +m[2], no: +m[3] } : null;
}

/** 학번 ↔ 학년/반/번호 보완 (5자리 학번: 학년1 + 반2 + 번호2, 예: 10203) */
export function normStudent(s) {
  const out = { ...s };
  out.studentNo = String(out.studentNo ?? '').trim();
  const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
  out.grade = num(out.grade); out.cls = num(out.cls); out.no = num(out.no);
  const ey = num(out.entryYear);
  if (ey && ey > 1900) out.entryYear = ey; else delete out.entryYear;
  out.dept = String(out.dept ?? '').trim();
  if (!out.dept) delete out.dept;
  if (out.pastNos && typeof out.pastNos === 'object') {
    const p = {};
    for (const [g, v] of Object.entries(out.pastNos)) { const c = cleanNo(v); if (c && +g >= 1) p[+g] = c; }
    if (Object.keys(p).length) out.pastNos = p; else delete out.pastNos;
  } else delete out.pastNos;
  // 5자리(학년1+반2+번호2, 예: 10203) 또는 4자리(학년1+반1+번호2, 예: 2105), 앞에 "임시" 가 붙어도
  const pn = partsOfNo(out.studentNo);
  const m = pn ? [null, pn.grade, pn.cls, pn.no] : null;
  if (m) {
    out.grade ??= +m[1]; out.cls ??= +m[2]; out.no ??= +m[3];
  } else if (!out.studentNo && !out.entryYear && out.grade && out.cls && out.no != null) {
    out.studentNo = `${out.grade}${String(out.cls).padStart(2, '0')}${String(out.no).padStart(2, '0')}`;
  }
  out.name = String(out.name ?? '').trim();
  for (const k of ['gender', 'email', 'phone']) if (out[k] != null) out[k] = String(out[k]).trim();
  if (Array.isArray(out.statusLog)) {
    out.statusLog = out.statusLog.filter((e) => e && e.date && e.type).map((e) => {
      const x = { date: String(e.date), type: String(e.type) };
      if (e.grade != null && e.grade !== '' && !isNaN(+e.grade)) x.grade = +e.grade;
      if ((e.memo || '').trim()) x.memo = String(e.memo).trim();
      return x;
    }).sort((a, b) => a.date.localeCompare(b.date));
    if (!out.statusLog.length) delete out.statusLog;
  }
  if (out.leaving && !out.leaving.type) delete out.leaving;
  if (Array.isArray(out.flags)) { out.flags = FLAGS.map(([k]) => k).filter((k) => out.flags.includes(k)); if (!out.flags.length) delete out.flags; }
  if (!(out.flagMemo || '').trim()) delete out.flagMemo;
  return out;
}

// ---------- 학적 (휴학·복학·자퇴·전출…) ----------
// 학생마다 날짜별 이력 statusLog: [{date, type, grade?, memo?}] 을 쌓고, "지금 상태"는 보는 날짜 기준으로 계산한다.
export const STATUS_EVENTS = ['전입', '휴학', '복학', '재입학', '학년 변경', '자퇴', '전출', '퇴학', '기타'];
/** 학년을 함께 고르는 변동 (복학·재입학 때 다른 학년으로 가거나 승급하는 경우) */
export const EVENT_HAS_GRADE = new Set(['전입', '복학', '재입학', '학년 변경']);
const LEAVE_EVENTS = new Set(['휴학']);
const GONE_EVENTS = new Set(['자퇴', '전출', '퇴학']);
export const STATE_LABEL = { active: '재학', leave: '휴학', gone: '떠남', pre: '입학 예정' };
/** 전출 예정 종류 → 날짜가 되면 학적에 넣을 변동 */
export const LEAVING_TYPES = { 전학: '전출', 자퇴: '자퇴', 퇴학: '퇴학', 기타: '기타' };
/** 티 나지 않는 표시: 화면에는 글자 없이 작은 점, 파일에는 기호로 */
export const FLAGS = [['good', '우수', '◆'], ['watch', '관심', '●']];

/** date 기준 학적 상태 → { state: active|leave|gone, ev: 마지막 변동(기타 제외) } */
export function statusAt(st, date) {
  // 입학 학년도가 아직 안 된 학생 (예비소집·내년 신입생)
  if (st?.entryYear && date) {
    const [y, m] = date.split('-').map(Number);
    const sy = m >= 3 ? y : y - 1;
    if (st.entryYear > sy) return { state: 'pre', ev: null };
  }
  let ev = null;
  for (const e of st?.statusLog || []) if (e.date <= date && e.type !== '기타') ev = e;
  const state = !ev ? 'active' : LEAVE_EVENTS.has(ev.type) ? 'leave' : GONE_EVENTS.has(ev.type) ? 'gone' : 'active';
  return { state, ev };
}
export const isActiveOn = (st, date) => statusAt(st, date).state === 'active';

/** 학적 이력 ↔ 파일 한 칸: "2026-03-02 휴학 - 질병; 2026-09-01 복학(2학년)" */
export function logToText(log) {
  return (log || []).map((e) => `${e.date} ${e.type}${e.grade ? `(${e.grade}학년)` : ''}${e.memo ? ` - ${e.memo.replace(/;/g, '；')}` : ''}`).join('; ');
}
const LOG_RE = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})\\s+(${STATUS_EVENTS.map(escapeRe).join('|')})(?:\\((\\d+)학년\\))?(?:\\s+-\\s+(.*))?$`);
export function textToLog(text) {
  return String(text || '').split(/;\s*/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = x.match(LOG_RE);
    if (!m) return null;
    const e = { date: m[1], type: m[2] };
    if (m[3]) e.grade = +m[3];
    if (m[4]) e.memo = m[4].trim();
    return e;
  }).filter(Boolean);
}
/** 전출 예정 ↔ "전학 2026-12-01 - 이사" */
export const leavingToText = (l) => (l?.type ? `${l.type}${l.date ? ` ${l.date}` : ''}${l.memo ? ` - ${l.memo}` : ''}` : '');
export function textToLeaving(text) {
  const m = String(text || '').trim().match(/^(\S+)(?:\s+(\d{4}-\d{2}-\d{2}))?(?:\s+-\s+(.*))?$/);
  if (!m || !LEAVING_TYPES[m[1]]) return null;
  const l = { type: m[1] };
  if (m[2]) l.date = m[2];
  if (m[3]) l.memo = m[3].trim();
  return l;
}
export const flagsToText = (flags) => FLAGS.filter(([k]) => (flags || []).includes(k)).map(([, , sym]) => sym).join('');
export const textToFlags = (text) => FLAGS.filter(([, , sym]) => String(text || '').includes(sym)).map(([k]) => k);

export const classKey = (s) => (s?.grade && s?.cls ? `${s.grade}-${s.cls}` : '');
export const studentLabel = (s) => (s ? (s.studentNo ? `${s.studentNo} ${s.name}` : s.name) : '');

/** 학년-반-번호 순. year 를 주면 입학 예정(내년 신입생)은 맨 뒤로 */
export function sortStudents(list, year = 0) {
  const pre = (s) => (year && s.entryYear > year ? 1 : 0);
  return [...list].sort((a, b) => pre(a) - pre(b) || (a.grade ?? 99) - (b.grade ?? 99) || (a.cls ?? 99) - (b.cls ?? 99) || (a.no ?? 999) - (b.no ?? 999) || String(a.name).localeCompare(String(b.name), 'ko'));
}

// ---------- 입학 학년도·학과 ----------
/** 입학 학년도: 적어 둔 값, 없으면 지금 학년도와 학년으로 어림 (2026학년도 2학년 → 2025) */
export const entryYearOf = (s, year) => s?.entryYear || (year && s?.grade ? year - s.grade + 1 : null);

/**
 * 학과 규칙 글 → [{from, to, c1, c2, name}]
 * 한 줄에 하나: "2024~2026 1~4반 뉴미디어소프트웨어과", "2027~ 5~6반 지능형디자인과", "2025 3반 ○○과"
 */
export function parseDeptRules(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.trim().match(/^(\d{4})\s*(?:학년도|년)?\s*(?:([~\-～])\s*(\d{4})?)?\s*(?:학년도|년)?\s*(?:입학생?)?\s*[,·]?\s*(\d{1,2})\s*(?:반)?\s*(?:[~\-～]\s*(\d{1,2}))?\s*반\s*[:：]?\s*(.+)$/);
    if (!m) continue;
    const from = +m[1], to = m[3] ? +m[3] : m[2] ? 9999 : from;
    const c1 = +m[4], c2 = m[5] ? +m[5] : c1;
    out.push({ from, to, c1: Math.min(c1, c2), c2: Math.max(c1, c2), name: m[6].trim() });
  }
  return out;
}

/** 학과: 적어 둔 값, 없으면 규칙(입학 학년도·반)으로 */
export function deptOf(s, rules, year) {
  if (s?.dept) return s.dept;
  const ey = entryYearOf(s, year);
  if (!ey || !s?.cls) return '';
  return rules.find((r) => ey >= r.from && ey <= r.to && s.cls >= r.c1 && s.cls <= r.c2)?.name || '';
}

/** 학반 목록 (정렬) */
export function classKeys(students) {
  return [...new Set(students.map(classKey).filter(Boolean))].sort((a, b) => {
    const [ag, ac] = a.split('-').map(Number), [bg, bc] = b.split('-').map(Number);
    return ag - bg || ac - bc;
  });
}

export function buildIndex(students) {
  const byUid = new Map(), byNo = new Map(), byName = new Map();
  for (const s of students) {
    if (s.uid) byUid.set(s.uid, s);
    if (s.studentNo) byNo.set(s.studentNo, s);
    if (s.name) byName.set(s.name, [...(byName.get(s.name) || []), s]);
  }
  return { byUid, byNo, byName, list: students };
}

/** 참조(uid / 학번 / "학번 이름" / "이름(학번)" / 이름)를 학생으로 해석. 못 찾으면 null */
export function resolveRef(ref, idx) {
  const r = String(ref ?? '').trim();
  if (!r) return null;
  if (idx.byUid.has(r)) return idx.byUid.get(r);
  let m = r.match(/^((?:임시)?\d{3,})\s*(.*)$/);
  if (m && idx.byNo.has(m[1])) return idx.byNo.get(m[1]);
  m = r.match(/^(.+?)\s*\(((?:임시)?\d{3,})\)$/);
  if (m && idx.byNo.has(m[2])) return idx.byNo.get(m[2]);
  const same = idx.byName.get(r);
  if (same?.length === 1) return same[0];
  return null;
}

/** 참조를 uid 로 (못 찾으면 원래 문자열 유지) */
export const toUid = (ref, idx) => resolveRef(ref, idx)?.uid || String(ref ?? '');

/** 화면 표시용 이름 */
export const labelOf = (ref, idx) => { const s = resolveRef(ref, idx); return s ? studentLabel(s) : String(ref ?? ''); };

// ---------- 상담 일지 속 학생 인식 ----------
// 규칙: "학번 이름", "이름(학번)", 또는 (명단에 하나뿐인) "이름" 뒤에 띄어쓰기/구두점/끝
// 이름 뒤에 붙는 조사: 고은별이, 고은별이가, 고은별에게, 고은별을 …
export const PARTICLE = '(?:이(?:가|는|를|의|도|랑|와|만|에게|한테|하고|께서)?|가|은|는|을|를|의|도|만|와|과|랑|하고|에게서|에게|에서|에|한테|께서|께|로|으로|처럼|보다|부터|까지)?';
export const AFTER = `(?=${PARTICLE}(?:[\\s,.:;!?)\\]]|$))`;
export const BEFORE = '(^|[^0-9A-Za-z가-힣])';

function patterns(students) {
  const idx = buildIndex(students);
  const pats = [];
  for (const s of students) {
    if (!s.name) continue;
    if (s.studentNo) {
      pats.push({ re: `${escapeRe(s.studentNo)}\\s*${escapeRe(s.name)}`, s });
      pats.push({ re: `${escapeRe(s.name)}\\(${escapeRe(s.studentNo)}\\)`, s });
    }
    if (idx.byName.get(s.name).length === 1) pats.push({ re: escapeRe(s.name), s });
  }
  // 긴 패턴(학번 포함)이 먼저 맞도록
  return pats.sort((a, b) => b.re.length - a.re.length);
}

/** 텍스트를 [{text, uid?}] 로 분해 */
export function tokenizeStudents(text, students) {
  const pats = patterns(students);
  if (!pats.length) return [{ text }];
  const re = new RegExp(`${BEFORE}(${pats.map((p) => `(${p.re})`).join('|')})${AFTER}`, 'g');
  const out = [];
  let last = 0, m;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    const gi = m.slice(3).findIndex((g) => g !== undefined);
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: m[2], uid: pats[gi].s.uid });
    last = start + m[2].length;
    re.lastIndex = last;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** 텍스트에서 언급된 학생 uid 목록 (중복 제거, 등장 순) */
export function mentionedUids(text, students) {
  return [...new Set(tokenizeStudents(text, students).filter((t) => t.uid).map((t) => t.uid))];
}

/** 파일 이름에서 학생 찾기 (사진 일괄 등록): 학번 우선, 다음 이름(유일할 때) */
export function matchPhotoFile(filename, students) {
  const base = filename.replace(/\.[^.]+$/, '');
  const idx = buildIndex(students);
  for (const m of base.matchAll(/\d{4,}/g)) if (idx.byNo.has(m[0])) return idx.byNo.get(m[0]);
  const names = [...idx.byName.keys()].sort((a, b) => b.length - a.length);
  for (const n of names) if (base.includes(n) && idx.byName.get(n).length === 1) return idx.byName.get(n)[0];
  return null;
}

/** 검색어로 학생 찾기: "2105 고은별이", "고은별에게" 처럼 조사가 붙어도 찾는다 */
export function searchStudents(query, students) {
  const q = String(query || '').trim();
  if (!q) return students;
  const tokens = q.split(/\s+/).map((t) => t.replace(new RegExp(`${PARTICLE}$`), '') || t);
  return students.filter((s) => {
    const hay = `${s.studentNo || ''} ${s.name || ''} ${classKey(s)}`;
    return tokens.every((t) => hay.includes(t) || (t.length > 1 && hay.includes(t.slice(0, -1))));
  });
}
