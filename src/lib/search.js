// 전체 검색: 학생·사람·기관·태그·기록(노트 주제, 업무, 수업일지, 상담, 학사일정, 출장, 출결 비고, 포스트잇)
// - 띄어 쓴 낱말이 모두 들어간 것을 찾는다 (순서는 상관없음)
// - 낱말 끝의 조사는 떼고도 찾아 본다: "교육청에" → "교육청"
import { PARTICLE, searchStudents, studentLabel } from './students.js';
import { namesOf, personLabel, sortPeople } from './people.js';
import { textEntries, tagCounts, tagEntries } from './tags.js';

const PART_END = new RegExp(`${PARTICLE}$`);

/** 검색어 → [[원래 낱말, 조사 뗀 낱말], …] (소문자) */
export function queryTerms(q) {
  return String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean).map((t) => {
    const bare = t.replace(/^#/, '');
    const cut = bare.length > 2 ? bare.replace(PART_END, '') : bare;
    return [...new Set([bare, cut || bare])];
  });
}

/** 모든 낱말이 들어 있나 */
export function matchesAll(text, terms) {
  const s = String(text || '').toLowerCase();
  return terms.every((alts) => alts.some((a) => s.includes(a)));
}

/** 강조할 구간 [[시작, 끝], …] (겹치면 합침) */
export function matchRanges(text, terms) {
  const s = String(text || '').toLowerCase();
  const out = [];
  for (const alts of terms) {
    for (const a of alts) {
      if (!a) continue;
      let i = s.indexOf(a);
      while (i >= 0) { out.push([i, i + a.length]); i = s.indexOf(a, i + a.length); }
    }
  }
  out.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
  const merged = [];
  for (const r of out) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]);
  }
  return merged;
}

/** 긴 글에서 처음 맞은 곳 앞뒤만 잘라 보여 주기 → { text, offset } */
export function snippet(text, terms, before = 30, total = 140) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= total) return { text: s, cut: false };
  const first = matchRanges(s, terms)[0]?.[0] ?? 0;
  const start = Math.max(0, first - before);
  const end = Math.min(s.length, start + total);
  return { text: (start > 0 ? '…' : '') + s.slice(start, end) + (end < s.length ? '…' : ''), cut: true };
}

/**
 * @returns {{students, people, tags, records, total}}
 */
export function searchAll(store, q, { limit = 60 } = {}) {
  const terms = queryTerms(q);
  if (!terms.length) return { students: [], people: [], tags: [], records: [], total: 0 };
  const w = store.work;
  // 사람·학생은 모든 낱말이 맞거나, 낱말 하나라도 이름에 들어가면 ("교육청 공문" → 교육청)
  const nameHit = (names) => terms.some((alts) => alts.some((a) => a.length >= 2 && names.some((n) => n.toLowerCase().includes(a))));
  const allSt = searchStudents(q, w.students);
  const students = [...allSt, ...w.students.filter((s) => !allSt.includes(s) && nameHit([s.name || '']))].slice(0, 8);
  const people = sortPeople(w.people).filter((p) => nameHit(namesOf(p))
    || matchesAll([...namesOf(p), p.title, p.org, p.phone, p.email, p.memo, p.subject, p.level, p.teacher ? '선생님 교사' : ''].join(' '), terms)).slice(0, 8);
  const tags = tagCounts(tagEntries(store)).filter(([t]) => matchesAll(t, terms)).slice(0, 10);
  const all = textEntries(store).filter((e) => matchesAll(`${e.label || ''} ${e.text}`, terms))
    .sort((a, b) => (b.date || '0').localeCompare(a.date || '0'));
  return { students, people, tags, records: all.slice(0, limit), more: Math.max(0, all.length - limit), total: students.length + people.length + tags.length + all.length };
}

export { studentLabel, personLabel };
