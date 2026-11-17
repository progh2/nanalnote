// 학생관리 탭: 학반별 명단(학번·사진) 편집 + 학생별 상담/출결/요록 + 지난 학년도 기록
import { h, koDate, downloadBlob, confirmDialog, modal, toast, pickFile, newId } from '../lib/util.js';
import { exportCounsel } from '../lib/export.js';
import { studentLabel, classKey, newUid, normStudent, matchPhotoFile, buildIndex, searchStudents } from '../lib/students.js';
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
  app.stuFilter ??= { cls: '', q: '' };
  const f = app.stuFilter;
  const all = store.students();
  const list = searchStudents(f.q, all.filter((s) => !f.cls || classKey(s) === f.cls));
  const hr = (cls) => store.settings.homerooms?.[cls] || {};
  const hrLine = (cls) => { const x = hr(cls); return x.main || x.sub ? h('p.homeroom', `${cls}반 · 담임 ${x.main || '-'} · 부담임 ${x.sub || '-'}`) : null; };
  const sel = all.find((s) => s.uid === app.selectedStudent) || list[0];

  // ----- 왼쪽: 명단 -----
  const listEl = h('div.stu-list', list.map((s) => h(`button.stu-card${s === sel ? '.active' : ''}`, { onclick: () => { app.selectedStudent = s.uid; app.render(); } },
    avatar(app, s, 36), h('span.stu-no', s.studentNo || (s.no ?? '')), h('span.stu-name', s.name || '(이름 없음)'))));
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
    f.cls ? hrLine(f.cls) : null,
    all.length ? listEl : h('p.muted', '학생이 없습니다. [+ 학생]으로 추가하거나 설정 > 정보 일괄 등록에서 CSV(학번, 이름 …)로 한 번에 올리세요.'),
    h('div.row', h('button.primary', { onclick: () => {
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
      const draw = (open) => box.replaceChildren(open
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
            pastBox.replaceChildren(h('p.muted', '불러오는 중…'));
            const past = await pastRecords(app, st.uid);
            pastBox.replaceChildren(...(past.length ? past.map((p) => h('div',
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
  if (store.work.students.length && !(await confirmDialog('학생 명단 등록', `기존 학생 ${store.work.students.length}명을 새 명단 ${list.length}명으로 바꿀까요? 학번(없으면 이름)이 같은 학생은 기존 기록이 유지됩니다.`, '바꾸기'))) return null;

  // 지난 학년도와 연결: 이전학번 → 같은 학생(uid), 없으면 지난 학년도에 하나뿐인 같은 이름
  let prevIdx = null;
  try {
    const prev = await store.backend.loadYear(store.year - 1);
    const ps = { students: prev?.students || [], attendance: [], counsel: [], records: [] };
    migrateRefs(ps);
    if (ps.students.length) prevIdx = buildIndex(ps.students);
  } catch { /* 지난 학년도 없음 */ }
  const cur = buildIndex(store.work.students);
  let linked = 0;
  store.work.students = list.map((x) => {
    const same = (x.studentNo && cur.byNo.get(x.studentNo)) || (!x.studentNo && cur.byName.get(x.name)?.length === 1 && cur.byName.get(x.name)[0]);
    let uid = same?.uid;
    if (!uid && prevIdx) {
      // 이름으로만 이을 때는 학년이 하나 올라간 경우만 (졸업생과 신입생 동명이인 방지)
      const byName = prevIdx.byName.get(x.name)?.length === 1 ? prevIdx.byName.get(x.name)[0] : null;
      const p = (x.prevNo && prevIdx.byNo.get(x.prevNo)) || (byName && (!x.grade || !byName.grade || x.grade === byName.grade + 1) ? byName : null);
      if (p) { uid = p.uid; linked++; }
    }
    const { prevNo, ...rest } = x;
    return { id: same?.id || newId(), ...Object.fromEntries(['gender', 'email', 'phone'].filter((k) => same?.[k]).map((k) => [k, same[k]])), ...rest, uid: uid || newUid(), photo: same?.photo || '' };
  });
  store.markDirty();
  return { count: list.length, linked };
}
