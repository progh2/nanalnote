// 글 속의 학생·사람·기관 이름과 #태그를 누를 수 있게 바꾸기 (노트·상담일지·태그·명부 화면이 함께 쓴다)
import { h } from '../lib/util.js';
import { tokenizeMentions, personLabel } from '../lib/people.js';
import { tagNodes } from '../lib/tags.js';
import { showStudentCounsel } from './students.js';

export function openPerson(app, id) {
  app.peopleView = { ...(app.peopleView || {}), sel: id };
  app.tab = 'people';
  app.render();
}

const defaultOnTag = (app) => (tag) => { app.tagView = { ...(app.tagView || {}), tag }; app.tab = 'tags'; app.render(); };

/** (text) => 노드 배열 */
export function mentionInline(app, { onTag = defaultOnTag(app), activeTag = null, activePerson = null } = {}) {
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
    return tagNodes(t.text, onTag, activeTag);
  });
}
