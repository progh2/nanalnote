// 학생관리 탭: 학반별 명단(학번·사진) 편집 + 학생별 상담/출결/요록 + 지난 학년도 기록
import { h, koDate, downloadBlob, confirmDialog, modal, toast, pickFile, newId, fill } from '../lib/util.js';
import { exportCounsel } from '../lib/export.js';
import { studentLabel, classKey, newUid, normStudent, matchPhotoFile, buildIndex, searchStudents, statusAt, STATE_LABEL, STATUS_EVENTS, EVENT_HAS_GRADE, LEAVING_TYPES, FLAGS, entryYearOf, cleanNo, partsOfNo, deptOf } from '../lib/students.js';
import { resizeImage, readClipboardImage } from '../lib/photos.js';
import { migrateRefs } from '../store.js';
import { classSelect, avatar, scrollToDetail, photoDrop } from './ui.js';
import { openStudentImport, STUDENT_TEMPLATE } from './import.js';
import { studentActivitiesCard } from './contests.js';
import { createSheet } from './sheet.js';
import { openPastImport } from './pastimport.js';
import { relationsBox } from './relations.js';
import { normPerson, cohortOf } from '../lib/people.js';
import { xlsxBlob } from '../lib/xlsx.js';

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
  if (app.stuTable) return studentSheet(app);
  app.stuFilter ??= { grade: '', cls: '', q: '', state: '' };
  const f = app.stuFilter;
  f.grade ??= '';
  const all = store.students();
  const d = app.date;
  const stOf = (s) => statusAt(s, d).state;
  const isPre = (s) => stOf(s) === 'pre';
  // 학년: '' 전체(입학 예정 빼고) / 1·2·3 / 'pre' 입학 예정(내년 신입생)
  const gradeOk = (s) => (f.grade === 'pre' ? isPre(s) : !isPre(s) && (!f.grade || s.grade === +f.grade));
  // 상태 거르기: 기본은 재학·휴학 (떠난 학생은 "떠난 학생"/"전체"에서)
  const stateOk = (s) => f.grade === 'pre' || (f.state === 'all' ? true : f.state ? stOf(s) === f.state : stOf(s) !== 'gone');
  const base = all.filter((s) => gradeOk(s) && (!f.cls || classKey(s) === f.cls) && stateOk(s));
  const list = searchStudents(f.q, base);
  const hr = (cls) => store.settings.homerooms?.[cls] || {};
  const hrLine = (cls) => { const x = hr(cls); return x.main || x.sub ? h('p.homeroom', `${cls}반 · 담임 ${x.main || '-'} · 부담임 ${x.sub || '-'}`) : null; };
  const sel = all.find((s) => s.uid === app.selectedStudent) || list[0];

  // ----- 왼쪽: 명단 (반별로 묶어서) -----
  const card = (s) => {
    const state = stOf(s);
    return h(`button.stu-card${s === sel ? '.active' : ''}${state !== 'active' ? '.inactive' : ''}`, { onclick: () => { app.selectedStudent = s.uid; app.render(); scrollToDetail('.stu-detail'); } },
      avatar(app, s, 36), h('span.stu-no', s.studentNo || (s.no ?? '')), h('span.stu-name', s.name || '(이름 없음)'),
      state !== 'active' && state !== 'pre' ? h('span.stu-state', statusAt(s, d).ev?.type || STATE_LABEL[state]) : null,
      s.leaving ? h('span.stu-leaving', { 'aria-hidden': 'true' }, '→') : null,
      // 교사만 아는 작은 점 (글자 없음)
      s.flags?.length ? h('span.fdots', { 'aria-hidden': 'true' }, s.flags.map((k) => h(`i.fdot.f-${k}`))) : null);
  };
  const groupsOf = (arr) => {
    const groups = [];
    for (const s of arr) {
      const k = `${isPre(s) ? 'pre:' : ''}${classKey(s) || '?'}`;
      if (groups.at(-1)?.k !== k) groups.push({ k, pre: isPre(s), cls: classKey(s), items: [] });
      groups.at(-1).items.push(s);
    }
    return groups;
  };
  const groupHead = (g) => {
    const dept = store.dept(g.items[0]);
    const x = hr(g.cls);
    return h('div.stu-group-head',
      h('strong', `${g.pre ? `${g.items[0].entryYear}학년도 입학 예정${cohortOf(g.items[0].entryYear) ? `(${cohortOf(g.items[0].entryYear)}기)` : ''} · ` : ''}${g.cls ? `${g.cls}반` : '반 미정'}`),
      h('span.muted.small', [dept, `${g.items.length}명`, !g.pre && (x.main || x.sub) ? `담임 ${x.main || '-'}${x.sub ? ` · 부담임 ${x.sub}` : ''}` : ''].filter(Boolean).join(' · ')));
  };
  // 검색칸에 글자를 칠 때는 이 목록만 다시 그린다 (화면 전체를 다시 그리면 검색칸이 새로 만들어져 포커스·한글 조합이 끊김)
  const listEl = h('div.stu-groups', { 'data-scroll-key': 'stu-list' });
  const countEl = h('h2');
  const drawList = (arr) => {
    const groups = groupsOf(arr);
    fill(listEl, ...groups.map((g) => h('div.stu-group', groups.length > 1 || g.cls ? groupHead(g) : null, h('div.stu-list', g.items.map(card)))),
      arr.length ? null : h('p.muted', all.length ? '찾는 학생이 없습니다.' : ''));
    countEl.textContent = `학생 명단 (${arr.length}/${all.length}명)`;
  };
  drawList(list);
  // 학년·반 고르기
  const grades = [...new Set(all.filter((s) => !isPre(s) && s.grade).map((s) => s.grade))].sort((a, b) => a - b);
  const pres = all.filter(isPre);
  const chip = (on, label, fn, title) => h(`button.chip-btn${on ? '.active' : ''}`, { onclick: fn, title }, label);
  const gradeChips = h('div.chips.grade-chips',
    chip(!f.grade, '전체', () => { f.grade = ''; f.cls = ''; app.render(); }),
    grades.map((g) => chip(f.grade === String(g), `${g}학년`, () => { f.grade = String(g); f.cls = ''; app.render(); })),
    pres.length ? chip(f.grade === 'pre', `입학 예정 ${pres.length}`, () => { f.grade = 'pre'; f.cls = ''; app.render(); }, `${[...new Set(pres.map((s) => s.entryYear))].join(', ')}학년도 신입생`) : null);
  const clsOf = f.grade ? [...new Set(all.filter(gradeOk).map(classKey).filter(Boolean))].sort((a, b) => +a.split('-')[1] - +b.split('-')[1]) : [];
  const clsChips = clsOf.length > 1 ? h('div.chips.cls-chips', chip(!f.cls, '모든 반', () => { f.cls = ''; app.render(); }),
    clsOf.map((k) => chip(f.cls === k, `${k.split('-')[1]}반`, () => { f.cls = k; app.render(); }))) : null;
  const stateChips = h('div.chips', [['', '재학·휴학'], ['active', '재학'], ['leave', '휴학'], ['gone', '떠난 학생'], ['all', '전체']].map(([k, l]) =>
    h(`button.chip-btn${(f.state || '') === k ? '.active' : ''}`, { onclick: () => { f.state = k; app.render(); } }, l)));
  const search = h('input', { type: 'search', placeholder: '학번·이름 검색', 'data-keep': 'stu-search', value: f.q, oninput: (e) => { f.q = e.target.value; clearTimeout(search.t); search.t = setTimeout(() => drawList(searchStudents(f.q, base)), 150); } });
  const left = h('section.card', { 'data-scroll-key': 'stu-card' },
    h('div.card-head', countEl,
      h('div.row', { style: { margin: 0 } },
        h('button.small', { onclick: () => {
          const [g, c] = (f.cls || '').split('-').map((x) => +x || null);
          const nos = all.filter((s) => classKey(s) === f.cls).map((s) => s.no || 0);
          const st = { id: newId(), uid: newUid(), studentNo: '', grade: g, cls: c, no: f.cls ? Math.max(0, ...nos) + 1 : null, name: '', photo: '' };
          store.work.students.push(normStudent(st)); store.markDirty();
          app.selectedStudent = st.uid; app.render();
          document.querySelector('.stu-detail input[aria-label="이름"]')?.focus();
        } }, '+ 학생'),
        h('button.small', { title: '엑셀(.xlsx)이나 CSV 명렬표로 여러 명을 한 번에', onclick: () => openStudentImport(app) }, '📥 엑셀로 올리기'),
        h('button.small', { title: '스프레드시트처럼 바로 고치고, 엑셀·구글 시트에서 복사해 붙여넣기', onclick: () => { app.stuTable = true; app.render(); } }, '📋 표로 편집'),
        h('button.small', { title: '작년 학번·이름·사진 링크 표를 붙여 넣어 지난 학번과 사진을 채우고, 작년 졸업반은 졸업생 명부로', onclick: () => openPastImport(app) }, '🕘 작년 학번·사진'),
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
    search,
    gradeChips,
    clsChips,
    f.grade === 'pre' ? h('p.muted.small', '내년 신입생(예비소집 등)입니다. 출결 선택에는 나오지 않고, 새 학년도에 "명단 이어받기"로 1학년이 됩니다. 정식 학번을 받으면 학번을 고치세요.') : stateChips,
    all.length ? listEl : h('div.empty-roster',
      h('p.muted', '학생이 없습니다. 학교 명렬표 엑셀 파일을 그대로 올리면 됩니다 — 제목 줄이 있어도 "학번·성명(이름)·성별·연락처" 같은 열을 찾아 읽습니다.'),
      h('div.row', h('button.primary', { onclick: () => openStudentImport(app) }, '📥 엑셀로 학생 명단 올리기'),
        h('button.small', { onclick: () => downloadBlob(xlsxBlob([{ name: '학생명단', rows: STUDENT_TEMPLATE }]), '학생명단_예제.xlsx') }, '예제 엑셀 받기'))),
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
          photoDrop(app, avatar(app, sel, 96), async (file) => {
            try { toast('사진을 줄여서 넣는 중…'); await uploadPhoto(app, st, file); await app.save({ silent: true }); app.render(); toast('사진을 넣었습니다.', 'ok'); } catch (e) { toast(e.message, 'error'); }
          }, `${sel.name} 사진`),
          h('div.col', { style: { gap: '8px', flex: 1 } },
            h('div.inline-form', field('학번', 'studentNo', 'text', '7em'), field('학년', 'grade', 'number'), field('반', 'cls', 'number'), field('번호', 'no', 'number')),
            h('div.inline-form',
              h('label', '입학 학년도', h('input', { type: 'number', min: 2000, max: 2100, value: st.entryYear ?? '', placeholder: String(entryYearOf(st, store.year) || ''), 'aria-label': '입학 학년도', style: { width: '7.5em' },
                onchange: (e) => { if (e.target.value) st.entryYear = +e.target.value; else delete st.entryYear; store.markDirty(); app.render(); } }),
                cohortOf(entryYearOf(st, store.year)) ? h('span.cohort', ` ${cohortOf(entryYearOf(st, store.year))}기`) : null),
              h('label', '학과', h('input', { list: 'dept-list', value: st.dept || '', placeholder: store.dept({ ...st, dept: '' }) || '학과', 'aria-label': '학과', style: { width: '11em' },
                oninput: (e) => { st.dept = e.target.value.trim(); if (!st.dept) delete st.dept; store.markDirty(); } })),
              h('datalist#dept-list', [...new Set(store.deptRules().map((r) => r.name))].map((n) => h('option', { value: n })))),
            (st.grade || 0) >= 2 || st.pastNos ? h('div.inline-form',
              [1, 2].filter((g) => g < (st.grade || 0) || st.pastNos?.[g]).map((g) => h('label', `${g}학년 때 학번`, h('input', { value: st.pastNos?.[g] || '', 'aria-label': `${g}학년 때 학번`, style: { width: '6.5em' },
                oninput: (e) => { st.pastNos ||= {}; const v = e.target.value.trim(); if (v) st.pastNos[g] = v; else { delete st.pastNos[g]; if (!Object.keys(st.pastNos).length) delete st.pastNos; } store.markDirty(); } })))) : null,
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
              h('button.small', { title: '복사(캡처)한 사진을 넣기 — 사진 칸을 누르고 Ctrl+V 해도 됩니다', onclick: async () => {
                try { const file = await readClipboardImage(); await uploadPhoto(app, st, file); await app.save({ silent: true }); app.render(); toast('사진을 넣었습니다.', 'ok'); } catch (e) { toast(e.message, 'error'); }
              } }, '📋 붙여넣기'),
              sel.photo ? h('button.small', { onclick: async () => {
                await store.backend.deletePhoto?.(store.year, st); st.photo = ''; store.markDirty(); await app.save(); app.render();
              } }, '사진 지우기') : null,
              h('button.small', { onclick: async () => {
                if (!(await confirmDialog('학생 삭제', `${studentLabel(sel)} 학생을 명단에서 삭제할까요? (작성한 일지는 남습니다)`, '삭제'))) return;
                store.work.students = store.work.students.filter((x) => x.uid !== st.uid); store.markDirty(); app.selectedStudent = null; app.render();
              } }, '명단에서 삭제')))),
        h('p.muted.small', '학번은 학년도마다 따로 저장됩니다. 새 학년도에 명단을 올릴 때 "이전학번" 열을 넣으면 지난 학년도 기록과 이어집니다.')),
      statusCard(app, st),
      h('section.card', relationsBox(app, `s:${st.uid}`)),
      studentActivitiesCard(app, st.uid),
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
    } }, '✕')))) : h('p.muted.small', state === 'pre' ? `${st.entryYear}학년도 입학 예정입니다. 입학하면 재학으로 바뀝니다.` : '변동 기록이 없습니다 (재학).');

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
      h(`span.state-badge.s-${state}`, state === 'active' ? '재학' : state === 'leave' ? '휴학 중' : state === 'pre' ? `${st.entryYear}학년도 입학 예정` : ev?.type || '', ev ? h('small', ` ${ev.date}~`) : null)),
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
    // 입학 예정(이번 학년도 신입생)은 1학년으로 들어온다
    const pre = s.entryYear && s.entryYear >= store.year && state === 'pre';
    const kind = pre ? 'pre' : state === 'gone' ? 'gone' : state === 'leave' ? 'leave' : (s.grade || 0) >= top ? 'grad' : 'up';
    return { s, ev, kind, on: kind === 'up' || kind === 'leave' || kind === 'pre', grade: kind === 'up' ? (s.grade || 0) + 1 : kind === 'pre' ? (s.grade || 1) : s.grade };
  }).sort((a, b) => ['pre', 'up', 'leave', 'grad', 'gone'].indexOf(a.kind) - ['pre', 'up', 'leave', 'grad', 'gone'].indexOf(b.kind) || (a.s.studentNo || '').localeCompare(b.s.studentNo || ''));
  if (!rows.length) return toast('이어받을 학생이 없습니다. (이미 모두 있음)');
  const KIND = { pre: '신입생', up: '진급', leave: '휴학 중', grad: '졸업', gone: '떠남' };
  const body = h('div.carry',
    h('p.small', '재학 중인 학생은 한 학년 올리고, 휴학생은 같은 학년으로 가져옵니다(학년은 바꿀 수 있음). 졸업·떠난 학생은 기본으로 빼며, 재입학하는 학생은 체크하고 학년을 고르세요. 반·번호·학번은 새 반 배정 명단(CSV)을 올리면 채워집니다.'),
    h('div.carry-list', h('table.carry-table',
      h('thead', h('tr', h('th', ''), h('th', '지난 학번'), h('th', '이름'), h('th', '상태'), h('th', '새 학년'))),
      h('tbody', rows.map((r) => h(`tr.k-${r.kind}`,
        h('td', h('input', { type: 'checkbox', checked: r.on, 'aria-label': `${r.s.name} 가져오기`, onchange: (e) => { r.on = e.target.checked; } })),
        h('td', r.s.studentNo || ''), h('td', r.s.name),
        h('td', KIND[r.kind], r.ev && r.kind !== 'up' ? h('span.muted.small', ` ${r.ev.type} ${r.ev.date}`) : null),
        h('td', gradeSelect(store, r.grade, (v) => { r.grade = v; }))))))));
  // 졸업하는 학생은 졸업생 명부(사람·기관 > 졸업생)로 옮길 수 있다 → 재학 때 기록과 이어짐
  const grads = rows.filter((r) => r.kind === 'grad');
  const already = new Set(store.work.people.filter((p) => p.kind === 'alumni' && p.stuUid).map((p) => p.stuUid));
  const toAlumni = { on: true };
  if (grads.length) body.append(h('label.check.carry-alumni', h('input', { type: 'checkbox', checked: true, onchange: (e) => { toAlumni.on = e.target.checked; } }),
    ` 졸업하는 ${grads.length}명을 졸업생 명부에 넣기 (사람·기관 > 졸업생, "...." 로 찾기)`));
  const ok = await modal(`${store.year - 1}학년도 명단 이어받기`, body, [{ label: '취소', value: false }, { label: '가져오기', value: true, primary: true }]);
  if (!ok) return;
  let alumni = 0;
  if (toAlumni.on) {
    const rules = store.deptRules();
    for (const r of grads.filter((x) => !x.on && !already.has(x.s.uid))) {
      const s = r.s;
      store.work.people.push(normPerson({ id: newId(), kind: 'alumni', name: s.name, gradYear: store.year - 1, entryYear: s.entryYear, studentNo: s.studentNo, dept: deptOf(s, rules, store.year - 1),
        gender: s.gender, phone: s.phone, email: s.email, stuUid: s.uid }));
      alumni++;
    }
  }
  let n = 0;
  for (const r of rows.filter((x) => x.on)) {
    const s = r.s;
    // 신입생은 임시 학번·반·번호를 그대로(정식 학번을 받으면 고침), 진급생은 지난 학번을 "○학년 때 학번"에 남긴다
    const pastNos = { ...(s.pastNos || {}) };
    if (r.kind !== 'pre' && s.studentNo && s.grade && !/^임시/.test(s.studentNo)) pastNos[s.grade] = s.studentNo;
    const st = normStudent({ id: newId(), uid: s.uid, studentNo: r.kind === 'pre' ? s.studentNo : '', grade: r.grade, cls: r.kind === 'pre' ? s.cls : null, no: r.kind === 'pre' ? s.no : null, name: s.name, photo: '',
      entryYear: s.entryYear || (s.grade ? store.year - 1 - s.grade + 1 : undefined), pastNos,
      ...Object.fromEntries(['gender', 'email', 'phone', 'leaving', 'flags', 'flagMemo', 'dept'].filter((k) => s[k]).map((k) => [k, s[k]])),
      statusLog: [...(s.statusLog || [])] });
    // 떠났던 학생을 다시 데려오면 재입학으로 기록
    if (r.kind === 'gone') st.statusLog = [...(st.statusLog || []), { date: `${store.year}-03-01`, type: '재입학', ...(r.grade ? { grade: r.grade } : {}) }];
    if (!st.statusLog?.length) delete st.statusLog;
    store.work.students.push(st);
    n++;
  }
  // 관계도 이어받기 (졸업한 학생 쪽은 졸업생 명부로)
  store.work.relations ||= [];
  const alumOf = new Map(store.work.people.filter((p) => p.kind === 'alumni' && p.stuUid).map((p) => [p.stuUid, `p:${p.uid}`]));
  const sNow = new Set(store.work.students.map((x) => x.uid));
  const pNow = new Set(store.work.people.map((x) => x.uid));
  const fix = (ref) => { const [t, id] = ref.split(/:(.*)/); if (t === 's') return sNow.has(id) ? ref : alumOf.get(id) || null; if (t === 'p') return pNow.has(id) ? ref : null; return null; };
  const haveRel = new Set(store.work.relations.map((r) => `${r.a}|${r.b}|${r.kind}`));
  let rels = 0;
  for (const r of prev?.relations || []) {
    const a = fix(r.a), b = fix(r.b);
    if (!a || !b || haveRel.has(`${a}|${b}|${r.kind}`)) continue;
    store.work.relations.push({ ...r, id: newId(), a, b }); rels++;
  }
  if (n || alumni || rels) store.markDirty();
  toast(`${n}명을 이어받았습니다${alumni ? `, 졸업생 ${alumni}명을 졸업생 명부에 넣었습니다` : ''}${rels ? `, 관계 ${rels}개` : ''}. 새 반 배정 명단을 올리면 반·번호·학번이 채워집니다.`, 'ok');
  app.render();
}

// ---------- 표로 편집 (스프레드시트처럼) ----------
function studentSheet(app) {
  const { store } = app;
  const f = (app.stuFilter ??= { grade: '', cls: '', q: '', state: '' });
  const d = app.date;
  const isPre = (s) => statusAt(s, d).state === 'pre';
  const gradeOk = (s) => (f.grade === 'pre' ? isPre(s) : !f.grade || (!isPre(s) && s.grade === +f.grade));
  // 보는 동안 줄 순서가 바뀌지 않게, 열 때 한 번 정렬해 둔 목록을 쓴다
  const view = store.students().filter((s) => gradeOk(s) && (!f.cls || classKey(s) === f.cls));
  const digits = (v) => (String(v).match(/\d+/)?.[0] || '');
  const num = (v) => (digits(v) === '' ? null : +digits(v));
  const dupNo = (s, no) => no && store.work.students.some((x) => x !== s && x.studentNo === no);
  // 학년·반·번호 칸을 비우면 학번에서 읽은 값으로 (엑셀에서 학번만 있는 표를 붙여 넣을 때)
  const numOr = (s, k, v) => num(v) ?? partsOfNo(s.studentNo)?.[k] ?? null;
  const countEl = h('span.muted.small');
  const drawCount = () => { countEl.textContent = `${view.filter((s) => s.name).length}명${f.grade === 'pre' ? ' (입학 예정)' : f.grade ? ` (${f.grade}학년${f.cls ? ` ${f.cls.split('-')[1]}반` : ''})` : ''}`; };
  drawCount();
  const past = (g) => ({ key: `past${g}`, title: `${g}학년 때 학번`, width: 5.5, get: (s) => s.pastNos?.[g] || '', set: (s, v) => {
    const no = cleanNo(v);
    s.pastNos ||= {};
    if (no) s.pastNos[g] = no; else { delete s.pastNos[g]; if (!Object.keys(s.pastNos).length) delete s.pastNos; }
  } });
  const sheet = createSheet({
    rows: () => view,
    addRow: () => {
      const [g, c] = (f.cls || '').split('-').map((x) => +x || null);
      const s = { id: newId(), uid: newUid(), studentNo: '', grade: g || (f.grade && f.grade !== 'pre' ? +f.grade : f.grade === 'pre' ? 1 : null), cls: c, no: null, name: '', photo: '' };
      if (f.grade === 'pre') s.entryYear = store.year + 1; // 입학 예정에서 새로 쓰면 내년 신입생
      store.work.students.push(s); view.push(s);
      return s;
    },
    removeRows: (list) => {
      store.work.students = store.work.students.filter((s) => !list.includes(s));
      for (const s of list) view.splice(view.indexOf(s), 1);
    },
    onChange: () => { store.markDirty(); drawCount(); },
    snapshot: () => JSON.stringify({ all: store.work.students, view: view.map((s) => s.uid) }),
    restore: (snap) => {
      const o = JSON.parse(snap);
      store.work.students = o.all;
      view.splice(0, view.length, ...o.view.map((u) => o.all.find((s) => s.uid === u)).filter(Boolean));
    },
    ghostText: f.grade === 'pre' ? '여기에 쓰거나 붙여넣으면 새 신입생' : '여기에 쓰거나 붙여넣으면 새 학생',
    readonlyHint: '학적은 학생 화면의 학적 카드에서 고칩니다.',
    columns: [
      { key: 'studentNo', title: '학번', width: 6, get: (s) => s.studentNo || '', set: (s, v) => {
        const no = cleanNo(v); // "임시1101" 처럼 임시 학번도
        if (dupNo(s, no)) return `학번 ${no} 이(가) 이미 있습니다.`;
        s.studentNo = no;
        Object.assign(s, partsOfNo(no) || {}); // 학번에서 학년·반·번호를 다시 읽는다
        return '';
      } },
      { key: 'grade', title: '학년', width: 3, get: (s) => s.grade ?? '', set: (s, v) => { s.grade = numOr(s, 'grade', v); } },
      { key: 'cls', title: '반', width: 3, get: (s) => s.cls ?? '', set: (s, v) => { s.cls = numOr(s, 'cls', v); } },
      { key: 'no', title: '번호', width: 3, get: (s) => s.no ?? '', set: (s, v) => { s.no = numOr(s, 'no', v); } },
      { key: 'name', title: '이름', width: 6, get: (s) => s.name || '', set: (s, v) => { s.name = v.trim(); } },
      { key: 'gender', title: '성별', width: 3, type: 'list', options: ['남', '여'], get: (s) => s.gender || '', set: (s, v) => {
        const t = v.trim(); s.gender = /^(남|남자|m)$/i.test(t) ? '남' : /^(여|여자|f)$/i.test(t) ? '여' : t; if (!s.gender) delete s.gender;
      } },
      { key: 'entryYear', title: '입학 학년도', width: 5, get: (s) => s.entryYear ?? '', set: (s, v) => {
        const y = num(v);
        if (y && (y < 1990 || y > 2100)) return `입학 학년도는 2027 처럼 네 자리로 씁니다: ${v}`;
        if (y) s.entryYear = y; else if (f.grade === 'pre') s.entryYear = store.year + 1; else delete s.entryYear;
        return '';
      } },
      // 학과: 비우면 설정의 학과 규칙(입학 학년도·반)으로 채운 값이 보인다
      { key: 'dept', title: '학과', width: 10, type: 'list', options: [...new Set(store.deptRules().map((r) => r.name))], get: (s) => store.dept(s), set: (s, v) => {
        const t = v.trim();
        if (!t || t === store.dept({ ...s, dept: '' })) delete s.dept; else s.dept = t;
      } },
      past(1), past(2),
      { key: 'phone', title: '전화번호', width: 8, get: (s) => s.phone || '', set: (s, v) => { s.phone = v.trim(); if (!s.phone) delete s.phone; } },
      { key: 'email', title: '이메일', width: 12, get: (s) => s.email || '', set: (s, v) => { s.email = v.trim(); if (!s.email) delete s.email; } },
      { key: 'state', title: '학적', width: 5, readonly: true, get: (s) => { const x = statusAt(s, d); return x.state === 'active' ? '' : x.state === 'pre' ? '입학 예정' : x.ev?.type || ''; }, set: () => '' },
    ],
  });
  const grades = [...new Set(store.work.students.filter((s) => !isPre(s) && s.grade).map((s) => s.grade))].sort((a, b) => a - b);
  const chip = (on, label, fn) => h(`button.chip-btn${on ? '.active' : ''}`, { onclick: fn }, label);
  const clsOf = f.grade ? [...new Set(store.work.students.filter(gradeOk).map(classKey).filter(Boolean))].sort((a, b) => +a.split('-')[1] - +b.split('-')[1]) : [];
  return h('section.card.student-sheet',
    h('div.card-head', h('h2', '학생 명단 — 표로 편집'), countEl,
      h('div.row', { style: { margin: 0, gap: '6px' } },
        h('button.small', { onclick: () => openStudentImport(app) }, '📥 엑셀 파일로 올리기'),
        h('button.small.primary', { onclick: () => { app.stuTable = false; app.render(); } }, '✓ 다 됐어요 (카드로 보기)'))),
    h('div.chips.grade-chips',
      chip(!f.grade, '전체', () => { f.grade = ''; f.cls = ''; app.render(); }),
      grades.map((g) => chip(f.grade === String(g), `${g}학년`, () => { f.grade = String(g); f.cls = ''; app.render(); })),
      chip(f.grade === 'pre', `${store.year + 1}학년도 입학 예정`, () => { f.grade = 'pre'; f.cls = ''; app.render(); })),
    clsOf.length > 1 ? h('div.chips.cls-chips', chip(!f.cls, '모든 반', () => { f.cls = ''; app.render(); }), clsOf.map((k) => chip(f.cls === k, `${k.split('-')[1]}반`, () => { f.cls = k; app.render(); }))) : null,
    h('p.muted.small.sheet-help', f.grade === 'pre'
      ? `내년(${store.year + 1}학년도) 신입생을 넣는 곳입니다. 학번은 "임시1101"처럼 쓰면 학년·반·번호를 채우고, 정식 학번을 받으면 고치면 됩니다. 입학 학년도는 ${store.year + 1} 로 들어갑니다. `
      : '엑셀·구글 시트에서 학번·학년·반·번호·이름… 순서의 칸을 복사해 학번 칸을 고르고 Ctrl+V 하면 한꺼번에 들어갑니다(넘치면 새 학생). 학번을 쓰면 학년·반·번호를 채우고, 학과는 설정의 학과 규칙으로 채웁니다. 줄 번호를 눌러 고른 뒤 Delete 로 학생 지우기, Ctrl+Z 되돌리기. ',
    sheet.statusEl),
    sheet);
}
