// 학생 식별
// - 학생 레코드는 학년도마다 따로 있다: { id, uid, studentNo(학번), grade, cls, no, name, photo }
// - uid 는 학년도가 바뀌어도 유지되는 학생 고유 ID (지난 학년도 기록 연결용). 학번은 해마다 바뀐다.
// - 상담·출결·요록은 uid 로 학생을 가리킨다. 파일·노션에는 사람이 읽을 수 있는 "학번 이름" 으로 쓰고, 읽을 때 다시 uid 로 바꾼다.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const newUid = () => `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** 학번 ↔ 학년/반/번호 보완 (5자리 학번: 학년1 + 반2 + 번호2, 예: 10203) */
export function normStudent(s) {
  const out = { ...s };
  out.studentNo = String(out.studentNo ?? '').trim();
  const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
  out.grade = num(out.grade); out.cls = num(out.cls); out.no = num(out.no);
  // 5자리(학년1+반2+번호2, 예: 10203) 또는 4자리(학년1+반1+번호2, 예: 2105)
  const m = out.studentNo.match(/^(\d)(\d{2})(\d{2})$/) || out.studentNo.match(/^(\d)(\d)(\d{2})$/);
  if (m) {
    out.grade ??= +m[1]; out.cls ??= +m[2]; out.no ??= +m[3];
  } else if (!out.studentNo && out.grade && out.cls && out.no != null) {
    out.studentNo = `${out.grade}${String(out.cls).padStart(2, '0')}${String(out.no).padStart(2, '0')}`;
  }
  out.name = String(out.name ?? '').trim();
  for (const k of ['gender', 'email', 'phone']) if (out[k] != null) out[k] = String(out[k]).trim();
  return out;
}

export const classKey = (s) => (s?.grade && s?.cls ? `${s.grade}-${s.cls}` : '');
export const studentLabel = (s) => (s ? (s.studentNo ? `${s.studentNo} ${s.name}` : s.name) : '');

export function sortStudents(list) {
  return [...list].sort((a, b) => (a.grade ?? 99) - (b.grade ?? 99) || (a.cls ?? 99) - (b.cls ?? 99) || (a.no ?? 999) - (b.no ?? 999) || String(a.name).localeCompare(String(b.name), 'ko'));
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
  let m = r.match(/^(\d{3,})\s*(.*)$/);
  if (m && idx.byNo.has(m[1])) return idx.byNo.get(m[1]);
  m = r.match(/^(.+?)\s*\((\d{3,})\)$/);
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
export const PARTICLE = '(?:이(?:가|는|를|의|도|랑|와|만|에게|한테|하고|께서)?|가|은|는|을|를|의|도|만|와|과|랑|하고|에게서|에게|한테|께서|께|로|으로|처럼|보다|부터|까지)?';
const AFTER = `(?=${PARTICLE}(?:[\\s,.:;!?)\\]]|$))`;
const BEFORE = '(^|[^0-9A-Za-z가-힣])';

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
