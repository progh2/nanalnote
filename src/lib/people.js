// 사람·기관 명부: 선생님·장학사·외부 강사 같은 사람과 교육청·대학·업체 같은 기관
// - 레코드: { id, kind: 'person'|'org', name, title(호칭·직위, 쉼표로 여러 개), org(소속), phone, email, aliases: [다른 이름], memo,
//            teacher(교원 여부), level('초등'|'중등'), subject(교과) }
// - 글 속에서 학생처럼 알아본다.
//   사람: "김민수 선생님", "김민수쌤이"처럼 호칭이 붙으면 언제나, 호칭이 없으면 명부에 하나뿐이고 같은 이름의 학생이 없을 때만
//   기관: 이름이나 다른 이름(별칭)이 명부에 하나뿐일 때
//   이름·호칭 뒤에 조사가 붙어도 된다 ("교육청에", "김민수 선생님께")
import { tokenizeStudents, escapeRe, BEFORE, AFTER } from './students.js';

export const KINDS = { person: '사람', org: '기관' };

// 긴 것부터 맞춰야 "교장선생님"이 "교장"으로 잘리지 않는다
// 'T' 는 "정다온T" 처럼 이름에 붙여 쓰는 선생님 줄임
export const TITLES = ['교장선생님', '교감선생님', '선생님', '선생', '쌤', '샘', 'T', '교장님', '교감님', '교장', '교감', '수석님', '수석교사', '부장님', '부장',
  '주무관님', '주무관', '장학사님', '장학사', '장학관님', '장학관', '연구사님', '연구사', '연구관님', '연구관', '교수님', '교수', '강사님', '강사',
  '팀장님', '팀장', '과장님', '과장', '실장님', '실장', '주임님', '주임', '대표님', '대표', '님', '씨'];
const TITLE_RE = `(?:${[...TITLES].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})`;

const str = (v) => String(v ?? '').trim();

export function normPerson(p) {
  const out = { ...p };
  out.kind = p.kind === 'org' ? 'org' : 'person';
  for (const k of ['name', 'org', 'phone', 'email', 'memo', 'subject']) out[k] = str(p[k]);
  // 호칭·직위: 쉼표로 여러 개 (겸임) → "부장, 선생님"
  out.title = titlesOf(p).join(', ');
  if (out.kind === 'person' && (p.teacher === true || p.teacher === 'true')) out.teacher = true; else delete out.teacher;
  out.level = LEVELS.includes(p.level) ? p.level : '';
  if (!out.teacher) { out.level = ''; }
  if (!out.level) delete out.level;
  if (!out.subject) delete out.subject;
  const al = Array.isArray(p.aliases) ? p.aliases : String(p.aliases ?? '').split(/[,，、]/);
  out.aliases = [...new Set(al.map(str).filter((a) => a && a !== out.name))];
  return out;
}

export const LEVELS = ['초등', '중등'];
/** 호칭·직위 목록 */
export const titlesOf = (p) => [...new Set(String(p?.title ?? '').split(/[,，、/]/).map(str).filter(Boolean))];
/** 화면에 보일 이름: "김민수 선생님"(첫 호칭), "경기도교육청" */
export const personLabel = (p) => (p ? [p.name, p.kind === 'org' ? '' : titlesOf(p)[0] || (p.teacher ? '선생님' : '')].filter(Boolean).join(' ') : '');
/** 교원 정보 한 줄: "중등 · 정보" */
export const teacherInfo = (p) => (p?.teacher ? [p.level, p.subject].filter(Boolean).join(' · ') || '교원' : '');
/** 이름 + 다른 이름 (두 글자 이상) */
export const namesOf = (p) => [p.name, ...(p.aliases || [])].map(str).filter((n) => n.length >= 2);

export function sortPeople(list) {
  return [...list].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'org' ? 1 : -1) || String(a.name).localeCompare(String(b.name), 'ko'));
}

// ---------- 동명이인 ----------
// 같은 이름(또는 다른 이름)을 가진 사람·기관 묶음 → Map(이름 → [레코드])
export function nameGroups(people) {
  const g = new Map();
  for (const p of people) for (const n of new Set(namesOf(p))) g.set(n, [...(g.get(n) || []), p]);
  return g;
}

/** 괄호 안에 넣어 구분할 말: 소속, 다른 이름 */
const qualsOf = (p, n) => [p.org, ...(p.aliases || [])].map(str).filter((q) => q && q !== n);
const titleBase = (t) => str(t).replace(/님$/, '');

/** 같은 이름 묶음 안에서 이 사람만 가진 구분말 (없으면 '') */
export function distinctQual(p, n, group) {
  return qualsOf(p, n).find((q) => group.every((o) => o === p || !qualsOf(o, n).includes(q))) || '';
}

/** 동명이인 중 하나를 고르면 그 글을 무엇으로 바꿀지: "김민수 선생님" → "김민수(2학년부) 선생님", 기관은 정식 이름으로 */
export function qualifiedText(tokenText, name, p, people) {
  if (p.kind === 'org') {
    const g = nameGroups(people).get(p.name) || [p];
    return g.length === 1 ? p.name + tokenText.slice(name.length) : '';
  }
  const q = distinctQual(p, name, nameGroups(people).get(name) || [p]);
  return q ? `${name}(${q})${tokenText.slice(name.length)}` : '';
}

// ---------- 글 속에서 알아보기 ----------
// 맞추는 순서(긴 것·분명한 것 먼저):
//   1) 이름(소속) / 이름(다른 이름) [+호칭]   → 그 사람
//   2) 이름 + 그 사람의 호칭                   → 같은 이름 중 그 호칭이 하나뿐이면 그 사람
//   3) 이름 + 아무 호칭                        → 하나뿐이면 그 사람, 여럿이면 "누군지 모름"(amb)
//   4) 이름만                                  → 하나뿐이고 같은 이름 학생이 없으면 그 사람, 여럿이면 amb (학생과 겹치면 학생)
let memo = { key: '', re: null, pats: [] };

function compiled(people, students) {
  const key = JSON.stringify([people.map((p) => [p.id, p.kind, namesOf(p), p.title, p.org]), students.map((s) => s.name)]);
  if (memo.key === key) return memo;
  const studentNames = new Set(students.map((s) => s.name));
  const groups = nameGroups(people);
  const pats = [];
  const seen = new Set();
  const add = (re, target, len, name) => { if (seen.has(re)) return; seen.add(re); pats.push({ re, len, name, ...target }); };
  for (const [n, group] of groups) {
    const N = escapeRe(n);
    const persons = group.filter((p) => p.kind !== 'org');
    for (const p of group) {
      const quals = qualsOf(p, n).filter((q) => group.every((o) => o === p || !qualsOf(o, n).includes(q)));
      if (quals.length) add(`${N} ?\\((?:${quals.map(escapeRe).join('|')})\\)(?: ?${TITLE_RE})?`, { pid: p.id }, 300 + n.length, n);
    }
    if (persons.length > 1) {
      for (const p of persons) {
        // 겸임 호칭 가운데 같은 이름의 다른 사람과 겹치지 않는 호칭으로 구분 ("박지영 장학사", "박지영 부장")
        for (const t of titlesOf(p)) {
          const b = titleBase(t);
          if (b && persons.filter((o) => titlesOf(o).some((x) => titleBase(x) === b)).length === 1) add(`${N} ?(?:${escapeRe(b)}님|${escapeRe(b)})`, { pid: p.id }, 200 + n.length + b.length, n);
        }
      }
    }
    if (persons.length) add(`${N} ?${TITLE_RE}`, persons.length === 1 && group.length === 1 ? { pid: persons[0].id } : { amb: group.map((p) => p.id) }, 100 + n.length, n);
    const bareOk = group.length > 1 || group[0].kind === 'org' || !studentNames.has(n);
    if (bareOk && !(group.length > 1 && studentNames.has(n))) add(N, group.length === 1 ? { pid: group[0].id } : { amb: group.map((p) => p.id) }, n.length, n);
  }
  pats.sort((a, b) => b.len - a.len);
  const re = pats.length ? new RegExp(`${BEFORE}(${pats.map((x) => `(${x.re})`).join('|')})${AFTER}`, 'g') : null;
  memo = { key, re, pats };
  return memo;
}

/** 텍스트를 [{text, pid?} | {text, amb: [pid…], name}] 로 (사람·기관만) */
export function tokenizePeople(text, people = [], students = []) {
  const s = String(text ?? '');
  const { re, pats } = compiled(people, students);
  if (!re) return [{ text: s }];
  re.lastIndex = 0;
  const out = [];
  let last = 0, m;
  while ((m = re.exec(s))) {
    const start = m.index + m[1].length;
    const pat = pats[m.slice(3).findIndex((g) => g !== undefined)];
    if (start > last) out.push({ text: s.slice(last, start) });
    out.push(pat.pid ? { text: m[2], pid: pat.pid } : { text: m[2], amb: pat.amb, name: pat.name });
    last = start + m[2].length;
    re.lastIndex = last;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

/** 텍스트를 [{text, uid?, pid?, amb?}] 로: 사람·기관(호칭이 붙은 이름 포함)을 먼저, 나머지에서 학생을 찾는다 */
export function tokenizeMentions(text, students = [], people = []) {
  return tokenizePeople(text, people, students).flatMap((t) => (t.pid || t.amb ? [t] : tokenizeStudents(t.text, students)));
}

export const mentionedPids = (text, students, people) =>
  [...new Set(tokenizePeople(text, people, students).filter((t) => t.pid).map((t) => t.pid))];

/** 누군지 정해지지 않은(동명이인) 언급의 후보 pid 목록 */
export const ambiguousPids = (text, students, people) =>
  [...new Set(tokenizePeople(text, people, students).flatMap((t) => t.amb || []))];

/** 글 속의 "누군지 모름" 언급 중 글자가 tokenText 인 것을 replacement 로 바꾼다 (분명한 언급은 그대로) */
export function resolveAmbiguous(text, tokenText, replacement, people, students = []) {
  return tokenizePeople(text, people, students).map((t) => (t.amb && t.text === tokenText ? replacement : t.text)).join('');
}

/** 학생 uid 목록 ("김민수 선생님"은 같은 이름 학생이 있어도 학생으로 치지 않는다) */
export const mentionedStudentUids = (text, students, people = []) =>
  [...new Set(tokenizeMentions(text, students, people).filter((t) => t.uid).map((t) => t.uid))];

// ---------- 기록에서 아직 등록 안 한 이름 찾기 ----------
const FIND_RE = /(^|[^가-힣])([가-힣]{2,4})(?: ?(교장선생님|교감선생님|선생님|쌤|샘|장학사님?|장학관님?|주무관님?|연구사님?|교수님|강사님|부장님)|(T))(?![A-Za-z])/g;
const NOT_NAMES = new Set(('담임 부담임 담당 교과 학년부 보건 상담 영양 사서 원어민 전담 기간제 교무 연구 학생부 진로 전문 외부 다른 우리 여러 모든 해당 관리 '
  + '부장 교감 교장 수석 신규 강사 방과후 체육 음악 미술 영어 수학 과학 국어 사회 정보 기술 가정 도덕 역사 지리 물리 화학 생물 생명과학 지구과학 한문 '
  + '일본어 중국어 특수 돌봄 협력 희망 멘토 지도 감독 시험 실무사 행정실 교육청 학교 센터 담당자 각반 학급 반별 동료 옆반 앞반 교육 교육과정 '
  + '평가 업무 행정 예비 수업 교생 실습 주임 학년 이전 새로 주무').split(' '));

// 한국 성씨 (이름 후보는 성씨로 시작해야 한다 — "수능감독 선생님", "가는 선생님" 같은 말 거르기)
const SURNAMES = new Set(('김 이 박 최 정 강 조 윤 장 임 한 오 서 신 권 황 안 송 류 유 전 홍 고 문 양 손 배 백 허 남 심 노 하 곽 성 차 주 우 구 민 진 나 지 엄 채 원 천 방 공 현 함 변 염 여 추 도 석 선 설 마 길 연 위 표 명 기 반 라 왕 금 옥 육 인 맹 제 모 탁 국 어 은 편 용 예 경 봉 사 부 복 태 목 형 계 피 두 감 음 빈 동 온 호 범 좌 팽 승 간 상 시 갈 단 견 당 화 창 옹 순 빙 종 풍 등 영 독 요 근 남궁 황보 제갈 선우 독고 서문').split(' '));
// 이름이 아니라 말의 일부로 끝나는 꼴 ("이번에는", "같이가는", "학교에서")
const NOT_ENDINGS = /(는|에|에서|에게|를|을|의|도|만|던|할|한테|까지|부터|이랑|하고|께서|님)$/;

const hasSurname = (n) => SURNAMES.has(n[0]) || SURNAMES.has(n.slice(0, 2));

/**
 * 기록 글들에서 "○○○ 선생님", "○○○T" 처럼 호칭이 붙었지만 명부에 없는 이름 → [{name, title, count}] (많은 순)
 * @param ignore 추천에서 뺀 말들
 */
export function findUnregistered(texts, people = [], ignore = []) {
  const known = new Set(people.flatMap(namesOf));
  const skip = new Set(ignore);
  const found = new Map();
  for (const t of texts) {
    for (const m of String(t || '').matchAll(FIND_RE)) {
      const name = m[2];
      if (NOT_NAMES.has(name) || known.has(name) || skip.has(name) || !hasSurname(name) || NOT_ENDINGS.test(name)) continue;
      const title = m[3] || '선생님'; // T·샘·쌤 → 선생님
      const f = found.get(name) || { name, title: /^(T|샘|쌤)$/.test(title) ? '선생님' : title, count: 0 };
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
