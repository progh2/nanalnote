// 설정 탭: 저장소(로컬/노션), 학년도 전환, 화면 설정, 정보 일괄 등록, 백업/복원
import { h, newId, toCSV, parseCSV, readTextFile, pickFile, downloadBlob, toast, confirmDialog, normalizeDate, schoolYearOf, today, yearRange, WEEKDAYS } from '../lib/util.js';
import { NotionBackend } from '../backends/notion.js';
import { LocalBackend } from '../backends/local.js';
import { COLLECTIONS } from '../store.js';
import { THEMES } from '../themes.js';

const card = (title, ...body) => h('section.card', h('div.card-head', h('h2', title)), ...body);

function storageCard(app) {
  const cfg = { backend: 'local', url: '', key: '', ...app.config };
  const url = h('input', { value: cfg.url, placeholder: 'https://sammynote-worker.아이디.workers.dev' });
  const key = h('input', { type: 'password', value: cfg.key, placeholder: 'Worker 에 설정한 APP_PASSWORD' });
  const out = h('div.result');
  const say = (msg, kind = '') => out.replaceChildren(h(`p.${kind || 'muted'}`, msg));
  const nb = () => new NotionBackend({ url: url.value.trim(), key: key.value });
  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { say(e.message, 'err'); } finally { btn.disabled = false; } };

  const testBtn = h('button', { onclick: () => busy(testBtn, async () => {
    const r = await nb().ping();
    say(`연결 성공 · 노션 DB ${r.databases}/${r.total}개 확인${r.databases < r.total ? ' → [노션 DB 만들기]를 눌러 주세요' : ''} · 특일정보 API ${r.holidays ? '사용' : '미설정(내장 데이터 사용)'}`, 'ok');
  }) }, '연결 테스트');
  const setupBtn = h('button', { onclick: () => busy(setupBtn, async () => {
    const r = await nb().setup();
    say(r.created.length ? `노션 DB를 만들었습니다: ${r.created.join(', ')}` : '필요한 노션 DB가 이미 모두 있습니다.', 'ok');
  }) }, '노션 DB 만들기');
  const useBtn = h('button.primary', { onclick: () => busy(useBtn, async () => {
    await nb().ping();
    await app.switchBackend({ backend: 'notion', url: url.value.trim(), key: key.value });
    toast('노션 저장소로 전환했습니다.', 'ok');
  }) }, '노션 사용하기');
  const migrateBtn = h('button', { onclick: () => busy(migrateBtn, async () => {
    const local = new LocalBackend();
    const years = await local.listYears();
    if (!years.length) return say('옮길 로컬 데이터가 없습니다.');
    if (!(await confirmDialog('로컬 → 노션 옮기기', `이 브라우저에 저장된 ${years.join(', ')}학년도 데이터를 노션에 추가합니다. 노션에 이미 같은 데이터가 있으면 중복될 수 있습니다. 계속할까요?`, '옮기기'))) return;
    const remote = nb();
    let total = 0, failed = 0;
    for (const y of years) {
      const data = await local.loadYear(y);
      const ops = [];
      for (const col of COLLECTIONS) for (const item of data[col] || []) ops.push({ op: 'upsert', col, item: { ...item, id: newId() } });
      say(`${y}학년도 ${ops.length}건 업로드 중… (노션 API 속도 제한으로 시간이 걸립니다)`);
      const res = await remote.applyOps(y, ops);
      total += ops.length; failed += res.filter((r) => !r.ok).length;
    }
    say(`완료: ${total}건 중 ${total - failed}건 업로드${failed ? `, ${failed}건 실패` : ''}.`, failed ? 'err' : 'ok');
  }) }, '로컬 데이터를 노션으로 옮기기');

  return card('저장소',
    h('p', '현재: ', h('strong', app.store.backend.label)),
    h('div.form',
      h('label', 'Worker 주소', url),
      h('label', '접속 비밀번호', key)),
    h('div.row', testBtn, setupBtn, useBtn,
      cfg.backend === 'notion' ? h('button', { onclick: () => app.switchBackend({ backend: 'local' }) }, '로컬 저장소로 돌아가기') : null),
    h('div.row', migrateBtn),
    out,
    h('details', h('summary', '노션 연결 방법'),
      h('ol',
        h('li', 'notion.so/my-integrations 에서 내부 통합(Integration)을 만들고 시크릿을 복사합니다.'),
        h('li', '데이터를 둘 노션 페이지를 만들고, 페이지 메뉴 ⋯ > 연결(Connections)에서 방금 만든 통합을 추가합니다.'),
        h('li', '저장소의 worker 폴더를 Cloudflare 에 배포하고 NOTION_TOKEN, NOTION_PARENT(페이지 ID), APP_PASSWORD 를 등록합니다. (README 참고)'),
        h('li', '위에 Worker 주소와 비밀번호를 입력하고 [연결 테스트] → [노션 DB 만들기] → [노션 사용하기] 순서로 누릅니다.')),
      h('p.muted.small', '상담 일지 등 민감정보가 노션에 저장됩니다. 노션 페이지 공유 범위를 본인으로 한정하고, 학교 정보보호 지침을 확인하세요.')));
}

function yearCard(app) {
  const cur = schoolYearOf(today());
  const years = [];
  for (let y = cur + 1; y >= cur - 6; y--) years.push(y);
  const sel = h('select', years.map((y) => h('option', { value: y, selected: y === app.store.year }, `${y}학년도${y === cur ? ' (현재)' : ''}`)));
  return card('학년도',
    h('p.muted.small', '매년 3월 1일을 기준으로 학년도가 자동으로 바뀝니다. 학년도마다 학생정보·시간표·학사일정이 따로 저장됩니다. 과거 학년도를 골라 열람하거나 수정할 수 있습니다.'),
    h('div.row', sel, h('button', { onclick: () => {
      const y = +sel.value;
      app.setDate(y === cur ? today() : yearRange(y).start);
    } }, '학년도 전환')),
    app.store.year !== cur ? h('p.warn', `지금 ${app.store.year}학년도 자료를 보고 있습니다. [오늘]을 누르면 현재 학년도로 돌아옵니다.`) : null,
    h('div.row', h('button.small', { onclick: async () => {
      const prev = app.store.year - 1;
      if (!(await confirmDialog('이전 학년도 설정 가져오기', `${prev}학년도의 교원정보·학교급·시간표를 ${app.store.year}학년도로 가져올까요?`, '가져오기'))) return;
      try {
        const data = await app.store.backend.loadYear(prev);
        const s = (data.settings || []).find((x) => x.key === 'main');
        if (!s) return toast(`${prev}학년도 설정이 없습니다.`, 'error');
        app.store.updateSettings(s.value);
        await app.save();
      } catch (e) { toast(e.message, 'error'); }
    } }, '이전 학년도 설정 가져오기')));
}

function displayCard(app) {
  const { store } = app;
  const s = store.settings;
  const info = h('input', { value: s.teacherInfo, placeholder: '예: ○○초등학교 3학년 2반 담임 홍길동' });
  const level = h('select', h('option', { value: 'elem', selected: s.schoolLevel === 'elem' }, '초등학교 (1~6교시, 과목)'), h('option', { value: 'secondary', selected: s.schoolLevel === 'secondary' }, '중/고등학교 (1~8교시, 학반/교실)'));
  const showMod = h('input', { type: 'checkbox', checked: s.showModified });
  return card('화면 설정',
    h('div.form',
      h('label', '교원정보 (상단 표시 문구)', info),
      h('label', '학교급', level),
      h('label.check', showMod, ' 최종수정일시를 교사수첩 하단과 인쇄물에 표시'),
      h('label', '테마', h('div.theme-swatches', THEMES.map(([v, l]) => h(`button.swatch${app.theme === v ? '.active' : ''}`, {
        'data-theme-preview': v, onclick: () => { app.setTheme(v); app.render(); },
      }, h('span.sw', { 'data-theme': v }, h('i'), h('i'), h('i')), l))))),
    h('div.row', h('button.primary', { onclick: async () => {
      store.updateSettings({ teacherInfo: info.value, schoolLevel: level.value, showModified: showMod.checked });
      await app.save();
    } }, '적용')));
}

function timetableCard(app) {
  const { store } = app;
  const s = store.settings;
  const tt = JSON.parse(JSON.stringify(s.timetable));
  const periods = store.periods;
  const label = s.schoolLevel === 'secondary' ? '학반/교실 (예: 1~2)' : '과목';
  return card('기본 시간표',
    h('p.muted.small', `교사수첩의 수업일지에 기본으로 표시될 ${label}입니다. 교사수첩에서 바꾸면 그 날만 바뀌고, 다음 주에는 기본 시간표로 돌아갑니다.`),
    h('div.records-wrap', h('table.grid.timetable',
      h('thead', h('tr', h('th', '교시'), [1, 2, 3, 4, 5].map((d) => h('th', WEEKDAYS[d])))),
      h('tbody', Array.from({ length: periods }, (_, i) => h('tr', h('th', `${i + 1}`),
        [1, 2, 3, 4, 5].map((d) => h('td', h('input', { value: tt[d]?.[i] || '', 'aria-label': `${WEEKDAYS[d]} ${i + 1}교시`, oninput: (e) => { (tt[d] ||= [])[i] = e.target.value; } })))))))),
    h('div.row', h('button.primary', { onclick: async () => { store.updateSettings({ timetable: tt }); await app.save(); } }, '시간표 저장')));
}

// ---------- 정보 일괄 등록 (CSV) ----------
const TEMPLATES = {
  schedule: { name: '학사일정', file: '학사일정_예제.csv', rows: (y) => {
    const out = [['날짜', '일정']];
    const { start, end } = yearRange(y);
    const d = new Date(start + 'T00:00');
    const e = new Date(end + 'T00:00');
    const sample = { [`${y}-03-02`]: '입학식, 시업식', [`${y}-03-03`]: '' };
    for (; d <= e; d.setDate(d.getDate() + 1)) {
      const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push([s, sample[s] || '']);
    }
    return out;
  } },
  students: { name: '학생정보', file: '학생정보_예제.csv', rows: () => [['번호', '이름'], ['1', '홍길동'], ['2', '성춘향'], ['3', '이몽룡']] },
  timetable: { name: '시간표', file: '시간표_예제.csv', rows: () => [['교시', '월', '화', '수', '목', '금'], ['1', '국어', '수학', '사회', '과학', '체육'], ['2', '수학', '국어', '영어', '음악', '미술'], ['3', '', '', '', '', ''], ['4', '', '', '', '', ''], ['5', '', '', '', '', ''], ['6', '', '', '', '', ''], ['7', '', '', '', '', ''], ['8', '', '', '', '', '']] },
};

async function importCSV(app, kind) {
  const file = await pickFile('.csv,text/csv');
  if (!file) return;
  const rows = parseCSV(await readTextFile(file));
  const body = rows.slice(/^\d/.test(rows[0]?.[0] || '') ? 0 : 1); // 머리글 행 자동 건너뛰기
  const { store } = app;
  if (kind === 'schedule') {
    let n = 0, skipped = 0;
    for (const [d, text] of body) {
      if (!(text || '').trim()) continue;
      const date = normalizeDate(d);
      if (!date) { skipped++; continue; }
      if (schoolYearOf(date) !== store.year) { skipped++; continue; }
      const ex = store.work.schedule.find((x) => x.date === date);
      if (ex) ex.text = text; else store.work.schedule.push({ id: newId(), date, text });
      n++;
    }
    store.markDirty();
    toast(`학사일정 ${n}건 등록${skipped ? ` (${skipped}건 건너뜀: 날짜 형식 오류 또는 다른 학년도)` : ''}`, 'ok');
  } else if (kind === 'students') {
    const list = body.filter((r) => (r[1] || '').trim()).map((r) => ({ no: +r[0] || null, name: r[1].trim() }));
    const dup = list.map((x) => x.name).filter((n, i, a) => a.indexOf(n) !== i);
    if (dup.length) return toast(`중복된 이름이 있습니다: ${[...new Set(dup)].join(', ')} — 홍길동1, 홍길동2 처럼 구분해 주세요.`, 'error');
    if (store.work.students.length && !(await confirmDialog('학생정보 등록', `기존 학생 ${store.work.students.length}명을 새 명단 ${list.length}명으로 바꿀까요?`, '바꾸기'))) return;
    const byName = new Map(store.work.students.map((s) => [s.name, s]));
    store.work.students = list.map((x) => ({ id: byName.get(x.name)?.id || newId(), ...x }));
    store.markDirty();
    toast(`학생 ${list.length}명 등록`, 'ok');
  } else if (kind === 'timetable') {
    const tt = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    for (const r of body) {
      const p = +r[0];
      if (!p || p > 8) continue;
      for (let d = 1; d <= 5; d++) tt[d][p - 1] = (r[d] || '').replace(/^(\d+)-(\d+)$/, '$1~$2');
    }
    store.updateSettings({ timetable: tt });
    toast('시간표를 등록했습니다.', 'ok');
  }
  await app.save();
}

function bulkCard(app) {
  return card('정보 일괄 등록',
    h('p.muted.small', '예제 파일(CSV)을 내려받아 엑셀이나 한셀에서 편집한 뒤 올리세요. 학사일정은 일정이 빈 날짜를 자동으로 건너뜁니다. 학생정보에는 번호와 이름만 넣습니다(민감정보 최소화). 중·고등학교 시간표에 학반을 적을 때는 엑셀이 날짜로 바꾸지 않도록 1-2 대신 1~2 처럼 적으세요.'),
    h('table.grid', h('tbody', Object.entries(TEMPLATES).map(([k, t]) => h('tr',
      h('th', t.name),
      h('td', h('button.small', { onclick: () => downloadBlob(new Blob([toCSV(t.rows(app.store.year))], { type: 'text/csv' }), t.file) }, '예제 파일 받기')),
      h('td', h('button.small.primary', { onclick: () => importCSV(app, k).catch((e) => toast(e.message, 'error')) }, 'CSV 올리기')))))));
}

function backupCard(app) {
  return card('백업 / 복원',
    h('p.muted.small', `현재 ${app.store.year}학년도 자료를 JSON 파일로 백업하거나, 백업 파일을 현재 저장소에 복원합니다.`),
    h('div.row',
      h('button', { onclick: () => {
        const data = { app: 'sammynote-web', version: 1, year: app.store.year, exportedAt: new Date().toISOString(), data: app.store.base };
        downloadBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `쌔미노트_백업_${app.store.year}.json`);
      } }, 'JSON 백업 받기'),
      h('button', { onclick: async () => {
        const f = await pickFile('.json,application/json');
        if (!f) return;
        try {
          const j = JSON.parse(await readTextFile(f));
          if (j.app !== 'sammynote-web' || !j.data) throw new Error('쌔미노트 백업 파일이 아닙니다.');
          if (!(await confirmDialog('복원', `${j.year}학년도 백업을 현재 저장소(${app.store.backend.label})에 덮어쓸까요? 현재 학년도의 기존 항목은 백업 내용으로 대체됩니다.`, '복원'))) return;
          if (j.year !== app.store.year) await app.setDate(yearRange(j.year).start, { force: true });
          const s = app.store;
          for (const col of COLLECTIONS) s.work[col] = (j.data[col] || []).map((x) => ({ ...x, id: newId() }));
          s.markDirty();
          await app.save();
        } catch (e) { toast(e.message, 'error'); }
      } }, 'JSON 복원')));
}

export function renderSettings(app) {
  if (app.error) {
    return h('div.settings', h('section.card.error-card', h('p', app.error)), storageCard(app));
  }
  return h('div.settings',
    h('div.col', storageCard(app), yearCard(app), backupCard(app)),
    h('div.col', displayCard(app), timetableCard(app), bulkCard(app)));
}
