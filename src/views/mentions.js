// 글 속의 학생·사람·기관 이름과 #태그를 누를 수 있게 바꾸기 (노트·상담일지·태그·명부·검색 화면이 함께 쓴다)
import { h, modal, toast } from '../lib/util.js';
import { tokenizeMentions, personLabel, KINDS, qualifiedText, resolveAmbiguous } from '../lib/people.js';
import { tagNodes } from '../lib/tags.js';
import { showStudentCounsel } from './students.js';

export function openPerson(app, id) {
  app.peopleView = { ...(app.peopleView || {}), sel: id };
  app.tab = 'people';
  app.render();
}

const defaultOnTag = (app) => (tag) => { app.tagView = { ...(app.tagView || {}), tag }; app.tab = 'tags'; app.render(); };

/**
 * 동명이인이라 누군지 모르는 언급을 눌렀을 때: 후보 중 고르면 글을 "김민수(2학년부) 선생님" 처럼 고친다
 * @param update (fn) => void  그 기록의 글을 fn(옛 글)로 바꾸기. 없으면 고른 사람 화면으로만 간다
 */
export async function chooseAmbiguous(app, tok, update) {
  const { store } = app;
  const cands = tok.amb.map((id) => store.person(id)).filter(Boolean);
  const body = h('div',
    h('p', `"${tok.text}" — 같은 이름이 ${cands.length}명(곳) 있어 누군지 정하지 못했습니다. 누구인가요?`),
    update ? h('p.muted.small', '고르면 이 기록의 글을 구분되는 이름으로 고쳐 씁니다. 예: 김민수(2학년부) 선생님') : null);
  const id = await modal('누구인가요?', body, [
    ...cands.map((p) => ({ label: `${p.kind === 'org' ? '🏢' : '👤'} ${personLabel(p)}${p.org ? ` · ${p.org}` : ''}`, value: p.id })),
    { label: '취소', value: null }]);
  if (!id) return;
  const p = store.person(id);
  if (!update) { openPerson(app, id); return; }
  const rep = qualifiedText(tok.text, tok.name, p, store.work.people);
  if (!rep) {
    toast(`${personLabel(p)}의 소속이나 다른 이름이 비어 있거나 같아서 구분해 쓸 수 없습니다. 명부에서 소속을 채워 주세요.`, 'error');
    openPerson(app, id);
    return;
  }
  update((text) => resolveAmbiguous(text, tok.text, rep, store.work.people, store.work.students));
  store.markDirty();
  toast(`"${rep}"(으)로 고쳤습니다.`);
  app.render();
}

/**
 * (text) => 노드 배열
 * @param opt.update  이 글이 속한 기록 고치기 (동명이인 고르기에 씀)
 */
export function mentionInline(app, { onTag = defaultOnTag(app), activeTag = null, activePerson = null, update = null } = {}) {
  const { store } = app;
  return (s) => tokenizeMentions(s, store.work.students, store.work.people).flatMap((t) => {
    if (t.uid) {
      return [h('button.name-link', { onclick: (e) => { e.stopPropagation(); showStudentCounsel(app, t.uid); }, title: `${store.label(t.uid)} 상담 모아보기` }, t.text)];
    }
    if (t.pid) {
      const p = store.person(t.pid);
      return [h(`button.person-link${p?.kind === 'org' ? '.org' : ''}${t.pid === activePerson ? '.active' : ''}`,
        { onclick: (e) => { e.stopPropagation(); openPerson(app, t.pid); }, title: `${personLabel(p)} 기록 모아보기` }, t.text)];
    }
    if (t.amb) {
      const names = t.amb.map((id) => store.person(id)).filter(Boolean).map((p) => `${personLabel(p)}${p.org ? `(${p.org})` : ''}`);
      return [h(`button.person-link.amb${activePerson && t.amb.includes(activePerson) ? '.active' : ''}`, {
        onclick: (e) => { e.stopPropagation(); chooseAmbiguous(app, t, update); },
        title: `동명이인 — 누군지 정하려면 누르세요: ${names.join(', ')}`,
      }, t.text, h('sup', '?'))];
    }
    return tagNodes(t.text, onTag, activeTag);
  });
}

export { KINDS };
