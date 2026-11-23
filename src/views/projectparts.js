// 대회·활동과 #태그(사업)가 함께 쓰는 칸들: 개요(마크다운), 일정·단계, 자료(링크·파일), 관련 인물
import { h, fill, toast, confirmDialog, downloadBlob, today, pickFile } from '../lib/util.js';
import { stageId } from '../lib/contests.js';
import { renderMd } from '../lib/notemd.js';
import { studentLabel, resolveRef, classKey } from '../lib/students.js';
import { personLabel, teacherInfo } from '../lib/people.js';
import { mentionInline } from './mentions.js';
import { attachStudentSuggest } from './suggest.js';
import { createSheet } from './sheet.js';
import { refInfo } from './relations.js';

const safe = (s) => String(s || '').replace(/[\\/:*?"<>|#]/g, '').replace(/\s+/g, '_').slice(0, 60) || '파일';
const dd = (n) => (n === 0 ? 'D-day' : n > 0 ? `D-${n}` : `D+${-n}`);
const ddClass = (n) => (n < 0 ? '.over' : n <= 3 ? '.soon' : '');
const grow = (el) => {
  const fit = () => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; };
  el.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return el;
};

/** 개요: 쓰기 ↔ 보기 (obj[key] 마크다운) */
export function summaryBlock(app, obj, key, { title = '개요', placeholder = '', view = {} } = {}) {
  const { store } = app;
  const plain = mentionInline(app, { update: (fn) => { obj[key] = fn(obj[key] || ''); } });
  const box = h('div.contest-summary');
  const draw = () => {
    if (view.edit || !(obj[key] || '').trim()) {
      const ta = grow(h('textarea', { rows: 3, value: obj[key] || '', placeholder, oninput: (e) => { obj[key] = e.target.value; store.markDirty(); } }));
      attachStudentSuggest(ta, () => store.work.students, () => store.work.people, () => store.tagList());
      fill(box, ta, (obj[key] || '').trim() ? h('button.small', { onclick: () => { view.edit = false; draw(); } }, '✓ 보기') : null);
    } else {
      fill(box, h('div.md.contest-md', renderMd(obj[key], { plain })), h('button.small', { onclick: () => { view.edit = true; draw(); } }, '✎ 고치기'));
    }
  };
  draw();
  return h('div.contest-block', h('h3', title), box);
}

/**
 * 일정·단계 표
 * @param opt.beforeRemove (stage) => Promise<boolean> 지워도 되나 (참가 결과가 있으면 묻기 등)
 */
export function stagesBlock(app, obj, { presets = [], hint = '', beforeRemove = null } = {}) {
  const { store } = app;
  const t = today();
  obj.stages ||= [];
  const dirty = () => store.markDirty();
  const rows = obj.stages.map((s, i) => {
    const nx = (s.end || s.start) && (s.end || s.start) >= t ? Math.round((new Date((s.start && s.start >= t ? s.start : s.end || s.start) + 'T00:00') - new Date(t + 'T00:00')) / 86400000) : null;
    return h('tr',
      h('td', h('input', { value: s.name, 'aria-label': '단계 이름', oninput: (e) => { s.name = e.target.value; dirty(); }, onchange: () => app.render() })),
      h('td', h('input', { type: 'date', value: s.start || '', 'aria-label': '시작', onchange: (e) => { s.start = e.target.value; dirty(); app.render(); } })),
      h('td', h('input', { type: 'date', value: s.end || '', 'aria-label': '끝', onchange: (e) => { s.end = e.target.value; dirty(); app.render(); } })),
      h('td', h('input', { value: s.memo || '', placeholder: '메모 (장소, 방식…)', 'aria-label': '메모', oninput: (e) => { s.memo = e.target.value; dirty(); } })),
      h('td.nowrap', nx != null ? h(`span.due-btn${ddClass(nx)}`, dd(nx)) : (s.end || s.start) ? h('span.muted.small', '지남') : null),
      h('td', h('button.icon-btn', { title: '단계 지우기', 'aria-label': '단계 지우기', onclick: async () => {
        if (beforeRemove && !(await beforeRemove(s))) return;
        obj.stages.splice(i, 1); dirty(); app.render();
      } }, '✕')));
  });
  const add = (name) => { obj.stages.push({ id: stageId(), name }); dirty(); app.render(); };
  return h('div.contest-block',
    h('h3', '일정·단계'),
    obj.stages.length ? h('div.records-wrap', h('table.grid.stage-table', h('thead', h('tr', h('th', '단계'), h('th', '시작'), h('th', '끝'), h('th', '메모'), h('th', ''), h('th', ''))), h('tbody', rows)))
      : hint ? h('p.muted.small', hint) : null,
    h('div.chips', presets.filter((p) => !obj.stages.some((s) => s.name === p)).map((p) => h('button.chip-btn', { onclick: () => add(p) }, `+ ${p}`)),
      h('button.chip-btn', { onclick: () => add('새 단계') }, '+ 직접')));
}

/** 자료: 링크와 파일 (folder: 학년도 폴더 안 파일 폴더, base: 파일 이름 앞부분) */
export function resourcesBlock(app, obj, { folder, base = '' } = {}) {
  const { store } = app;
  obj.links ||= []; obj.files ||= [];
  const dirty = () => store.markDirty();
  const filesBox = h('div.contest-files');
  const drawFiles = () => fill(filesBox, ...obj.files.map((f, i) => {
    const thumb = h('div.file-thumb', /\.(png|jpe?g|gif|webp)$/i.test(f.file) ? '🖼' : /\.pdf$/i.test(f.file) ? '📄' : '📎');
    if (/\.(png|jpe?g|gif|webp)$/i.test(f.file)) {
      store.backend.fileUrl?.(store.year, folder, f.file).then((url) => { if (url) fill(thumb, h('img', { src: url, alt: f.title || f.file, loading: 'lazy' })); }).catch(() => {});
    }
    return h('div.file-item',
      thumb,
      h('input', { value: f.title || '', placeholder: '이름 (예: 포스터)', 'aria-label': '파일 이름', oninput: (e) => { f.title = e.target.value; dirty(); } }),
      h('div.row', { style: { margin: 0, gap: '4px' } },
        h('button.small', { onclick: async () => {
          try {
            const url = await store.backend.fileUrl?.(store.year, folder, f.file);
            if (!url) throw new Error('파일을 찾지 못했습니다.');
            downloadBlob(await (await fetch(url)).blob(), f.file);
          } catch (e) { toast(e.message, 'error'); }
        } }, '받기'),
        h('button.small', { title: '파일 지우기', onclick: async () => {
          if (!(await confirmDialog('파일 지우기', `${f.title || f.file} 파일을 지울까요?`, '지우기'))) return;
          try { await store.backend.deleteFile?.(store.year, folder, f.file); } catch { /* 이미 없음 */ }
          obj.files.splice(i, 1); dirty(); drawFiles();
        } }, '✕')));
  }));
  drawFiles();
  const upload = async () => {
    if (!store.backend.putFile) return toast('이 저장소는 파일을 지원하지 않습니다.', 'error');
    const file = await pickFile('*/*');
    if (!file) return;
    const ext = (file.name.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
    const name = `${safe(base)}_${safe(file.name.replace(/\.[^.]+$/, ''))}_${Date.now().toString(36)}${ext}`;
    toast('파일을 올리는 중…');
    try {
      await store.backend.putFile(store.year, folder, name, file);
      obj.files.push({ title: file.name.replace(/\.[^.]+$/, ''), file: name, uploaded: today() });
      dirty(); drawFiles(); toast('올렸습니다.', 'ok');
    } catch (e) { toast(`올리지 못했습니다: ${e.message}`, 'error'); }
  };
  const linksBox = h('div.contest-links', obj.links.map((l, i) => h('div.link-row',
    h('input', { value: l.title || '', placeholder: '이름 (예: 공식 사이트)', 'aria-label': '링크 이름', oninput: (e) => { l.title = e.target.value; dirty(); } }),
    h('input', { type: 'url', value: l.url || '', placeholder: 'https://', 'aria-label': '주소', oninput: (e) => { l.url = e.target.value.trim(); dirty(); } }),
    /^https?:\/\//.test(l.url || '') ? h('a.chip-btn', { href: l.url, target: '_blank', rel: 'noopener' }, '열기') : h('span'),
    h('button.icon-btn', { title: '링크 지우기', 'aria-label': '링크 지우기', onclick: () => { obj.links.splice(i, 1); dirty(); app.render(); } }, '✕'))));
  return h('div.contest-block',
    h('h3', '자료'),
    linksBox,
    filesBox,
    h('div.row', h('button.small', { onclick: () => { obj.links.push({ title: '', url: '' }); dirty(); app.render(); } }, '+ 링크'),
      h('button.small', { onclick: upload }, '+ 파일 올리기 (포스터·안내문·서식…)')));
}

// ---------- 관련 인물 ----------
export const MEMBER_ROLES = ['담당', '공동 담당', '강사', '참여 학생', '협력', '지원', '자문', '기타'];

/** "20101 김민준" / "정다온 선생님" / "경기도교육청" → ref */
export function findRef(store, text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const st = resolveRef(t, store.studentIndex());
  if (st) return `s:${st.uid}`;
  const ps = store.work.people.filter((p) => p.name === t || personLabel(p) === t || `${personLabel(p)}${p.org ? ` · ${p.org}` : ''}` === t);
  if (ps.length === 1) return `p:${ps[0].uid}`;
  const byName = store.work.people.filter((p) => t.startsWith(p.name) && t.length - p.name.length <= 6);
  return byName.length === 1 ? `p:${byName[0].uid}` : null;
}

/** 관련 인물 표 (obj.members: [{ref, role, memo}]) — 스프레드시트처럼, 학생·선생님·사람·기관 모두 */
export function membersBlock(app, obj, { title = '관련 인물' } = {}) {
  const { store } = app;
  obj.members ||= [];
  const sumEl = h('h3', { style: { margin: 0 } });
  const drawSum = () => {
    const s = obj.members.filter((m) => m.ref?.startsWith('s:')).length;
    sumEl.textContent = `${title} (${obj.members.length}${s ? ` · 학생 ${s}` : ''})`;
  };
  drawSum();
  const info = (ref) => {
    const [t, id] = String(ref || '').split(/:(.*)/);
    if (t === 's') { const s = store.work.students.find((x) => x.uid === id); return s ? [`${classKey(s) ? `${classKey(s)}반` : '학생'}`, s.phone || ''].filter(Boolean).join(' · ') : ''; }
    if (t === 'p') { const p = store.work.people.find((x) => x.uid === id); return p ? [teacherInfo(p), p.org, p.phone].filter(Boolean).join(' · ') : ''; }
    return '';
  };
  const sheet = createSheet({
    rows: () => obj.members,
    addRow: () => { const m = { ref: '', role: '', memo: '' }; obj.members.push(m); return m; },
    removeRows: (list) => { obj.members = obj.members.filter((m) => !list.includes(m)); },
    onChange: () => { store.markDirty(); drawSum(); },
    snapshot: () => JSON.stringify(obj.members),
    restore: (snap) => { obj.members = JSON.parse(snap); },
    ghostText: '학번·이름을 쓰거나 붙여넣기',
    readonlyHint: '소속·연락처는 학생관리·사람·기관에서 고칩니다.',
    columns: [
      { key: 'who', title: '인물 (학생·사람·기관)', width: 13, get: (m) => (m.ref ? refInfo(app, m.ref).name : m.text || ''), set: (m, v) => {
        const t = v.trim();
        if (!t) { m.ref = ''; delete m.text; return ''; }
        const ref = findRef(store, t);
        if (ref) { m.ref = ref; delete m.text; return ''; }
        m.ref = ''; m.text = t; // 명부에 없는 이름은 글자로 남겨 둔다
        return `"${t}" — 학생·사람·기관 명부에서 찾지 못해 글자로 적어 두었습니다 (사람·기관에 등록하면 연결됩니다)`;
      } },
      { key: 'role', title: '역할', width: 6, type: 'list', options: MEMBER_ROLES, get: (m) => m.role || '', set: (m, v) => { m.role = v.trim(); } },
      { key: 'memo', title: '메모', width: 12, wrap: true, get: (m) => m.memo || '', set: (m, v) => { m.memo = v; } },
      { key: 'info', title: '소속·연락처', width: 12, readonly: true, get: (m) => info(m.ref), set: () => '' },
    ],
  });
  return h('div.contest-block',
    h('div.card-head', { style: { margin: '4px 0 6px' } }, sumEl),
    h('p.muted.small.sheet-help', '학생은 학번·이름, 선생님·외부 인사·기관은 사람·기관 명부의 이름으로 씁니다. 엑셀에서 "이름 · 역할 · 메모"를 복사해 붙여 넣어도 됩니다. ', sheet.statusEl),
    sheet);
}

/** 이 학생·사람이 관련 인물로 들어 있는 #태그(사업) → [{tag, role, card}] */
export function projectsOf(store, ref) {
  return (store.work.tagcards || []).flatMap((c) => (c.members || []).filter((m) => m.ref === ref).map((m) => ({ tag: c.tag, role: m.role || '', card: c })));
}

export { studentLabel };
