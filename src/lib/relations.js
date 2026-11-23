// 학생·사람 사이의 관계 (가족·담임 등)
// 레코드: { id, a: 's:학생uid' | 'p:사람uid', b: …, kind, memo }  — "a 는 b 의 kind" (예: 정다온 은 김민준 의 아버지)
// 한쪽에서 적으면 다른 쪽에서도 거꾸로 보인다 (김민준 쪽: 아버지 정다온 / 정다온 쪽: 아들 김민준)

export const REL_KINDS = ['아버지', '어머니', '보호자', '아들', '딸', '자녀', '형', '오빠', '언니', '누나', '남동생', '여동생', '형제자매', '담임', '지도교사', '학생', '친척', '기타'];

const PARENT = new Set(['아버지', '어머니', '보호자', '부모']);
const CHILD = new Set(['아들', '딸', '자녀']);
const OLDER = new Set(['형', '오빠', '언니', '누나']);
const YOUNGER = new Set(['남동생', '여동생', '동생']);
const TEACHER = new Set(['담임', '지도교사']);

/** a 가 b 의 kind 일 때, b 는 a 의 무엇인가 (ga = a 성별, gb = b 성별: '남'|'여'|'') */
export function inverseKind(kind, ga = '', gb = '') {
  if (PARENT.has(kind)) return gb === '남' ? '아들' : gb === '여' ? '딸' : '자녀';
  if (CHILD.has(kind)) return gb === '남' ? '아버지' : gb === '여' ? '어머니' : '부모'; // 자녀(a)의 부모(b): b 성별로
  if (OLDER.has(kind)) return gb === '남' ? '남동생' : gb === '여' ? '여동생' : '동생';
  if (YOUNGER.has(kind)) {
    // a 가 동생이면 b 는 손위: b 성별과 a 성별로 형·오빠·누나·언니
    const a = kind === '남동생' ? '남' : kind === '여동생' ? '여' : ga;
    if (gb === '남') return a === '여' ? '오빠' : a === '남' ? '형' : '형·오빠';
    if (gb === '여') return a === '여' ? '언니' : a === '남' ? '누나' : '누나·언니';
    return '손위 형제';
  }
  if (TEACHER.has(kind)) return kind === '담임' ? '담임 학생' : '지도 학생';
  if (kind === '학생') return '선생님';
  return kind; // 형제자매·친척·기타
}

export const refOf = (type, uid) => `${type}:${uid}`;

/**
 * x 와 이어진 관계들 → [{ rel, other(상대 ref), label(상대가 x 의 무엇인지) }]
 * @param genderOf (ref) => '남'|'여'|''
 */
export function relationsOf(relations, x, genderOf = () => '') {
  const out = [];
  for (const r of relations || []) {
    if (r.b === x) out.push({ rel: r, other: r.a, label: r.kind === '기타' && r.memo ? r.memo : r.kind });
    else if (r.a === x) out.push({ rel: r, other: r.b, label: r.kind === '기타' && r.memo ? r.memo : inverseKind(r.kind, genderOf(r.a), genderOf(r.b)) });
  }
  return out;
}

/** 같은 관계가 이미 있나 (방향·종류까지 같으면) */
export const hasRelation = (relations, a, b, kind) => (relations || []).some((r) => r.a === a && r.b === b && r.kind === kind);
