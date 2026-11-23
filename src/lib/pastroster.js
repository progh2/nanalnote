// 작년 학번·사진 붙여넣기: "작년 학번 · 이름 · 사진 링크" 표를 지금 명단과 맞춘다
// - 작년 1학년(1xxx) → 지금 2학년의 같은 이름 → "1학년 때 학번"
// - 작년 2학년(2xxx) → 지금 3학년 → "2학년 때 학번"
// - 작년 마지막 학년(고 3학년) → 작년 학년도 졸업생 (졸업생 명부)
// - 같은 학년에 같은 이름이 여럿이면 지금 반이 작년 반과 같은 학생, 그래도 모르면 직접 고르기
import { partsOfNo } from './students.js';

/** 붙여 넣은 글(구글 시트·엑셀에서 복사, 탭·띄어쓰기로 나뉨) → [{ no, grade, cls, name, url }] */
export function parsePastRows(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const cells = (line.includes('\t') ? line.split(/\t+/) : line.split(/\s+/)).map((x) => x.trim()).filter(Boolean);
    if (!cells.length) continue;
    const no = cells.find((c) => /^\d{3,5}$/.test(c));
    const url = cells.find((c) => /^https?:\/\//i.test(c)) || '';
    const name = cells.find((c) => c !== no && c !== url && /^[가-힣]{2,6}$/.test(c)) || '';
    if (!no || !name) continue;
    const p = partsOfNo(no) || {};
    out.push({ no, grade: p.grade || 0, cls: p.cls || 0, name, url });
  }
  return out;
}

/** 구글 드라이브 공유 링크 → 다른 사이트에서도 읽을 수 있는 그림 주소 (그 밖의 링크는 그대로) */
export function photoUrlOf(url, width = 600) {
  const u = String(url || '').trim();
  if (!u) return '';
  const id = u.match(/[?&]id=([\w-]+)/)?.[1] || u.match(/\/d\/([\w-]+)/)?.[1];
  if (id && /google\.com|googleusercontent\.com/.test(u)) return `https://lh3.googleusercontent.com/d/${id}=w${width}`;
  return u;
}

/**
 * 지금 명단과 맞추기
 * @param students 지금 학년도 학생 (입학 예정은 빼고 넘긴다)
 * @param top 마지막 학년 (고 3, 초 6)
 * @returns {{ matches:[{row, student}], alumni:[row], ambiguous:[{row, cands}], missing:[row] }}
 */
export function planPastImport(rows, students, top = 3) {
  const res = { matches: [], alumni: [], ambiguous: [], missing: [] };
  const used = new Set();
  for (const row of rows) {
    if (row.grade >= top) { res.alumni.push(row); continue; }
    const cands = students.filter((s) => s.name === row.name && s.grade === row.grade + 1 && !used.has(s.uid));
    let pick = cands.length === 1 ? cands[0] : null;
    if (!pick && cands.length > 1) {
      const sameCls = cands.filter((s) => s.cls === row.cls);
      if (sameCls.length === 1) pick = sameCls[0];
    }
    if (pick) { used.add(pick.uid); res.matches.push({ row, student: pick }); }
    else if (cands.length) res.ambiguous.push({ row, cands });
    else res.missing.push(row);
  }
  return res;
}
