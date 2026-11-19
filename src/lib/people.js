// 사람·기관 명부: 선생님·장학사·외부 강사 같은 사람과 교육청·대학·업체 같은 기관
// - 레코드: { id, kind: 'person'|'org', name, title(호칭·직위), org(소속), phone, email, aliases: [다른 이름], memo }
// - 글 속에서 학생처럼 알아본다.
//   사람: "김민수 선생님", "김민수쌤이"처럼 호칭이 붙으면 언제나, 호칭이 없으면 명부에 하나뿐이고 같은 이름의 학생이 없을 때만
//   기관: 이름이나 다른 이름(별칭)이 명부에 하나뿐일 때
//   이름·호칭 뒤에 조사가 붙어도 된다 ("교육청에", "김민수 선생님께")
import { tokenizeStudents, escapeRe, BEFORE, AFTER } from './students.js';

export const KINDS = { person: '사람', org: '기관' };

// 긴 것부터 맞춰야 "교장선생님"이 "교장"으로 잘리지 않는다
export const TITLES = ['교장선생님', '교감선생님', '선생님', '선생', '쌤', '샘', '교장님', '교감님', '교장', '교감', '수석님', '수석교사', '부장님', '부장',
  '주무관님', '주무관', '장학사님', '장학사', '장학관님', '장학관', '연구사님', '연구사', '연구관님', '연구관', '교수님', '교수', '강사님', '강사',
  '팀장님', '팀장', '과장님', '과장', '실장님', '실장', '주임님', '주임', '대표님', '대표', '님', '씨'];
const TITLE_RE = `(?:${[...TITLES].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})`;

const str = (v) => String(v ?? '').trim();

export function normPerson(p) {
  const out = { ...p };
  out.kind = p.kind === 'org' ? 'org' : 'person';
  for (const k of ['name', 'title', 'org', 'phone', 'email', 'memo']) out[k] = str(p[k]);
  const al = Array.isArray(p.aliases) ? p.aliases : String(p.aliases ?? '').split(/[,，、]/);
  out.aliases = [...new Set(al.map(str).filter((a) => a && a !== out.name))];
  return out;
}

/** 화면에 보일 이름: "김민수 선생님", "경기도교육청" */
export const personLabel = (p) => (p ? [p.name, p.kind === 'org' ? '' : p.title].filter(Boolean).join(' ') : '');
/** 이름 + 다른 이름 (두 글자 이상) */
export const namesOf = (p) => [p.name, ...(p.aliases || [])].map(str).filter((n) => n.length >= 2);

export function sortPeople(list) {
  return [...list].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'org' ? 1 : -1) || String(a.name).localeCompare(String(b.name), 'ko'));
}

// ---------- 글 속에서 알아보기 ----------
let memo = { key: '', re: null, pats: [] };

function compiled(people, students) {
  const key = JSON.stringify([people.map((p) => [p.id, p.kind, namesOf(p)]), students.map((s) => s.name)]);
  if (memo.key === key) return memo;
  const studentNames = new Set(students.map((s) => s.name));
  const count = new Map();
  for (const p of people) for (const n of new Set(namesOf(p))) count.set(n, (count.get(n) || 0) + 1);
  const pats = [];
  for (const p of people) {
    for (const n of new Set(namesOf(p))) {
      if (p.kind !== 'org') pats.push({ re: `${escapeRe(n)} ?${TITLE_RE}`, p, len: n.length + 100 });
      if (count.get(n) === 1 && (p.kind === 'org' || !studentNames.has(n))) pats.push({ re: escapeRe(n), p, len: n.length });
    }
  }
  pats.sort((a, b) => b.len - a.len);
  const re = pats.length ? new RegExp(`${BEFORE}(${pats.map((x) => `(${x.re})`).join('|')})${AFTER}`, 'g') : null;
  memo = { key, re, pats };
  return memo;
}

/** 텍스트를 [{text, pid?}] 로 (사람·기관만) */
export function tokenizePeople(text, people = [], students = []) {
  const s = String(text ?? '');
  const { re, pats } = compiled(people, students);
  if (!re) return [{ text: s }];
  re.lastIndex = 0;
  const out = [];
  let last = 0, m;
  while ((m = re.exec(s))) {
    const start = m.index + m[1].length;
    const gi = m.slice(3).findIndex((g) => g !== undefined);
    if (start > last) out.push({ text: s.slice(last, start) });
    out.push({ text: m[2], pid: pats[gi].p.id });
    last = start + m[2].length;
    re.lastIndex = last;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

/** 텍스트를 [{text, uid?, pid?}] 로: 사람·기관(호칭이 붙은 이름 포함)을 먼저, 나머지에서 학생을 찾는다 */
export function tokenizeMentions(text, students = [], people = []) {
  return tokenizePeople(text, people, students).flatMap((t) => (t.pid ? [t] : tokenizeStudents(t.text, students)));
}

export const mentionedPids = (text, students, people) =>
  [...new Set(tokenizePeople(text, people, students).filter((t) => t.pid).map((t) => t.pid))];

/** 학생 uid 목록 ("김민수 선생님"은 같은 이름 학생이 있어도 학생으로 치지 않는다) */
export const mentionedStudentUids = (text, students, people = []) =>
  [...new Set(tokenizeMentions(text, students, people).filter((t) => t.uid).map((t) => t.uid))];

// ---------- 기록에서 아직 등록 안 한 이름 찾기 ----------
const FIND_RE = /(^|[^가-힣])([가-힣]{2,4}) ?(교장선생님|교감선생님|선생님|쌤|장학사님?|장학관님?|주무관님?|연구사님?|교수님|강사님|부장님)/g;
const NOT_NAMES = new Set(('담임 부담임 담당 교과 학년부 보건 상담 영양 사서 원어민 전담 기간제 교무 연구 학생부 진로 전문 외부 다른 우리 여러 모든 해당 관리 '
  + '부장 교감 교장 수석 신규 강사 방과후 체육 음악 미술 영어 수학 과학 국어 사회 정보 기술 가정 도덕 역사 지리 물리 화학 생물 생명과학 지구과학 한문 '
  + '일본어 중국어 특수 돌봄 협력 희망 멘토 지도 감독 시험 실무사 행정실 교육청 학교 센터 담당자 각반 학급 반별 동료 옆반 앞반 교육 교육과정 '
  + '평가 업무 행정 예비 수업 교생 실습 주임 학년 이전 새로 주무').split(' '));

/** 기록 글들에서 "○○○ 선생님" 처럼 호칭이 붙었지만 명부에 없는 이름 → [{name, title, count}] (많은 순) */
export function findUnregistered(texts, people = []) {
  const known = new Set(people.flatMap(namesOf));
  const found = new Map();
  for (const t of texts) {
    for (const m of String(t || '').matchAll(FIND_RE)) {
      const name = m[2];
      if (NOT_NAMES.has(name) || known.has(name)) continue;
      const f = found.get(name) || { name, title: m[3], count: 0 };
      f.count++;
      found.set(name, f);
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));
}

/** 붙여넣은 여러 줄 → 명부 레코드: "이름, 호칭, 소속, 전화, 이메일" (쉼표 또는 탭) */
export function parsePeopleLines(text, kind = 'person') {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const c = l.split(/\t|,/).map(str);
    if (kind === 'org') return normPerson({ kind, name: c[0], phone: c[1], email: c[2], memo: c.slice(3).join(', ') });
    return normPerson({ kind, name: c[0], title: c[1], org: c[2], phone: c[3], email: c[4], memo: c.slice(5).join(', ') });
  }).filter((p) => p.name);
}
