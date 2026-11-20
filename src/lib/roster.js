// 학생 명단 올리기 (엑셀·CSV): 머리줄 찾기 → 학생 목록으로 → 지금 명단에 더하고 고치기 / 바꾸기
import { normStudent, buildIndex, newUid, statusAt } from './students.js';

// 열 이름(띄어쓰기 무시) → 필드. 학교 서식마다 이름이 달라서 여러 가지를 받는다
export const COLUMNS = {
  studentNo: ['학번'],
  grade: ['학년'],
  cls: ['반', '학급'],
  no: ['번호', '출석번호', '번'],
  name: ['이름', '성명', '학생명', '학생이름', '학생성명'],
  prevNo: ['이전학번', '작년학번', '전학번'],
  gender: ['성별'],
  email: ['이메일', 'e-mail', 'email', '전자우편', '메일'],
  phone: ['전화번호', '전화', '휴대전화', '휴대폰', '핸드폰', '연락처', '학생연락처', '휴대전화번호', '학생전화번호'],
};
export const FIELD_LABEL = { studentNo: '학번', grade: '학년', cls: '반', no: '번호', name: '이름', prevNo: '이전학번', gender: '성별', email: '이메일', phone: '전화번호' };

const clean = (s) => String(s ?? '').replace(/\s/g, '').toLowerCase();
const digits = (s) => { const m = String(s ?? '').match(/\d+/); return m ? m[0] : ''; };
const gender = (s) => { const t = String(s || '').trim(); return /^(남|남자|m|male)$/i.test(t) ? '남' : /^(여|여자|f|female)$/i.test(t) ? '여' : t; };

/** 위쪽 몇 줄에서 "이름" 열이 있고 아는 열이 가장 많은 줄 */
function headerRow(rows) {
  let best = -1, score = 0;
  rows.slice(0, 20).forEach((r, i) => {
    const cells = r.map(clean);
    if (!cells.some((c) => COLUMNS.name.includes(c))) return;
    const n = Object.values(COLUMNS).filter((alts) => cells.some((c) => alts.includes(c))).length;
    if (n > score) { score = n; best = i; }
  });
  return best;
}

/**
 * 표(행 배열) → 학생 목록
 * @returns {{list, header:number, found:string[], skipped:number, dupNos:string[]}}
 */
export function parseStudentRows(rows) {
  rows = (rows || []).map((r) => (r || []).map((c) => String(c ?? '').trim()));
  const hi = headerRow(rows);
  let col;
  if (hi >= 0) {
    const head = rows[hi].map(clean);
    col = Object.fromEntries(Object.entries(COLUMNS).map(([k, alts]) => [k, head.findIndex((c) => alts.includes(c))]));
  } else if (rows.some((r) => r.length >= 2)) {
    col = { no: 0, name: 1 }; // 머리줄 없는 예전 형식: 번호, 이름
  } else throw new Error('표에서 "이름"(또는 "성명") 열을 찾지 못했습니다. 예제 파일을 참고하세요.');
  const at = (r, k) => (col[k] >= 0 && col[k] != null ? r[col[k]] || '' : '');
  let skipped = 0;
  const list = [];
  for (const r of rows.slice(hi + 1)) {
    const name = at(r, 'name');
    if (!name || COLUMNS.name.includes(clean(name))) { if (r.some(Boolean)) skipped++; continue; } // 빈 줄·반복된 머리줄
    const st = normStudent({
      studentNo: digits(at(r, 'studentNo')), grade: digits(at(r, 'grade')), cls: digits(at(r, 'cls')), no: digits(at(r, 'no')), name,
      ...(at(r, 'gender') ? { gender: gender(at(r, 'gender')) } : {}),
      ...(at(r, 'email') ? { email: at(r, 'email') } : {}),
      ...(at(r, 'phone') ? { phone: at(r, 'phone') } : {}),
    });
    const prev = digits(at(r, 'prevNo'));
    if (prev) st.prevNo = prev;
    list.push(st);
  }
  const nos = list.map((x) => x.studentNo).filter(Boolean);
  const dupNos = [...new Set(nos.filter((n, i) => nos.indexOf(n) !== i))];
  const found = Object.keys(COLUMNS).filter((k) => col[k] >= 0 && col[k] != null);
  return { list, header: hi, found, skipped, dupNos };
}

const KEEP = ['gender', 'email', 'phone', 'statusLog', 'leaving', 'flags', 'flagMemo'];

/**
 * 지금 명단에 올린 목록을 반영
 * @param current 지금 학년도 학생들
 * @param list parseStudentRows 의 list
 * @param mode 'merge'(더하고 고치기: 학번이 같으면 고치고 없으면 추가, 목록에 없는 학생은 그대로) | 'replace'(바꾸기: 목록에 없는 학생은 빠짐, 휴학생은 남김)
 * @param opt.prev 지난 학년도 학생들 (이전학번·이름으로 같은 학생 잇기)
 * @param opt.date 휴학 판단 날짜
 * @returns {{students, added, updated, linked, removed}}
 */
export function applyStudents(current, list, mode = 'merge', { prev = [], date = '9999-12-31', newId = () => `n_${Math.random().toString(36).slice(2)}` } = {}) {
  const cur = buildIndex(current);
  const noNo = buildIndex(current.filter((s) => !s.studentNo)); // 이어받아 학번이 아직 없는 학생
  const prevIdx = prev.length ? buildIndex(prev) : null;
  const used = new Set();
  let added = 0, updated = 0, linked = 0;
  const uniq = (ix, name) => (ix.byName.get(name)?.length === 1 ? ix.byName.get(name)[0] : null);
  const rows = list.map((x) => {
    let same = (x.studentNo && cur.byNo.get(x.studentNo)) || uniq(noNo, x.name)
      || (!x.studentNo && uniq(cur, x.name))
      // 더하고 고치기: 학번이 바뀐 경우도 같은 학년·반의 하나뿐인 같은 이름이면 같은 학생
      || (mode === 'merge' && (() => { const s = uniq(cur, x.name); return s && (!x.grade || !s.grade || s.grade === x.grade) && (!x.cls || !s.cls || s.cls === x.cls) && !list.some((y) => y !== x && y.studentNo && y.studentNo === s.studentNo) ? s : null; })());
    if (same && used.has(same.uid)) same = null;
    if (same) used.add(same.uid);
    let from = same, uid = same?.uid;
    if (!uid && prevIdx) {
      // 이름으로만 이을 때는 학년이 하나 올라간 경우만 (졸업생과 신입생 동명이인 방지)
      const byName = uniq(prevIdx, x.name);
      const p = (x.prevNo && prevIdx.byNo.get(x.prevNo)) || (byName && (!x.grade || !byName.grade || x.grade === byName.grade + 1) ? byName : null);
      if (p) { uid = p.uid; linked++; from = p; }
    }
    const { prevNo, ...rest } = x;
    // 파일의 빈 칸은 지금 값을 지우지 않는다
    const filled = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== '' && v != null));
    if (same) updated++; else added++;
    return normStudent({
      ...(same || {}),
      ...Object.fromEntries(KEEP.filter((k) => from?.[k] && !same?.[k]).map((k) => [k, from[k]])),
      ...filled,
      id: same?.id || newId(), uid: uid || newUid(), photo: same?.photo || '',
    });
  });
  let rest = [];
  if (mode === 'merge') rest = current.filter((s) => !used.has(s.uid));
  else rest = current.filter((s) => !used.has(s.uid) && statusAt(s, date).state === 'leave'); // 바꿔도 휴학생은 남김
  const removed = current.length - used.size - rest.length;
  return { students: [...rows, ...rest], added, updated, linked, removed };
}
