// 사람·기관 탭: 명부(선생님·장학사·외부 강사·교육청·대학·업체…)와, 그 이름이 나온 기록 모아 보기
import { h, koDate, newId, modal, toast, confirmDialog, fill } from '../lib/util.js';
import { KINDS, TITLES, normPerson, personLabel, sortPeople, mentionedPids, ambiguousPids, findUnregistered, parsePeopleLines, nameGroups, namesOf, distinctQual } from '../lib/people.js';
import { textEntries, TYPE_LABEL } from '../lib/tags.js';
import { renderMd } from '../lib/notemd.js';
import { mentionInline } from './mentions.js';

/** 기록마다 나온 사람·기관 → { sure: Map(pid → [기록]), maybe: Map(pid → [동명이인이라 누군지 모르는 기록]) } */
function mentionMap(store) {
  const sure = new Map(), maybe = new Map();
  const { students, people } = store.work;
  if (!people.length) return { sure, maybe };
  const push = (m, pid, e) => { if (!m.has(pid)) m.set(pid, []); m.get(pid).push(e); };
  for (const e of textEntries(store)) {
    for (const pid of mentionedPids(e.text, students, people)) push(sure, pid, e);
    for (const pid of ambiguousPids(e.text, students, people)) push(maybe, pid, e);
  }
  return { sure, maybe };
}

/** 이 사람과 이름(또는 다른 이름)이 겹치는 다른 사람·기관 */
function homonymsOf(p, people) {
  const g = nameGroups(people);
  return [...new Set(namesOf(p).flatMap((n) => (g.get(n) || []).filter((o) => o !== p)))];
}

/** 동명이인 안내: 어떻게 구분해 쓰면 되는지 */
function homonymNote(p, people) {
  const others = homonymsOf(p, people);
  if (!others.length) return null;
  const g = nameGroups(people).get(p.name) || [p];
  const q = distinctQual(p, p.name, g);
  const sameTitle = p.kind === 'person' && others.some((o) => o.name === p.name && (o.title || '').replace(/님$/, '') === (p.title || '').replace(/님$/, ''));
  return h(`div.homonym-note${q ? '' : '.warn'}`,
    h('strong', `동명이인 ${others.length + 1}`), ' — ',
    others.map((o) => `${personLabel(o)}${o.org ? `(${o.org})` : ''}`).join(', '),
    h('br'),
    p.kind === 'org'
      ? '같은 다른 이름을 쓰면 누군지 정하지 못합니다. 정식 이름으로 쓰거나 다른 이름을 서로 다르게 정하세요.'
      : q
        ? [`글에 "${p.name}(${q})"처럼 쓰면 이 사람으로 알아봅니다.`, sameTitle ? '' : ` 호칭이 다르니 "${p.name} ${p.title || ''}"처럼 써도 됩니다.`]
        : '소속이나 다른 이름을 다른 사람과 다르게 채워 주세요. 그래야 "이름(소속)"처럼 구분해 쓸 수 있습니다.');
}

function addPerson(app, init) {
  const p = normPerson({ id: newId(), kind: 'person', ...init });
  app.store.work.people.push(p);
  app.store.markDirty();
  app.peopleView.sel = p.id;
  return p;
}

async function bulkAdd(app) {
  const kind = h('select', h('option', { value: 'person' }, '사람'), h('option', { value: 'org' }, '기관'));
  const ta = h('textarea', { rows: 8, placeholder: '한 줄에 하나씩, 쉼표나 탭으로 나눠 붙여넣으세요.\n사람: 이름, 호칭, 소속, 전화, 이메일\n  김민수, 선생님, 2학년부, 010-1234-5678, kim@school.kr\n기관: 이름, 전화, 이메일, 메모\n  경기도교육청, 031-000-0000' });
  const ok = await modal('여러 명 한꺼번에 넣기', h('div.form', h('label', '구분 ', kind), ta,
    h('p.muted.small', '엑셀·한글 표에서 복사해 붙여넣어도 됩니다(칸이 탭으로 나뉩니다). 이미 있는 이름은 건너뜁니다.')),
  [{ label: '취소', value: false }, { label: '넣기', value: true, primary: true }]);
  if (!ok) return;
  const have = new Set(app.store.work.people.map((p) => `${p.kind}:${p.name}`));
  const list = parsePeopleLines(ta.value, kind.value).filter((p) => !have.has(`${p.kind}:${p.name}`));
  for (const p of list) app.store.work.people.push({ ...p, id: newId() });
  if (list.length) app.store.markDirty();
  toast(`${list.length}개를 넣었습니다.`);
  app.render();
}

async function importPrevYear(app) {
  const { store } = app;
  try {
    const prev = await store.backend.loadYear(store.year - 1);
    const list = (prev?.people || []).map(normPerson).filter((p) => p.name);
    if (!list.length) { toast(`${store.year - 1}학년도 명부가 비어 있습니다.`); return; }
    const have = new Set(store.work.people.map((p) => `${p.kind}:${p.name}`));
    const add = list.filter((p) => !have.has(`${p.kind}:${p.name}`));
    for (const p of add) store.work.people.push({ ...p, id: newId() });
    if (add.length) store.markDirty();
    toast(`${store.year - 1}학년도 명부에서 ${add.length}개를 가져왔습니다.`);
    app.render();
  } catch (e) { toast(`가져오지 못했습니다: ${e.message}`, 'error'); }
}

function editor(app, p, onChange) {
  const { store } = app;
  const set = (k) => (e) => { p[k] = e.target.value; store.markDirty(); onChange?.(); };
  // 이름을 다 고치면(칸을 벗어나면) 다시 그려서 기록 모아보기·명부 목록에 반영
  const field = (label, k, attrs = {}) => h('label', label, h('input', { value: p[k] || '', oninput: set(k), onchange: k === 'name' || k === 'title' ? () => app.render() : null, ...attrs }));
  const isOrg = p.kind === 'org';
  const titles = h('datalist#title-list', TITLES.filter((t) => t.length > 1).map((t) => h('option', { value: t })));
  return h('div.person-edit',
    h('div.chips', Object.entries(KINDS).map(([k, label]) => h(`button.chip-btn${p.kind === k ? '.active' : ''}`, { onclick: () => { p.kind = k; store.markDirty(); app.render(); } }, label))),
    h('div.grid2',
      field(isOrg ? '기관 이름' : '이름', 'name', { placeholder: isOrg ? '예: 경기도교육청' : '예: 김민수' }),
      isOrg ? field('담당 부서·담당자', 'org', { placeholder: '예: 교육과정과 장학사 박○○' }) : field('호칭·직위', 'title', { list: 'title-list', placeholder: '예: 선생님, 장학사, 주무관' }),
      isOrg ? null : field('소속', 'org', { placeholder: '예: 2학년부, ○○중학교, ○○대학교' }),
      field('전화', 'phone', { type: 'tel', placeholder: '010-0000-0000' }),
      field('이메일', 'email', { type: 'email' }),
      h('label', '다른 이름 (쉼표로)', h('input', {
        value: (p.aliases || []).join(', '), placeholder: isOrg ? '예: 교육청, 도교육청' : '예: 김쌤',
        onchange: (e) => { p.aliases = e.target.value.split(/[,，、]/).map((x) => x.trim()).filter(Boolean); store.markDirty(); app.render(); },
      }))),
    h('label', '메모', h('textarea', { rows: 2, value: p.memo || '', oninput: set('memo') })),
    titles,
    h('div.row.contact-links',
      p.phone ? h('a.chip-btn', { href: `tel:${p.phone.replace(/[^\d+]/g, '')}` }, '📞 전화') : null,
      p.phone ? h('a.chip-btn', { href: `sms:${p.phone.replace(/[^\d+]/g, '')}` }, '✉ 문자') : null,
      p.email ? h('a.chip-btn', { href: `mailto:${p.email}` }, '📧 메일') : null,
      h('span.spacer'),
      h('button.small.danger', { onclick: async () => {
        if (!(await confirmDialog('명부에서 지우기', `${personLabel(p) || '이 항목'}을(를) 명부에서 지울까요? 기록에 쓴 글은 그대로 남습니다.`, '지우기'))) return;
        store.work.people = store.work.people.filter((x) => x !== p);
        store.markDirty();
        app.peopleView.sel = '';
        app.render();
      } }, '지우기')));
}

export function renderPeople(app) {
  const { store } = app;
  const v = (app.peopleView ||= { sel: '', q: '', kind: '' });
  const people = sortPeople(store.work.people);
  const { sure: mentions, maybe } = mentionMap(store);
  const homonymIds = new Set(people.filter((p) => homonymsOf(p, people).length).map((p) => p.id));
  const sel = people.find((p) => p.id === v.sel) || null;

  // ----- 왼쪽: 명부 -----
  const listBox = h('div.people-list-box');
  const drawList = () => {
    const q = v.q.trim();
    const shown = people.filter((p) => (!v.kind || p.kind === v.kind)
      && (!q || [p.name, p.title, p.org, p.phone, p.email, p.memo, ...(p.aliases || [])].some((x) => (x || '').includes(q))));
    fill(listBox, shown.length
      ? h('ul.people-list', shown.map((p) => h(`li${p.id === v.sel ? '.active' : ''}`, { onclick: () => { v.sel = p.id; app.render(); } },
        h('span.people-kind', p.kind === 'org' ? '🏢' : '👤'),
        h('span.people-name', h('strong', p.name || '(이름 없음)'), p.kind === 'person' && p.title ? ` ${p.title}` : ''),
        h('span.muted.small.people-org', homonymIds.has(p.id) ? h('span.homonym-badge', '동명이인') : null, p.org || ''),
        mentions.get(p.id)?.length ? h('span.badge', { title: '나온 기록 수' }, String(mentions.get(p.id).length)) : null)))
      : h('p.muted', people.length ? '찾는 이름이 없습니다.' : '아직 명부가 비어 있습니다. "+ 사람", "여러 명 붙여넣기"로 넣거나, 아래 "기록에서 찾은 이름"을 눌러 보세요.'));
  };
  drawList();
  const search = h('input', { type: 'search', placeholder: '이름·소속·전화로 찾기', value: v.q, oninput: (e) => { v.q = e.target.value; drawList(); } });
  const missing = findUnregistered(textEntries(store).map((e) => e.text), people).slice(0, 12);
  const left = h('section.card.people-list-card',
    h('div.card-head', h('h2', `사람·기관 (${people.length})`),
      h('div.row', { style: { margin: 0, gap: '6px' } },
        h('button.small.primary', { onclick: () => { addPerson(app, { kind: 'person' }); app.render(); } }, '+ 사람'),
        h('button.small', { onclick: () => { addPerson(app, { kind: 'org' }); app.render(); } }, '+ 기관'))),
    search,
    h('div.chips', [['', '전체'], ['person', '사람'], ['org', '기관']].map(([k, label]) =>
      h(`button.chip-btn${v.kind === k ? '.active' : ''}`, { onclick: () => { v.kind = k; app.render(); } }, label))),
    listBox,
    h('div.row', { style: { gap: '6px', flexWrap: 'wrap' } },
      h('button.small', { onclick: () => bulkAdd(app) }, '여러 명 붙여넣기'),
      h('button.small', { onclick: () => importPrevYear(app) }, `${store.year - 1}학년도 명부 가져오기`)),
    missing.length ? h('div.people-missing',
      h('div.small', h('strong', '기록에서 찾은 이름'), h('span.muted', ' — 눌러서 명부에 넣기')),
      h('div.chips', missing.map((m) => h('button.chip-btn', {
        title: `기록에 ${m.count}번 나옴`,
        onclick: () => { addPerson(app, { kind: 'person', name: m.name, title: m.title.replace(/님$/, '') === '선생' ? '선생님' : m.title }); app.render(); },
      }, `+ ${m.name} ${m.title} `, h('small', String(m.count)))))) : null);

  // ----- 오른쪽: 고르기 / 고치기 + 기록 -----
  let right;
  if (!sel) {
    right = h('section.card',
      h('div.card-head', h('h2', '사람·기관 명부')),
      h('div.help',
        h('p', '선생님·장학사·외부 강사 같은 사람과 교육청·대학·업체 같은 기관을 등록해 두면, 노트·업무·수업일지·상담일지에 쓴 이름을 학생처럼 알아봅니다.'),
        h('ul',
          h('li', '사람: "김민수 선생님께", "김민수쌤이"처럼 호칭이 붙으면 언제나 알아봅니다. 호칭이 없으면 같은 이름의 학생이 없을 때만 알아봅니다.'),
          h('li', '기관: 이름이나 "다른 이름"(예: 교육청, 도교육청)을 쓰면 알아봅니다. 뒤에 조사가 붙어도 됩니다.'),
          h('li', '이름 두 글자를 쓰면 추천 창이 뜹니다. 알아본 이름을 누르면 그 사람·기관이 나온 기록을 모아 봅니다.'),
          h('li', '동명이인은 "김민수(2학년부) 선생님"처럼 괄호에 소속(또는 다른 이름)을 붙여 쓰세요. 추천 창에서 고르면 자동으로 붙습니다. 누군지 모르는 이름에는 ?가 붙고, 누르면 골라서 고칠 수 있습니다.'),
          h('li', '사업·행사·프로젝트는 #태그로 쓰세요. 예: #방과후 #진로캠프')),
        h('p.muted.small', '명부는 학년도 폴더의 "사람·기관.md" 파일에 저장됩니다. 새 학년도에는 "지난 학년도 명부 가져오기"로 옮겨 오세요.')));
  } else {
    const list = (mentions.get(sel.id) || []).slice().sort((a, b) => (b.date || '0').localeCompare(a.date || '0'));
    const maybeList = (maybe.get(sel.id) || []).slice().sort((a, b) => (b.date || '0').localeCompare(a.date || '0'));
    const go = async (d) => { if (!d) return; app.tab = 'notebook'; await app.setDate(d); app.render(); };
    const groups = [];
    for (const e of list) {
      const k = e.date || '날짜 없음';
      if (groups.at(-1)?.k !== k) groups.push({ k, items: [] });
      groups.at(-1).items.push(e);
    }
    const recItems = (arr) => {
      const gs = [];
      for (const e of arr) {
        const k = e.date || '날짜 없음';
        if (gs.at(-1)?.k !== k) gs.push({ k, items: [] });
        gs.at(-1).items.push(e);
      }
      return h('div.tag-timeline', gs.map((g) => h('div.tag-day',
        h('div.tag-date', g.k === '날짜 없음' ? g.k : h('button.link', { onclick: () => go(g.k) }, koDate(g.k))),
        g.items.map((e) => {
          const plain = mentionInline(app, { activePerson: sel.id, update: e.update });
          return h(`div.tag-item${e.type === 'counsel' ? '.private-item' : ''}`,
            h(`span.type-badge.t-${e.type}`, TYPE_LABEL[e.type]),
            e.label ? h('strong.small', `${e.label} `) : null,
            e.md ? h('div.tag-text.md', renderMd(e.text, { plain })) : h('span.tag-text', plain(e.text)),
            e.done ? h('span.muted.small', ' (완료)') : null);
        }))));
    };
    right = h('section.card',
      h('div.card-head', h('h2.person-title', `${sel.kind === 'org' ? '🏢' : '👤'} ${personLabel(sel) || '새 항목'}`),
        h('button.small', { onclick: () => { v.sel = ''; app.render(); } }, '닫기')),
      editor(app, sel, () => {
        const t = document.querySelector('.people-page .person-title');
        if (t) t.textContent = `${sel.kind === 'org' ? '🏢' : '👤'} ${personLabel(sel)}`;
      }),
      homonymNote(sel, people),
      maybeList.length ? h('div.people-maybe',
        h('h3.people-rec-head', `누군지 정해지지 않은 기록 (${maybeList.length})`),
        h('p.muted.small', '동명이인이라 누구인지 정하지 못한 기록입니다. 물음표(?)가 붙은 이름을 눌러 고르면 글이 "이름(소속)"으로 고쳐집니다.'),
        recItems(maybeList)) : null,
      h('h3.people-rec-head', `나온 기록 (${list.length})`),
      groups.length ? recItems(list)
        : h('p.muted', sel.name ? `아직 "${sel.name}"이(가) 나온 기록이 없습니다.` : '이름을 먼저 쓰세요.'));
  }
  return h('div.split.people-page', left, right);
}
