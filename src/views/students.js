// 학생관리 탭: 학반별 명단(학번·사진) 편집 + 학생별 상담/출결/요록 + 지난 학년도 기록
import { h, koDate, downloadBlob, confirmDialog, modal, toast, pickFile, newId, fill } from '../lib/util.js';
import { exportCounsel } from '../lib/export.js';
import { studentLabel, classKey, newUid, normStudent, matchPhotoFile, buildIndex, searchStudents, statusAt, STATE_LABEL, STATUS_EVENTS, EVENT_HAS_GRADE, LEAVING_TYPES, FLAGS } from '../lib/students.js';
import { resizeImage } from '../lib/photos.js';
import { migrateRefs } from '../store.js';
import { classSelect, avatar } from './ui.js';

function counselList(items, onGo) {
  if (!items.length) return h('p.muted', '기록된 상담 일지가 없습니다.');
  return h('div.counsel-list', items.map((c) => h('div.counsel-item',
    onGo ? h('button.link', { onclick: () => onGo(c.date), title: '이 날짜의 교사수첩으로 이동' }, koDate(c.date)) : h('strong', koDate(c.date)),
    h('p', c.text))));
}

/** 상담 내역 조회 창 (교사수첩에서 학생 이름 클릭 시) */
export async function showStudentCounsel(app, uid) {
  const label = app.store.label(uid);
  let goDate = null;
  const body = h('div',
    h('div.row', h('button.small', { onclick: async () => downloadBlob(await exportCounsel(label, app.store.counselFor(uid)), `상담일지_${label}.docx`) }, '⬇ Word 다운로드')),
    counselList(app.store.counselFor(uid), (d) => { goDate = d; document.querySelector('.modal-overlay')?.click(); }));
  await modal(`${label} 학생 상담 일지`, body);
  if (goDate) { app.tab = 'notebook'; await app.setDate(goDate); app.render(); }
}

function pickFiles(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple: true, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

async function uploadPhoto(app, st, file) {
  const blob = await resizeImage(file);
  st.photo = await app.store.backend.savePhoto(app.store.year, normStudent(st), blob);
  app.store.markDirty();
}

/** 지난 학년도들에서 같은 학생(uid)의 기록 */
async function pastRecords(app, uid, years = 3) {
  const out = [];
  for (let y = app.store.year - 1; y >= app.store.year - years; y--) {
    try {
      const data = await app.store.backend.loadYear(y);
      const full = { students: [], attendance: [], counsel: [], records: [], ...data };
      for (const k of ['students', 'attendance', 'counsel', 'records']) full[k] ||= [];
      migrateRefs(full);
      const st = full.students.find((s) => s.uid === uid);
      if (!st) continue;
      out.push({ year: y, student: st, counsel: full.counsel.filter((c) => (c.students || []).includes(uid)).sort((a, b) => (a.date + a.order).localeCompare(b.date + b.order)), attendance: full.attendance.filter((a) => a.student === uid) });
    } catch { /* 해당 학년도 자료 없음 */ }
  }
  return out;
}

export function renderStudents(app) {
  const { store } = app;
  app.stuFilter ??= { cls: '', q: '', state: '' };
  const f = app.stuFilter;
  const all = store.students();
  const d = app.date;
  const stOf = (s) => statusAt(s, d).state;
  // 상태 거르기: 기본은 재학·휴학 (떠난 학생은 "떠난 학생"/"전체"에서)
  const stateOk = (s) => (f.state === 'all' ? true : f.state ? stOf(s) === f.state : stOf(s) !== 'gone');
  const order = { active: 0, leave: 1, gone: 2 };
  const list = searchStudents(f.q, all.filter((s) => (!f.cls || classKey(s) === f.cls) && stateOk(s)))
    .sort((a, b) => order[stOf(a)] - order[stOf(b)]);
  const hr = (cls) => store.settings.homerooms?.[cls] || {};
  const hrLine = (cls) => { const x = hr(cls); return x.main || x.sub ? h('p.homeroom', `${cls}반 · 담임 ${x.main || '-'} · 부담임 ${x.sub || '-'}`) : null; };
  const sel = all.find((s) => s.uid === app.selectedStudent) || list[0];

  // ----- 왼쪽: 명단 -----
  const listEl = h('div.stu-list', list.map((s) => {
    const state = stOf(s);
    return h(`button.stu-card${s === sel ? '.active' : ''}${state !== 'active' ? '.inactive' : ''}`, { onclick: () => { app.selectedStudent = s.uid; app.render(); } },
      avatar(app, s, 36), h('span.stu-no', s.studentNo || (s.no ?? '')), h('span.stu-name', s.name || '(이름 없음)'),
      state !== 'active' ? h('span.stu-state', statusAt(s, d).ev?.type || STATE_LABEL[state]) : null,
      s.leaving ? h('span.stu-leaving', { 'aria-hidden': 'true' }, '→') : null,
      // 교사만 아는 작은 점 (글자 없음)
      s.flags?.length ? h('span.fdots', { 'aria-hidden': 'true' }, s.flags.map((k) => h(`i.fdot.f-${k}`))) : null);
  }));
  const stateChips = h('div.chips', [['', '재학·휴학'], ['active', '재학'], ['leave', '휴학'], ['gone', '떠난 학생'], ['all', '전체']].map(([k, l]) =>
    h(`button.chip-btn${(f.state || '') === k ? '.active' : ''}`, { onclick: () => { f.state = k; app.render(); } }, l)));
  const search = h('input', { type: 'search', placeholder: '학번·이름 검색', value: f.q, oninput: (e) => { f.q = e.target.value; clearTimeout(search.t); search.t = setTimeout(() => app.render(), 250); } });
  const left = h('section.card',
    h('div.card-head', h('h2', `학생 명단 (${list.length}/${all.length}명)`),
      h('div.row', { style: { margin: 0 } },
        h('button.small', { onclick: () => {
          const [g, c] = (f.cls || '').split('-').map((x) => +x || null);
          const nos = all.filter((s) => classKey(s) === f.cls).map((s) => s.no || 0);
          const st = { id: newId(), uid: newUid(), studentNo: '', grade: g, cls: c, no: f.cls ? Math.max(0, ...nos) + 1 : null, name: '', photo: '' };
          store.work.students.push(normStudent(st)); store.markDirty();
          app.selectedStudent = st.uid; app.render();
          document.querySelector('.stu-detail input[aria-label="이름"]')?.focus();
        } }, '+ 학생'),
        h('button.small', { title: '파일 이름에 학번이나 이름이 들어 있으면 자동으로 찾아 붙입니다 (예: 10203_홍길동.jpg)', onclick: async () => {
          const files = await pickFiles('image/*');
          if (!files.length) return;
          let ok = 0; const miss = [];
          for (const file of files) {
            const st = matchPhotoFile(file.name, store.work.students);
            if (!st) { miss.push(file.name); continue; }
            try { await uploadPhoto(app, st, file); ok++; } catch (e) { miss.push(`${file.name} (${e.message})`); }
          }
          if (ok) await app.save();
          toast(`사진 ${ok}장 등록${miss.length ? `, ${miss.length}장은 학생을 찾지 못함: ${miss.slice(0, 3).join(', ')}${miss.length > 3 ? ' …' : ''}` : ''}`, miss.length ? 'error' : 'ok');
          app.render();
        } }, '📷 사진 일괄 등록'))),
    h('div.row', store.classList().length ? classSelect(store, f.cls, (v) => { f.cls = v; app.render(); }) : null, search),
    stateChips,
    f.cls ? hrLine(f.cls) : null,
    all.length ? listEl : h('p.muted', '학생이 없습니다. [+ 학생]으로 추가하거나 설정 > 정보 일괄 등록에서 CSV(학번, 이름 …)로 한 번에 올리세요.'),
    h('div.row', h('button', { onclick: () => carryOver(app) }, `${store.year - 1}학년도 명단 이어받기`), h('button.primary', { onclick: () => {
      const nos = store.work.students.map((s) => normStudent(s).studentNo).filter(Boolean);
      const dup = nos.filter((n, i) => nos.indexOf(n) !== i);
      if (dup.length) return toast(`학번이 겹칩니다: ${[...new Set(dup)].join(', ')}`, 'error');
      if (store.work.students.some((s) => !(s.name || '').trim())) return toast('이름이 빈 학생이 있습니다.', 'error');
      app.save();
    } }, '명단 저장')));

  // ----- 오른쪽: 선택한 학생 -----
  let right;
  if (!sel) right = h('section.card', h('p.muted', '학생을 고르면 학번·사진을 고치고, 상담·출결·요록 기록을 모아볼 수 있습니다.'));
  else {
    const st = store.work.students.find((s) => s.uid === sel.uid);
    const field = (label, key, type = 'text', w = '') => h('label', label, h('input', { type, value: st[key] ?? '', 'aria-label': label, style: w ? { width: w } : null, oninput: (e) => {
      st[key] = type === 'number' ? (e.target.value === '' ? null : +e.target.value) : e.target.value;
      store.markDirty();
    } }));
    const go = async (d) => { app.tab = 'notebook'; await app.setDate(d); app.render(); };
    const att = store.work.attendance.filter((a) => a.student === st.uid).sort((a, b) => a.date.localeCompare(b.date));
    const recs = store.work.records.filter((r) => (r.entries?.[st.uid] || '').trim());
    const pastBox = h('div');
    // 연락처: 평소에는 가려 두고 눌렀을 때만 보이기 (교실 화면 노출 방지)
    const contactBox = () => {
      const box = h('div.contact');
      const draw = (open) => fill(box, open
        ? h('div.inline-form',
          h('label', '이메일', h('input', { type: 'email', value: st.email || '', 'aria-label': '이메일', style: { width: '15em' }, oninput: (e) => { st.email = e.target.value; store.markDirty(); } })),
          st.email ? h('a.small', { href: `mailto:${st.email}` }, '메일 쓰기') : null,
          h('label', '전화번호', h('input', { type: 'tel', value: st.phone || '', 'aria-label': '전화번호', style: { width: '10em' }, oninput: (e) => { st.phone = e.target.value; store.markDirty(); } })),
          st.phone ? h('a.small', { href: `tel:${st.phone.replace(/[^\d+]/g, '')}` }, '전화 걸기') : null,
          h('button.small', { onclick: () => draw(false) }, '가리기'))
        : h('button.small', { onclick: () => draw(true) }, `📇 연락처 보기${st.email || st.phone ? '' : ' / 입력'}`));
      draw(false);
      return box;
    };
    right = h('div.col.stu-detail',
      h('section.card',
        h('div.stu-head',
          avatar(app, sel, 96),
          h('div.col', { style: { gap: '8px', flex: 1 } },
            h('div.inline-form', field('학번', 'studentNo', 'text', '7em'), field('학년', 'grade', 'number'), field('반', 'cls', 'number'), field('번호', 'no', 'number')),
            h('div.inline-form', field('이름', 'name', 'text', '10em'),
              h('label', '성별', h('select', { 'aria-label': '성별', onchange: (e) => { st.gender = e.target.value; store.markDirty(); } },
                ['', '남', '여'].map((g) => h('option', { value: g, selected: (st.gender || '') === g }, g || '-'))))),
            classKey(sel) ? hrLine(classKey(sel)) : null,
            contactBox(),
            h('div.row', { style: { margin: 0 } },
              h('button.small', { onclick: async () => {
                const file = await pickFile('image/*');
                if (!file) return;
                try { await uploadPhoto(app, st, file); await app.save(); app.render(); } catch (e) { toast(e.message, 'error'); }
              } }, sel.photo ? '사진 바꾸기' : '사진 올리기'),
              sel.photo ? h('button.small', { onclick: async () => {
                await store.backend.deletePhoto?.(store.year, st); st.photo = ''; store.markDirty(); await app.save(); app.render();
              } }, '사진 지우기') : null,
              h('button.small', { onclick: async () => {
                if (!(await confirmDialog('학생 삭제', `${studentLabel(sel)} 학생을 명단에서 삭제할까요? (작성한 일지는 남습니다)`, '삭제'))) return;
                store.work.students = store.work.students.filter((x) => x.uid !== st.uid); store.markDirty(); app.selectedStudent = null; app.render();
              } }, '명단에서 삭제')))),
        h('p.muted.small', '학번은 학년도마다 따로 저장됩니다. 새 학년도에 명단을 올릴 때 "이전학번" 열을 넣으면 지난 학년도 기록과 이어집니다.')),
      statusCard(app, st),
      h('section.card.private-report',
        h('div.card-head', h('h2', '상담 일지'),
          h('button.small', { onclick: async () => downloadBlob(await exportCounsel(studentLabel(sel), store.counselFor(st.uid)), `상담일지_${studentLabel(sel)}.docx`) }, '⬇ Word')),
        counselList(store.counselFor(st.uid), go)),
      h('section.card', h('div.card-head', h('h2', '출결')),
        att.length ? h('table.grid', h('thead', h('tr', h('th', '날짜'), h('th', '구분'), h('th', '사유'), h('th', '비고'))),
          h('tbody', att.map((a) => h('tr', h('td', h('button.link', { onclick: () => go(a.date) }, a.date)), h('td', a.type), h('td', a.reason), h('td', a.note)))))
          : h('p.muted', '출결 특이사항이 없습니다.')),
      h('section.card', h('div.card-head', h('h2', '학급요록')),
        recs.length ? h('table.grid', h('thead', h('tr', h('th', '요록'), h('th', '등록일'), h('th', '내용'))),
          h('tbody', recs.map((r) => h('tr', h('td', r.title), h('td', r.created), h('td', r.entries[st.uid])))))
          : h('p.muted', '요록 기록이 없습니다.')),
      h('section.card',
        h('div.card-head', h('h2', '지난 학년도 기록'),
          h('button.small', { onclick: async (e) => {
            e.target.disabled = true;
            fill(pastBox, h('p.muted', '불러오는 중…'));
            const past = await pastRecords(app, st.uid);
            fill(pastBox, ...(past.length ? past.map((p) => h('div',
              h('h3', `${p.year}학년도 · ${studentLabel(p.student)}${classKey(p.student) ? ` (${classKey(p.student)}반)` : ''}`),
              counselList(p.counsel, null),
              p.attendance.length ? h('p.small', `출결: ${p.attendance.map((a) => `${a.date} ${a.type}${a.reason ? `(${a.reason})` : ''}`).join(', ')}`) : null))
              : [h('p.muted', '지난 3개 학년도에서 같은 학생(ID)의 기록을 찾지 못했습니다.')]));
            e.target.disabled = false;
          } }, '불러오기')),
        pastBox));
  }
  return h('div.split', left, right);
}

/** CSV 로 학생 명단 등록. 열: 학번, 학년, 반, 번호, 이름, 이전학번(선택) — 학년/반/번호는 학번에서 자동 계산 가능 */
export async function importStudentsCSV(app, rows) {
  const { store } = app;
  const head = rows[0] || [];
  const hasHead = head.some((c) => /이름|학번|번호/.test(c));
  const col = (name) => head.findIndex((c) => c.replace(/\s/g, '') === name);
  let ci;
  if (hasHead && col('이름') >= 0) ci = { no: col('학번'), grade: col('학년'), cls: col('반'), num: col('번호'), name: col('이름'), prev: col('이전학번'), gender: col('성별'), email: col('이메일'), phone: Math.max(col('전화번호'), col('전화')) };
  else ci = head.length >= 2 ? { num: 0, name: 1, no: -1, grade: -1, cls: -1, prev: -1, gender: -1, email: -1, phone: -1 } : null; // 예전 형식: 번호, 이름
  if (!ci) throw new Error('CSV 형식을 알 수 없습니다. 예제 파일을 참고하세요.');
  const at = (r, i) => (i >= 0 ? (r[i] || '').trim() : '');
  const list = (hasHead ? rows.slice(1) : rows).filter((r) => at(r, ci.name)).map((r) => normStudent({
    studentNo: at(r, ci.no), grade: at(r, ci.grade), cls: at(r, ci.cls), no: at(r, ci.num), name: at(r, ci.name), prevNo: at(r, ci.prev),
    ...Object.fromEntries(['gender', 'email', 'phone'].filter((k) => at(r, ci[k])).map((k) => [k, at(r, ci[k])])),
  }));
  const nos = list.map((x) => x.studentNo).filter(Boolean);
  const dup = nos.filter((n, i) => nos.indexOf(n) !== i);
  if (dup.length) throw new Error(`학번이 겹칩니다: ${[...new Set(dup)].join(', ')}`);
  if (store.work.students.length && !(await confirmDialog('학생 명단 등록', `기존 학생 ${store.work.students.length}명을 새 명단 ${list.length}명으로 바꿀까요? 학번이 같거나, 이어받아 학번이 아직 없는 같은 이름의 학생은 기록(학적·표시 등)이 유지됩니다. 명단에 없는 휴학생은 그대로 남깁니다.`, '바꾸기'))) return null;

  // 지난 학년도와 연결: 이전학번 → 같은 학생(uid), 없으면 지난 학년도에 하나뿐인 같은 이름
  let prevIdx = null;
  try {
    const prev = await store.backend.loadYear(store.year - 1);
    const ps = { students: prev?.students || [], attendance: [], counsel: [], records: [] };
    migrateRefs(ps);
    if (ps.students.length) prevIdx = buildIndex(ps.students);
  } catch { /* 지난 학년도 없음 */ }
  const cur = buildIndex(store.work.students);
  // 이어받기로 들어와 학번이 아직 없는 학생: 이름이 하나뿐이면 새 명단의 같은 이름과 잇는다
  const noNo = buildIndex(store.work.students.filter((s) => !s.studentNo));
  const used = new Set();
  let linked = 0;
  const next = list.map((x) => {
    const byName = (ix) => (ix.byName.get(x.name)?.length === 1 ? ix.byName.get(x.name)[0] : null);
    let same = (x.studentNo && cur.byNo.get(x.studentNo)) || byName(noNo) || (!x.studentNo && byName(cur));
    if (same && used.has(same.uid)) same = null;
    if (same) used.add(same.uid);
    let uid = same?.uid;
    let from = same;
    if (!uid && prevIdx) {
      // 이름으로만 이을 때는 학년이 하나 올라간 경우만 (졸업생과 신입생 동명이인 방지)
      const byName = prevIdx.byName.get(x.name)?.length === 1 ? prevIdx.byName.get(x.name)[0] : null;
      const p = (x.prevNo && prevIdx.byNo.get(x.prevNo)) || (byName && (!x.grade || !byName.grade || x.grade === byName.grade + 1) ? byName : null);
      if (p) { uid = p.uid; linked++; from = p; }
    }
    const { prevNo, ...rest } = x;
    return { id: same?.id || newId(), ...Object.fromEntries(['gender', 'email', 'phone', 'statusLog', 'leaving', 'flags', 'flagMemo'].filter((k) => from?.[k]).map((k) => [k, from[k]])), ...rest, uid: uid || newUid(), photo: same?.photo || '' };
  });
  // 새 명단에 없는 휴학생은 남긴다 (복학하면 다시 반 배정)
  const keep = store.work.students.filter((s) => !used.has(s.uid) && !next.some((n) => n.uid === s.uid) && statusAt(s, app.date).state === 'leave');
  store.work.students = [...next, ...keep];
  store.markDirty();
  return { count: list.length, linked };
}

// ---------- 학적·전출 예정·표시 ----------
const maxGrade = (store) => (store.settings.schoolLevel === 'elem' ? 6 : 3);
const gradeSelect = (store, value, onChange, label = '학년') => h('select', { 'aria-label': label, onchange: (e) => onChange(e.target.value === '' ? null : +e.target.value) },
  h('option', { value: '' }, '-'),
  Array.from({ length: maxGrade(store) }, (_, i) => i + 1).map((g) => h('option', { value: g, selected: g === value }, `${g}학년`)));

/** 학생 상세의 "학적" 카드: 지금 상태, 변동 이력(날짜·학년), 전출 예정, 교사용 표시 */
function statusCard(app, st) {
  const { store } = app;
  const d = app.date;
  const { state, ev } = statusAt(st, d);
  const redraw = () => { store.markDirty(); app.render(); };

  // 변동 추가
  const nf = { date: d, type: '휴학', grade: st.grade ?? null, memo: '' };
  const gradeBox = h('span');
  const drawGrade = () => fill(gradeBox, EVENT_HAS_GRADE.has(nf.type)
    ? h('label', '학년 ', gradeSelect(store, nf.grade, (v) => { nf.grade = v; })) : null);
  drawGrade();
  const addEvent = (e) => {
    st.statusLog = [...(st.statusLog || []), e].sort((a, b) => a.date.localeCompare(b.date));
    // 이번 학년도 안의 복학·재입학·학년 변경이면 명단의 학년도 바꾼다
    if (e.grade && e.grade !== st.grade && e.date >= `${store.year}-03-01` && e.date <= `${store.year + 1}-02-29`) {
      st.grade = e.grade;
      toast(`${e.grade}학년으로 바꿨습니다. 반·번호·학번을 확인하세요.`);
    }
  };
  const addForm = h('div.inline-form.status-add',
    h('input', { type: 'date', value: nf.date, 'aria-label': '날짜', onchange: (e) => { nf.date = e.target.value; } }),
    h('select', { 'aria-label': '변동', onchange: (e) => { nf.type = e.target.value; drawGrade(); } },
      STATUS_EVENTS.map((t) => h('option', { value: t, selected: t === nf.type }, t))),
    gradeBox,
    h('input', { placeholder: '메모 (사유 등)', 'aria-label': '메모', style: { width: '12em' }, oninput: (e) => { nf.memo = e.target.value; } }),
    h('button.small.primary', { onclick: () => {
      if (!nf.date) return toast('날짜를 고르세요.', 'error');
      addEvent({ date: nf.date, type: nf.type, ...(EVENT_HAS_GRADE.has(nf.type) && nf.grade ? { grade: nf.grade } : {}), ...(nf.memo.trim() ? { memo: nf.memo.trim() } : {}) });
      redraw();
    } }, '+ 기록'));

  const log = st.statusLog || [];
  const history = log.length ? h('ol.status-log', log.map((e, i) => h(`li${e === ev ? '.current' : ''}${e.date > d ? '.future' : ''}`,
    h('span.status-date', e.date), ' ', h('strong', e.type), e.grade ? ` (${e.grade}학년)` : '', e.memo ? h('span.muted', ` — ${e.memo}`) : '',
    h('button.icon-btn.small', { title: '이 기록 지우기', 'aria-label': '이 기록 지우기', onclick: async () => {
      if (!(await confirmDialog('학적 기록 지우기', `${e.date} ${e.type} 기록을 지울까요?`, '지우기'))) return;
      st.statusLog = log.filter((_, k) => k !== i); redraw();
    } }, '✕')))) : h('p.muted.small', '변동 기록이 없습니다 (재학).');

  // 전출 예정
  const lv = st.leaving;
  const today_ = new Date().toISOString().slice(0, 10);
  const leavingBox = h('div.leaving-box',
    h('label.check', h('input', { type: 'checkbox', checked: !!lv, onchange: (e) => { if (e.target.checked) st.leaving = { type: '전학' }; else delete st.leaving; redraw(); } }), ' 전출 예정'),
    lv ? h('div.inline-form',
      h('select', { 'aria-label': '예정 종류', onchange: (e) => { lv.type = e.target.value; store.markDirty(); } }, Object.keys(LEAVING_TYPES).map((t) => h('option', { value: t, selected: t === lv.type }, t))),
      h('input', { type: 'date', value: lv.date || '', 'aria-label': '예정일', onchange: (e) => { if (e.target.value) lv.date = e.target.value; else delete lv.date; redraw(); } }),
      h('input', { placeholder: '메모', value: lv.memo || '', 'aria-label': '메모', style: { width: '12em' }, oninput: (e) => { if (e.target.value.trim()) lv.memo = e.target.value; else delete lv.memo; store.markDirty(); } })) : null,
    lv?.date && lv.date <= today_ ? h('div.leaving-due',
      `예정일(${lv.date})이 지났습니다. `,
      h('button.small.primary', { onclick: () => {
        addEvent({ date: lv.date, type: LEAVING_TYPES[lv.type] || '기타', ...(lv.memo ? { memo: lv.memo } : {}) });
        delete st.leaving; redraw();
      } }, `학적에 "${LEAVING_TYPES[lv.type] || '기타'}"로 반영`)) : null);

  // 교사용 표시: 평소에는 접어 둔다 (교실 화면 노출 방지)
  const flagBox = h('div.flag-box');
  const drawFlags = (open) => fill(flagBox, open
    ? h('div',
      h('div.row', { style: { gap: '8px', margin: 0, alignItems: 'center' } },
        FLAGS.map(([k, label]) => h('label.check', h('input', { type: 'checkbox', checked: (st.flags || []).includes(k), onchange: (e) => {
          const set = new Set(st.flags || []);
          if (e.target.checked) set.add(k); else set.delete(k);
          st.flags = FLAGS.map(([x]) => x).filter((x) => set.has(x));
          if (!st.flags.length) delete st.flags;
          store.markDirty(); app.render();
        } }), ' ', h(`i.fdot.f-${k}`), ` ${label}`)),
        h('button.small', { onclick: () => { app.flagOpen = null; drawFlags(false); } }, '접기')),
      h('textarea', { rows: 2, placeholder: '표시한 까닭 (나만 보는 메모)', value: st.flagMemo || '', style: { width: '100%', marginTop: '6px' },
        oninput: (e) => { st.flagMemo = e.target.value; store.markDirty(); } }))
    : h('button.small.flag-open', { onclick: () => { app.flagOpen = st.uid; drawFlags(true); } }, '··· 표시'));
  // 고른 학생을 바꾸면 다시 접힌다
  drawFlags(app.flagOpen === st.uid);

  return h('section.card.status-card',
    h('div.card-head', h('h2', '학적'),
      h(`span.state-badge.s-${state}`, state === 'active' ? '재학' : state === 'leave' ? '휴학 중' : ev.type, ev ? h('small', ` ${ev.date}~`) : null)),
    history,
    addForm,
    h('p.muted.small', '복학·재입학·전입·학년 변경(승급 등)은 학년을 함께 고를 수 있습니다. 상태는 위에서 보고 있는 날짜 기준입니다.'),
    leavingBox,
    flagBox);
}

/** 지난 학년도 명단 이어받기: 재학 1·2학년은 한 학년 올려서, 휴학생은 같은 학년으로(바꿀 수 있음), 졸업·떠난 학생은 빼고 */
async function carryOver(app) {
  const { store } = app;
  let prev;
  try { prev = await store.backend.loadYear(store.year - 1); } catch (e) { return toast(`지난 학년도를 불러오지 못했습니다: ${e.message}`, 'error'); }
  const ps = { students: prev?.students || [], attendance: [], counsel: [], records: [] };
  migrateRefs(ps);
  if (!ps.students.length) return toast(`${store.year - 1}학년도 명단이 비어 있습니다.`);
  const end = `${store.year}-02-29`; // 지난 학년도 마지막 날 기준 상태
  const have = new Set(store.work.students.map((s) => s.uid));
  const top = maxGrade(store);
  const rows = ps.students.filter((s) => !have.has(s.uid)).map((s) => {
    const { state, ev } = statusAt(s, end);
    const kind = state === 'gone' ? 'gone' : state === 'leave' ? 'leave' : (s.grade || 0) >= top ? 'grad' : 'up';
    return { s, ev, kind, on: kind === 'up' || kind === 'leave', grade: kind === 'up' ? (s.grade || 0) + 1 : s.grade };
  }).sort((a, b) => ['up', 'leave', 'grad', 'gone'].indexOf(a.kind) - ['up', 'leave', 'grad', 'gone'].indexOf(b.kind) || (a.s.studentNo || '').localeCompare(b.s.studentNo || ''));
  if (!rows.length) return toast('이어받을 학생이 없습니다. (이미 모두 있음)');
  const KIND = { up: '진급', leave: '휴학 중', grad: '졸업', gone: '떠남' };
  const body = h('div.carry',
    h('p.small', '재학 중인 학생은 한 학년 올리고, 휴학생은 같은 학년으로 가져옵니다(학년은 바꿀 수 있음). 졸업·떠난 학생은 기본으로 빼며, 재입학하는 학생은 체크하고 학년을 고르세요. 반·번호·학번은 새 반 배정 명단(CSV)을 올리면 채워집니다.'),
    h('div.carry-list', h('table.carry-table',
      h('thead', h('tr', h('th', ''), h('th', '지난 학번'), h('th', '이름'), h('th', '상태'), h('th', '새 학년'))),
      h('tbody', rows.map((r) => h(`tr.k-${r.kind}`,
        h('td', h('input', { type: 'checkbox', checked: r.on, 'aria-label': `${r.s.name} 가져오기`, onchange: (e) => { r.on = e.target.checked; } })),
        h('td', r.s.studentNo || ''), h('td', r.s.name),
        h('td', KIND[r.kind], r.ev && r.kind !== 'up' ? h('span.muted.small', ` ${r.ev.type} ${r.ev.date}`) : null),
        h('td', gradeSelect(store, r.grade, (v) => { r.grade = v; }))))))));
  const ok = await modal(`${store.year - 1}학년도 명단 이어받기`, body, [{ label: '취소', value: false }, { label: '가져오기', value: true, primary: true }]);
  if (!ok) return;
  let n = 0;
  for (const r of rows.filter((x) => x.on)) {
    const s = r.s;
    const st = normStudent({ id: newId(), uid: s.uid, studentNo: '', grade: r.grade, cls: null, no: null, name: s.name, photo: '',
      ...Object.fromEntries(['gender', 'email', 'phone', 'leaving', 'flags', 'flagMemo'].filter((k) => s[k]).map((k) => [k, s[k]])),
      statusLog: [...(s.statusLog || [])] });
    // 떠났던 학생을 다시 데려오면 재입학으로 기록
    if (r.kind === 'gone') st.statusLog = [...(st.statusLog || []), { date: `${store.year}-03-01`, type: '재입학', ...(r.grade ? { grade: r.grade } : {}) }];
    if (!st.statusLog?.length) delete st.statusLog;
    store.work.students.push(st);
    n++;
  }
  if (n) store.markDirty();
  toast(`${n}명을 이어받았습니다. 새 반 배정 명단(CSV)을 올리면 반·번호·학번이 채워집니다.`, 'ok');
  app.render();
}
