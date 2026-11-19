// #태그: 노트·업무·수업일지·상담·학사일정·출장·출결 비고·포스트잇에 쓴 "#단어"를 모아 본다
import { h } from './util.js';
import { splitSections } from './notemd.js';

// 앞: 줄 처음이나 공백/괄호/구두점, 뒤: 한글·영문·숫자·_·- (숫자만은 태그로 보지 않음 — "#1" 같은 번호)
const TAG_RE = /(^|[\s([{,.;:!?'"])#([0-9A-Za-z가-힣_][0-9A-Za-z가-힣_-]*)/g;
const valid = (t) => !/^\d+$/.test(t);

export function extractTags(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(TAG_RE)) if (valid(m[2])) out.add(m[2]);
  return [...out];
}

/** 텍스트를 [{text, tag?}] 로 나눈다 */
export function splitTags(text) {
  const s = String(text || '');
  const out = [];
  let last = 0;
  for (const m of s.matchAll(TAG_RE)) {
    if (!valid(m[2])) continue;
    const at = m.index + m[1].length;
    if (at > last) out.push({ text: s.slice(last, at) });
    out.push({ text: `#${m[2]}`, tag: m[2] });
    last = at + m[2].length + 1;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

/** 태그를 강조한 노드들 (onTag 가 있으면 누를 수 있게) */
export function tagNodes(text, onTag, active = null) {
  return splitTags(text).map((p) => (p.tag
    ? h(`button.tag-link${p.tag === active ? '.active' : ''}`, { onclick: onTag ? () => onTag(p.tag) : null, title: `#${p.tag} 모아보기` }, p.text)
    : p.text));
}

export const TYPE_LABEL = { note: '노트', task: '업무', lesson: '수업', counsel: '상담', schedule: '학사', trip: '출장', attendance: '출결', postit: '포스트잇' };

/** 학년도 자료 전체의 글 기록 → [{type, date, text, ...}] (노트는 --- 로 나눈 주제마다 하나) */
export function textEntries(store) {
  const out = [];
  const add = (type, date, text, extra = {}) => { if (String(text || '').trim()) out.push({ type, date: date || '', text, ...extra }); };
  const w = store.work;
  for (const d of w.days) for (const s of splitSections(d.note)) add('note', d.date, s.text, { md: true });
  for (const t of w.tasks) add('task', t.created, t.text, { done: !!t.doneDate });
  for (const l of w.lessons) add('lesson', l.date, l.content, { label: [store.periodLabel(l.period), l.subject, l.cls].filter(Boolean).join(' ') });
  const drafts = new Set(Object.keys(store.counselDraft || {}));
  for (const c of w.counsel) if (!drafts.has(c.date)) add('counsel', c.date, c.text);
  for (const [date, text] of Object.entries(store.counselDraft || {})) add('counsel', date, text);
  for (const s of w.schedule) add('schedule', s.date, s.text);
  for (const t of w.trips) add('trip', t.date, [t.place, t.purpose].filter(Boolean).join(' · '));
  for (const a of w.attendance) add('attendance', a.date, a.note, { label: store.label(a.student) });
  for (const n of w.notes) add('postit', '', n.text);
  return out;
}

/** 학년도 자료 전체에서 태그가 붙은 기록 목록 */
export function tagEntries(store) {
  return textEntries(store).flatMap((e) => extractTags(e.text).map((tag) => ({ tag, ...e })));
}

/** 태그별 개수 (많은 순) */
export function tagCounts(entries) {
  const m = new Map();
  for (const e of entries) m.set(e.tag, (m.get(e.tag) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
}
