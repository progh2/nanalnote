// 작년 학번·사진 붙여넣기 창
import { h, fill, modal, toast, newId } from '../lib/util.js';
import { parsePastRows, photoUrlOf, planPastImport } from '../lib/pastroster.js';
import { studentLabel, statusAt, deptOf, normStudent } from '../lib/students.js';
import { normPerson, PHOTO_FOLDER } from '../lib/people.js';
import { resizeImage, PHOTO_SIZE } from '../lib/photos.js';

/** 그림 주소 → 줄인 JPEG (구글 드라이브는 다른 사이트에서도 읽을 수 있는 주소로) */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchPhoto(url) {
  // 구글은 한꺼번에 많이 받으면 잠깐 막는다(429) → 기다렸다가 다시
  let res;
  for (let k = 0; k < 5; k++) {
    res = await fetch(photoUrlOf(url), { mode: 'cors', credentials: 'omit' });
    if (res.ok || ![429, 500, 502, 503].includes(res.status)) break;
    await wait(1500 * 2 ** k + Math.random() * 500);
  }
  if (!res.ok) throw new Error(res.status === 429 ? '구글이 잠시 막았습니다(요청이 많음) — 조금 뒤 같은 표를 다시 붙여 넣으면 못 받은 사진만 다시 받습니다.' : `사진을 받지 못했습니다 (${res.status}) — 드라이브 공유가 "링크가 있는 모든 사용자"인지 확인하세요.`);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error('그림 파일이 아닙니다.');
  return resizeImage(blob, PHOTO_SIZE);
}

/** 여러 개를 몇 개씩 나눠서 */
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

export async function openPastImport(app) {
  const { store } = app;
  const top = store.settings.schoolLevel === 'elem' ? 6 : 3;
  const prevYear = store.year - 1;
  const current = store.work.students.filter((s) => statusAt(s, app.date).state !== 'pre');
  const st = { photos: true, replace: false, alumni: true, plan: null, picks: new Map() };
  const ta = h('textarea.past-input', { rows: 7, placeholder: `${prevYear}학년도 학번 · 이름 · 사진 링크 표를 붙여 넣으세요 (구글 시트·엑셀에서 복사).\n예)\n1101\t홍길동\thttps://drive.google.com/uc?id=…\n2101\t성춘향\thttps://drive.google.com/uc?id=…`,
    oninput: () => { clearTimeout(ta.t); ta.t = setTimeout(draw, 250); } });
  const view = h('div.past-preview');
  const draw = () => {
    const rows = parsePastRows(ta.value);
    st.plan = rows.length ? planPastImport(rows, current, top) : null;
    st.picks.clear();
    const p = st.plan;
    if (!p) { fill(view, h('p.muted.small', '표를 붙여 넣으면 지금 명단과 맞춰 봅니다.')); return; }
    const photos = [...p.matches.map((m) => m.row), ...p.alumni].filter((r) => r.url).length;
    fill(view,
      h('ul.past-sum',
        h('li', h('strong', `${p.matches.length}명`), ` 지금 학생과 맞음 → "○학년 때 학번"${st.photos ? '·사진' : ''}`),
        p.alumni.length ? h('li', h('strong', `${p.alumni.length}명`), ` ${prevYear}학년도 ${top}학년 → 졸업생 명부(${prevYear} 졸업)`) : null,
        p.ambiguous.length ? h('li.warn-text', h('strong', `${p.ambiguous.length}명`), ' 같은 이름이 여럿 — 아래에서 고르세요') : null,
        p.missing.length ? h('li.muted', `${p.missing.length}명 지금 명단에 없음 (전학·휴학 등): ${p.missing.slice(0, 12).map((r) => `${r.no} ${r.name}`).join(', ')}${p.missing.length > 12 ? ' …' : ''}`) : null,
        photos ? h('li.muted.small', `사진 링크 ${photos}개`) : null),
      p.ambiguous.length ? h('div.past-amb', p.ambiguous.map(({ row, cands }) => h('label.row', { style: { margin: '2px 0', gap: '6px' } },
        h('span', `${row.no} ${row.name} →`),
        h('select', { onchange: (e) => { if (e.target.value) st.picks.set(row, cands.find((c) => c.uid === e.target.value)); else st.picks.delete(row); } },
          h('option', { value: '' }, '- 건너뛰기 -'), cands.map((c) => h('option', { value: c.uid }, `${studentLabel(c)} (${c.grade}-${c.cls})`)))))) : null);
  };
  draw();
  const body = h('div.past-import',
    h('p.small', `작년(${prevYear}학년도) 학번으로 지금 학생을 찾아 "○학년 때 학번"을 채우고 사진을 넣습니다. 작년 1학년은 지금 2학년, 작년 2학년은 지금 3학년에서 같은 이름을 찾습니다(같은 이름이 여럿이면 지금 반이 작년 반과 같은 학생).`),
    ta,
    h('div.row', { style: { gap: '12px' } },
      h('label.check.small', h('input', { type: 'checkbox', checked: true, onchange: (e) => { st.photos = e.target.checked; draw(); } }), ' 사진도 넣기'),
      h('label.check.small', h('input', { type: 'checkbox', onchange: (e) => { st.replace = e.target.checked; } }), ' 이미 있는 사진도 바꾸기'),
      h('label.check.small', h('input', { type: 'checkbox', checked: true, onchange: (e) => { st.alumni = e.target.checked; } }), ` ${top}학년은 졸업생 명부에`)),
    view);
  setTimeout(() => ta.focus(), 50);
  const ok = await modal('작년 학번·사진 붙여넣기', body, [{ label: '취소', value: false }, { label: '넣기', value: true, primary: true }]);
  if (!ok || !st.plan) return;

  const p = st.plan;
  const matches = [...p.matches, ...[...st.picks].map(([row, student]) => ({ row, student }))];
  // 1) 지난 학번
  for (const { row, student } of matches) {
    student.pastNos = { ...(student.pastNos || {}), [row.grade]: row.no };
    Object.assign(student, normStudent(student));
  }
  // 2) 졸업생 명부 (같은 졸업생이 이미 있으면 그 사람에게 사진만)
  const rules = store.deptRules();
  const alumni = [];
  if (st.alumni) {
    for (const row of p.alumni) {
      let a = store.work.people.find((x) => x.kind === 'alumni' && x.name === row.name && (x.studentNo === row.no || !x.studentNo) && (x.gradYear === prevYear || !x.gradYear));
      if (!a) {
        a = normPerson({ id: newId(), kind: 'alumni', name: row.name, gradYear: prevYear, studentNo: row.no, dept: deptOf({ grade: row.grade, cls: row.cls }, rules, prevYear) });
        store.work.people.push(a);
      }
      alumni.push({ row, a });
    }
  }
  store.markDirty();
  app.render();

  // 3) 사진 (몇 장씩 나눠 받기)
  let ok2 = 0, fail = 0;
  if (st.photos) {
    const jobs = [
      ...matches.filter(({ row, student }) => row.url && (st.replace || !student.photo)).map(({ row, student }) => ({ row, save: async (blob) => { student.photo = await store.backend.savePhoto(store.year, normStudent(student), blob); } })),
      ...alumni.filter(({ row, a }) => row.url && (st.replace || !a.photo)).map(({ row, a }) => ({ row, save: async (blob) => { const name = `${a.uid}.jpg`; await store.backend.putFile(store.year, PHOTO_FOLDER, name, blob); a.photo = name; } })),
    ];
    if (jobs.length) {
      toast(`사진 ${jobs.length}장을 받는 중…`);
      const errs = [];
      await pool(jobs, 3, async (j, k) => {
        try { await j.save(await fetchPhoto(j.row.url)); ok2++; } catch (e) { fail++; if (errs.length < 3) errs.push(`${j.row.no} ${j.row.name}: ${e.message}`); }
        if ((k + 1) % 10 === 0) toast(`사진 ${ok2 + fail}/${jobs.length}…`);
      });
      if (errs.length) console.warn('사진을 받지 못함', errs);
      store.markDirty();
    }
  }
  await app.save({ silent: true });
  app.render();
  toast(`지난 학번 ${matches.length}명${alumni.length ? `, 졸업생 ${alumni.length}명` : ''}${st.photos ? `, 사진 ${ok2}장` : ''}을 넣었습니다.${fail ? ` 사진 ${fail}장은 받지 못했습니다 — 조금 뒤 같은 표를 다시 붙여 넣으면 못 받은 것만 다시 받습니다.` : ''}`, fail ? 'error' : 'ok');
}
