// 가족·관계 칸: 학생·사람(선생님·학부모·졸업생) 사이의 관계를 적고, 양쪽에서 거꾸로도 보인다
import { h, newId, toast } from '../lib/util.js';
import { REL_KINDS, relationsOf, refOf, hasRelation } from '../lib/relations.js';
import { studentLabel, resolveRef } from '../lib/students.js';
import { personLabel } from '../lib/people.js';

/** ref('s:uid' | 'p:uid') → { name, gender, open } */
export function refInfo(app, ref) {
  const { store } = app;
  const [t, id] = String(ref || '').split(/:(.*)/);
  if (t === 's') {
    const s = store.work.students.find((x) => x.uid === id);
    if (s) return { name: studentLabel(s), gender: s.gender || '', kind: '학생', open: () => { app.selectedStudent = s.uid; app.stuTable = false; app.tab = 'students'; app.render(); } };
    // 졸업해서 명단에 없으면 졸업생 명부에서
    const a = store.work.people.find((x) => x.stuUid === id);
    if (a) return { name: personLabel(a), gender: a.gender || '', kind: '졸업생', open: () => openPersonById(app, a) };
  }
  if (t === 'p') {
    const p = store.work.people.find((x) => x.uid === id);
    if (p) return { name: personLabel(p), gender: p.gender || '', kind: p.kind === 'alumni' ? '졸업생' : p.teacher ? '선생님' : '사람', open: () => openPersonById(app, p) };
  }
  return { name: '(명단에 없음)', gender: '', kind: '', open: null };
}

function openPersonById(app, p) {
  app.peopleView = { ...(app.peopleView || {}), sel: p.id };
  app.tab = 'people';
  app.render();
}

/**
 * @param ref 이 학생·사람 ('s:uid' | 'p:uid')
 */
export function relationsBox(app, ref) {
  const { store } = app;
  store.work.relations ||= [];
  const genderOf = (r) => refInfo(app, r).gender;
  const list = relationsOf(store.work.relations, ref, genderOf);

  // 고를 수 있는 상대: 학생 + 사람·졸업생 (글자 → ref)
  const options = new Map();
  for (const s of store.students()) if (refOf('s', s.uid) !== ref) options.set(studentLabel(s), refOf('s', s.uid));
  for (const p of store.work.people) if (p.kind !== 'org' && refOf('p', p.uid) !== ref) options.set(`${personLabel(p)}${p.org ? ` · ${p.org}` : ''}`, refOf('p', p.uid));
  const listId = `rel-${Math.random().toString(36).slice(2, 7)}`;
  const kindSel = h('select', { 'aria-label': '관계' }, REL_KINDS.map((k) => h('option', { value: k }, k)));
  const who = h('input', { list: listId, placeholder: '학번·이름으로 찾기', 'aria-label': '누구', style: { minWidth: '12em' } });
  const memo = h('input', { placeholder: '메모 (기타일 때 관계 이름)', 'aria-label': '메모', style: { width: '12em' } });
  const find = (text) => {
    const t = text.trim();
    if (!t) return null;
    if (options.has(t)) return options.get(t);
    const st = resolveRef(t, store.studentIndex());
    if (st) return refOf('s', st.uid);
    const ps = store.work.people.filter((p) => p.kind !== 'org' && (p.name === t || personLabel(p) === t));
    return ps.length === 1 ? refOf('p', ps[0].uid) : null;
  };
  const add = () => {
    const target = find(who.value);
    if (!target) { toast('학생이나 사람을 찾지 못했습니다. 목록에서 고르거나 학번·이름을 정확히 써 주세요. 사람은 사람·기관에 먼저 등록하세요.', 'error'); return; }
    if (target === ref) { toast('자기 자신과는 이을 수 없습니다.', 'error'); return; }
    const kind = kindSel.value;
    if (hasRelation(store.work.relations, target, ref, kind)) { toast('이미 있는 관계입니다.'); return; }
    // 저장은 "상대(target) 는 나(ref) 의 kind" — 내 쪽에서 "아버지: ○○" 로 보인다
    store.work.relations.push({ id: newId(), a: target, b: ref, kind, ...(memo.value.trim() ? { memo: memo.value.trim() } : {}) });
    store.markDirty();
    app.render();
  };
  who.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });

  return h('div.rel-box',
    h('h3', '가족·관계'),
    list.length ? h('ul.rel-list', list.map(({ rel, other, label }) => {
      const info = refInfo(app, other);
      return h('li',
        h('span.rel-kind', label), ' ',
        info.open ? h('button.link', { onclick: info.open }, info.name) : h('span.muted', info.name),
        info.kind ? h('span.muted.small', ` ${info.kind}`) : null,
        rel.memo && rel.kind !== '기타' ? h('span.muted.small', ` — ${rel.memo}`) : null,
        h('button.icon-btn.small', { title: '관계 지우기', 'aria-label': '관계 지우기', onclick: () => { store.work.relations = store.work.relations.filter((r) => r !== rel); store.markDirty(); app.render(); } }, '✕'));
    })) : h('p.muted.small', '부모·형제·담임 같은 관계를 적으면 양쪽 화면에 함께 보입니다. (예: 아버지 — 정다온)'),
    h('div.inline-form.rel-add', kindSel, h('span.small', '—'), who, h('datalist', { id: listId }, [...options.keys()].map((k) => h('option', { value: k }))), memo,
      h('button.small.primary', { onclick: add }, '+ 관계')));
}
