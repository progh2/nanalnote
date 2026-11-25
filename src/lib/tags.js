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

export const TYPE_LABEL = { note: '노트', task: '업무', lesson: '수업', counsel: '상담', schedule: '학사', trip: '출장', attendance: '출결', postit: '포스트잇', contest: '대회·활동', daily: '하루' };

/**
 * 학년도 자료 전체의 글 기록 → [{type, date, text, update?, ...}] (노트는 --- 로 나눈 주제마다 하나)
 * update(fn): 그 기록의 글을 fn(옛 글) 로 바꾼다 (동명이인 고르기 등)
 */
export function textEntries(store) {
  const out = [];
  const add = (type, date, text, extra = {}) => { if (String(text || '').trim()) out.push({ type, date: date || '', text, ...extra }); };
  const w = store.work;
  const field = (obj, k) => (fn) => { obj[k] = fn(obj[k] || ''); };
  for (const d of w.days) {
    for (const s of splitSections(d.note)) add('note', d.date, s.text, { md: true, update: (fn) => { d.note = d.note.replace(s.text, () => fn(s.text)); } });
  }
  for (const d of w.days) {
    for (const [k, t] of [['health', '건강'], ['thanks', '감사'], ['study', '공부']]) add('daily', d.date, d[k], { label: t, update: field(d, k) });
  }
  for (const t of w.tasks) add('task', t.created, t.text, { done: !!t.doneDate, due: t.due || '', id: t.id, update: field(t, 'text') });
  // 업무 결과·진행 메모 (완료 날짜 기준)
  for (const t of w.tasks) add('task', t.doneDate || t.created, t.result, { done: !!t.doneDate, id: t.id, label: `결과: ${String(t.text || '').slice(0, 30)}`, md: true, update: field(t, 'result') });
  for (const l of w.lessons) add('lesson', l.date, l.content, { label: [store.periodLabel(l.period), l.subject, l.cls].filter(Boolean).join(' '), update: field(l, 'content') });
  const drafts = new Set(Object.keys(store.counselDraft || {}));
  // 상담: 저장된 단락은 그 날 초안(전체 글)으로 바꿔 고친다 → 저장할 때 학생 연결도 다시 계산
  const counselUpdate = (date, para) => (fn) => {
    const full = store.counselText ? store.counselText(date) : para;
    store.counselDraft[date] = full.replace(para, () => fn(para));
  };
  for (const c of w.counsel) if (!drafts.has(c.date)) add('counsel', c.date, c.text, { update: counselUpdate(c.date, c.text) });
  for (const [date, text] of Object.entries(store.counselDraft || {})) add('counsel', date, text, { update: (fn) => { store.counselDraft[date] = fn(store.counselDraft[date]); } });
  for (const s of w.schedule) add('schedule', s.date, s.text, { update: field(s, 'text') });
  for (const t of w.trips) add('trip', t.date, [t.place, t.purpose].filter(Boolean).join(' · '));
  for (const a of w.attendance) add('attendance', a.date, a.note, { label: store.label(a.student), update: field(a, 'note') });
  for (const n of w.notes) add('postit', '', n.text, { update: field(n, 'text') });
  for (const c of w.contests || []) add('contest', c.start || c.stages?.[0]?.start || '', c.summary, { label: c.name, md: true, contestId: c.id, update: field(c, 'summary') });
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

// ---------- 태그 이름 바꾸기 (모든 기록에서 함께) ----------
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 태그 이름으로 쓸 수 있나 → 오류 글 (괜찮으면 '') */
export function tagNameError(name) {
  const t = String(name || '').trim().replace(/^#/, '');
  if (!t) return '새 이름을 쓰세요.';
  if (!/^[0-9A-Za-z가-힣_][0-9A-Za-z가-힣_-]*$/.test(t)) return '태그 이름에는 한글·영문·숫자·_·- 만 쓸 수 있습니다 (띄어쓰기 없이).';
  if (/^\d+$/.test(t)) return '숫자만으로는 태그가 되지 않습니다.';
  return '';
}

/** 글 속 #old 를 #neu 로 (더 긴 다른 태그 #old학교 는 그대로) → [바뀐 글, 바꾼 수] */
export function replaceTagIn(text, old, neu) {
  const re = new RegExp(`(^|[\\s([{,.;:!?'"])#${escRe(old)}(?![0-9A-Za-z가-힣_-])`, 'g');
  let n = 0;
  const out = String(text ?? '').replace(re, (m, pre) => { n++; return `${pre}#${neu}`; });
  return [out, n];
}

/**
 * 학년도 자료 전체에서 태그 이름 바꾸기 (data = store.work, drafts = 저장 전 상담 초안)
 * 새 이름이 이미 있으면 두 태그를 합친다 (태그 카드도 합침)
 * @param dryRun true 면 세기만
 * @returns {{ records:number, places:number, merged:boolean }}
 */
export function renameTag(data, drafts, old, neu, { dryRun = false } = {}) {
  old = String(old).replace(/^#/, ''); neu = String(neu).trim().replace(/^#/, '');
  let records = 0, places = 0;
  const fix = (obj, key) => {
    if (!obj || typeof obj[key] !== 'string') return;
    const [t, n] = replaceTagIn(obj[key], old, neu);
    if (!n) return;
    records++; places += n;
    if (!dryRun) obj[key] = t;
  };
  for (const d of data.days || []) fix(d, 'note');
  for (const t of data.tasks || []) { fix(t, 'text'); fix(t, 'result'); }
  for (const l of data.lessons || []) fix(l, 'content');
  for (const c of data.counsel || []) fix(c, 'text');
  for (const k of Object.keys(drafts || {})) fix(drafts, k);
  for (const s of data.schedule || []) fix(s, 'text');
  for (const t of data.trips || []) { fix(t, 'place'); fix(t, 'purpose'); }
  for (const a of data.attendance || []) fix(a, 'note');
  for (const n of data.notes || []) fix(n, 'text');
  for (const c of data.contests || []) { fix(c, 'summary'); for (const e of c.entries || []) fix(e, 'memo'); }
  for (const c of data.tagcards || []) { fix(c, 'memo'); for (const m of c.members || []) fix(m, 'memo'); }
  for (const p of data.people || []) fix(p, 'memo');
  // 태그 카드: 이름 바꾸기 또는 합치기
  const from = (data.tagcards || []).find((c) => c.tag === old);
  const to = (data.tagcards || []).find((c) => c.tag === neu);
  const merged = !!(from && to) || (!!to && records > 0);
  if (!dryRun && from) {
    if (!to) from.tag = neu;
    else {
      // 비어 있는 칸은 채우고, 목록(일정·자료·인물)은 이어 붙이고, 설명은 아래에 덧붙인다
      for (const k of ['status', 'start', 'end', 'pinned']) if (to[k] == null || to[k] === '') { if (from[k] != null && from[k] !== '') to[k] = from[k]; }
      if ((from.memo || '').trim()) to.memo = (to.memo || '').trim() ? `${to.memo.trim()}\n\n---\n${from.memo.trim()}` : from.memo;
      for (const k of ['stages', 'links', 'files', 'members']) if (from[k]?.length) to[k] = [...(to[k] || []), ...from[k]];
      data.tagcards = data.tagcards.filter((c) => c !== from);
    }
  }
  return { records, places, merged };
}
