// 설정 탭: 저장소(로컬/드롭박스/노션), 학년도 전환, 화면 설정, 정보 일괄 등록, 백업/복원
import { h, newId, toCSV, parseCSV, readTextFile, pickFile, downloadBlob, toast, confirmDialog, normalizeDate, schoolYearOf, today, yearRange, WEEKDAYS } from '../lib/util.js';
import { NotionBackend } from '../backends/notion.js';
import { LocalBackend } from '../backends/local.js';
import { DropboxBackend, startLogin, logout as dropboxLogout } from '../backends/dropbox.js';
import { COLLECTIONS } from '../store.js';
import { THEMES } from '../themes.js';
import { ttCell } from '../store.js';
import { importStudentsCSV } from './students.js';
import { bellOf, autoTimes, EVENING_BASE } from '../lib/bell.js';

const card = (title, ...body) => h('section.card', h('div.card-head', h('h2', title)), ...body);

/** 이 브라우저의 로컬 데이터를 다른 저장소로 복사 */
async function migrateLocal(target, label, say) {
  const local = new LocalBackend();
  const years = await local.listYears();
  if (!years.length) return say('옮길 로컬 데이터가 없습니다.');
  if (!(await confirmDialog(`로컬 → ${label} 옮기기`, `이 브라우저에 저장된 ${years.join(', ')}학년도 데이터를 ${label}에 추가합니다. 이미 같은 데이터가 있으면 중복될 수 있습니다. 계속할까요?`, '옮기기'))) return;
  let total = 0, failed = 0;
  for (const y of years) {
    const data = await local.loadYear(y);
    const ops = [];
    for (const col of COLLECTIONS) for (const item of data[col] || []) ops.push({ op: 'upsert', col, item: { ...item, id: newId() } });
    say(`${y}학년도 ${ops.length}건 옮기는 중…`);
    const res = await target.applyOps(y, ops);
    total += ops.length; failed += res.filter((r) => !r.ok).length;
  }
  say(`완료: ${total}건 중 ${total - failed}건 옮김${failed ? `, ${failed}건 실패` : ''}. 다른 화면으로 갔다 오거나 새로고침하면 보입니다.`, failed ? 'err' : 'ok');
}

function storageCard(app) {
  const cfg = { backend: 'local', url: '', key: '', ...app.config };
  const out = h('div.result');
  const say = (msg, kind = '') => out.replaceChildren(h(`p.${kind || 'muted'}`, msg));
  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { say(e.message, 'err'); } finally { btn.disabled = false; } };

  // ----- 드롭박스 -----
  const dbx = new DropboxBackend();
  const dbxInfo = h('span.muted', dbx.connected ? '연결됨 (계정 확인 중…)' : '연결 안 됨');
  if (dbx.connected) dbx.account().then((a) => { dbxInfo.textContent = `연결됨 · ${a.name?.display_name || ''} (${a.email || ''})`; }).catch((e) => { dbxInfo.textContent = `연결 확인 실패: ${e.message}`; });
  const dbxMigrate = h('button', { onclick: () => busy(dbxMigrate, () => migrateLocal(new DropboxBackend(), '드롭박스', say)) }, '로컬 데이터를 드롭박스로 옮기기');
  const dropboxSection = h('div.storage-opt',
    h('h3', '드롭박스 (추천)'),
    h('p.muted.small', '드롭박스의 Apps 폴더 안 쌔미노트 앱 폴더에 학년도별 마크다운(.md) 파일로 저장합니다. PC·휴대폰 어디서나 이 주소로 접속해 쓰고, 파일은 메모장·Obsidian 으로 열거나 Claude(드롭박스 커넥터)가 읽을 수 있습니다. 서버가 없고 로그인 정보는 이 브라우저에만 남습니다.'),
    h('p', '상태: ', dbxInfo),
    h('div.row',
      dbx.connected
        ? [
          cfg.backend !== 'dropbox' ? h('button.primary', { onclick: () => app.switchBackend({ backend: 'dropbox' }) }, '드롭박스 사용하기') : h('span.ok', '✓ 사용 중'),
          h('button', { onclick: async () => {
            if (!(await confirmDialog('드롭박스 연결 끊기', '이 브라우저의 드롭박스 로그인과 캐시를 지웁니다. 드롭박스의 파일은 그대로 남습니다.', '연결 끊기'))) return;
            await dropboxLogout();
            if (cfg.backend === 'dropbox') await app.switchBackend({ backend: 'local' });
            else app.render();
          } }, '연결 끊기'),
          dbxMigrate]
        : h('button.primary', { onclick: async () => { if (await app.confirmLeave()) startLogin(); } }, '드롭박스 연결'),
    ),
  );

  // ----- 노션 (고급) -----
  const url = h('input', { value: cfg.url, placeholder: 'https://sammynote-worker.아이디.workers.dev' });
  const key = h('input', { type: 'password', value: cfg.key, placeholder: 'Worker 에 설정한 APP_PASSWORD' });
  const nb = () => new NotionBackend({ url: url.value.trim(), key: key.value });
  const testBtn = h('button', { onclick: () => busy(testBtn, async () => {
    const r = await nb().ping();
    say(`연결 성공 · 노션 DB ${r.databases}/${r.total}개 확인${r.databases < r.total ? ' → [노션 DB 만들기]를 눌러 주세요' : ''} · 특일정보 API ${r.holidays ? '사용' : '미설정(내장 데이터 사용)'}`, 'ok');
  }) }, '연결 테스트');
  const setupBtn = h('button', { onclick: () => busy(setupBtn, async () => {
    const r = await nb().setup();
    say([r.created.length ? `노션 DB를 만들었습니다: ${r.created.join(', ')}` : '필요한 노션 DB가 모두 있습니다.', r.updated?.length ? `새 속성 추가: ${r.updated.join(', ')}` : ''].filter(Boolean).join(' · '), 'ok');
  }) }, '노션 DB 만들기');
  const useBtn = h('button', { onclick: () => busy(useBtn, async () => {
    await nb().ping();
    await app.switchBackend({ backend: 'notion', url: url.value.trim(), key: key.value });
    toast('노션 저장소로 전환했습니다.', 'ok');
  }) }, '노션 사용하기');
  const nMigrate = h('button', { onclick: () => busy(nMigrate, () => migrateLocal(nb(), '노션', say)) }, '로컬 데이터를 노션으로 옮기기');
  const notionSection = h('details.storage-opt', { open: cfg.backend === 'notion' },
    h('summary', '노션 (고급 · Cloudflare Worker 필요)'),
    h('div.form', h('label', 'Worker 주소', url), h('label', '접속 비밀번호', key)),
    h('div.row', testBtn, setupBtn, useBtn, nMigrate),
    h('ol.small',
      h('li', 'notion.so/my-integrations 에서 내부 통합(Integration)을 만들고 시크릿을 복사합니다.'),
      h('li', '데이터를 둘 노션 페이지를 만들고, 페이지 메뉴 ⋯ > 연결(Connections)에서 방금 만든 통합을 추가합니다.'),
      h('li', 'worker 폴더를 Cloudflare 에 배포하고 NOTION_TOKEN, NOTION_PARENT(페이지 ID), APP_PASSWORD 를 등록합니다. (README 참고)'),
      h('li', '[연결 테스트] → [노션 DB 만들기] → [노션 사용하기] 순서로 누릅니다.')));

  return card('저장소',
    h('p', '현재: ', h('strong', app.store.backend.label),
      cfg.backend !== 'local' ? h('button.small', { style: { marginLeft: '8px' }, onclick: () => app.switchBackend({ backend: 'local' }) }, '이 브라우저(로컬)로 전환') : null),
    dropboxSection,
    notionSection,
    out,
    h('p.muted.small', '상담 일지 등 민감정보가 클라우드에 저장됩니다. 공유 범위를 본인으로 한정하고, 학교 정보보호 지침을 확인하세요. 공용 PC에서는 사용 후 연결을 끊으세요.'));
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
  const level = h('select', h('option', { value: 'elem', selected: s.schoolLevel === 'elem' }, '초등학교 (시간표에 과목)'), h('option', { value: 'secondary', selected: s.schoolLevel === 'secondary' }, '중/고등학교 (시간표에 학반/교실)'));
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
      const patch = { teacherInfo: info.value, schoolLevel: level.value, showModified: showMod.checked };
      // 학교급을 바꿨고 아직 시정표를 손대지 않았다면 교시 수 기본값도 따라간다
      if (level.value !== s.schoolLevel && !s.bell) patch.bell = { ...bellOf({ schoolLevel: level.value }) };
      store.updateSettings(patch);
      await app.save();
    } }, '적용')));
}

/** 일과 시간(시정표) + 기본 시간표 */
function timetableCard(app) {
  const { store } = app;
  const s = store.settings;
  const tt = JSON.parse(JSON.stringify(s.timetable));
  const bell = JSON.parse(JSON.stringify(bellOf(s)));
  const subj = s.schoolLevel === 'secondary' ? '수업명·학반·교실' : '과목';
  const wrap = h('div');
  const time = (val, on, label) => h('input', { type: 'time', value: val || '', 'aria-label': label, oninput: (e) => on(e.target.value) });
  const sec = s.schoolLevel === 'secondary';
  const ttInput = (d, i, label) => {
    if (!sec) return h('td', h('input', { value: ttCell(tt[d]?.[i]).subject, 'aria-label': `${WEEKDAYS[d]} ${label}`, oninput: (e) => { (tt[d] ||= [])[i] = e.target.value; } }));
    const c = ttCell(tt[d]?.[i]);
    const set = (k) => (e) => { c[k] = e.target.value; (tt[d] ||= [])[i] = { ...c }; };
    return h('td.tt-cell',
      h('input', { value: c.subject, list: 'set-course-list', placeholder: '수업명', 'aria-label': `${WEEKDAYS[d]} ${label} 수업명`, oninput: set('subject') }),
      h('input', { value: c.cls, list: 'set-class-list', placeholder: '학반', 'aria-label': `${WEEKDAYS[d]} ${label} 학반`, oninput: set('cls') }),
      h('input', { value: c.room, list: 'set-room-list', placeholder: '교실', 'aria-label': `${WEEKDAYS[d]} ${label} 교실`, oninput: set('room') }));
  };
  const auto = { first: bell.times[0]?.start || (s.schoolLevel === 'secondary' ? '08:50' : '09:00'), lesson: s.schoolLevel === 'secondary' ? 50 : 40, rest: 10, lunchLen: 50 };

  const draw = () => {
    const count = bell.periodCount;
    const rows = [];
    for (let i = 0; i < count; i++) {
      const t = (bell.times[i] ||= { start: '', end: '' });
      rows.push(h('tr', h('th', `${i + 1}교시`),
        h('td.time-cell', time(t.start, (v) => (t.start = v), `${i + 1}교시 시작`), ' ~ ', time(t.end, (v) => (t.end = v), `${i + 1}교시 끝`)),
        [1, 2, 3, 4, 5].map((d) => ttInput(d, i, `${i + 1}교시`))));
      if (bell.lunch.after === i + 1) rows.push(h('tr.bell-row', h('th', '🍚 점심'), h('td.time-cell', time(bell.lunch.start, (v) => (bell.lunch.start = v), '점심 시작'), ' ~ ', time(bell.lunch.end, (v) => (bell.lunch.end = v), '점심 끝')), h('td.muted.small', { colspan: 5 }, `${i + 1}교시 다음`)));
    }
    if (bell.dinner.enabled) rows.push(h('tr.bell-row', h('th', '🍱 저녁'), h('td.time-cell', time(bell.dinner.start, (v) => (bell.dinner.start = v), '저녁 시작'), ' ~ ', time(bell.dinner.end, (v) => (bell.dinner.end = v), '저녁 끝')), h('td.muted.small', { colspan: 5 }, '저녁 식사')));
    bell.evening.forEach((ev, k) => {
      const idx = EVENING_BASE + k; // 교시 번호 11+k -> timetable index 10+k
      rows.push(h('tr.evening',
        h('th', h('input', { value: ev.label, 'aria-label': `저녁 방과후 ${k + 1} 이름`, style: { width: '6.5em' }, oninput: (e) => (ev.label = e.target.value.trim() || `방과후${k + 1}`) })),
        h('td.time-cell', time(ev.start, (v) => (ev.start = v), `${ev.label} 시작`), ' ~ ', time(ev.end, (v) => (ev.end = v), `${ev.label} 끝`)),
        [1, 2, 3, 4, 5].map((d) => ttInput(d, idx, ev.label))));
    });

    const sel = (val, opts, on, label) => h('select', { 'aria-label': label, onchange: (e) => { on(+e.target.value); draw(); } }, opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));
    wrap.replaceChildren(
      h('div.inline-form',
        h('label', '🏫 등교', time(bell.arrival, (v) => (bell.arrival = v), '등교 시각')),
        h('label', '정규 교시', sel(bell.periodCount, [4, 5, 6, 7, 8].map((n) => [n, `${n}교시까지`]), (v) => (bell.periodCount = v), '정규 교시 수')),
        h('label', '점심', sel(bell.lunch.after, [[0, '없음'], ...Array.from({ length: bell.periodCount }, (_, i) => [i + 1, `${i + 1}교시 다음`])], (v) => (bell.lunch.after = v), '점심 위치')),
        h('label', h('input', { type: 'checkbox', checked: bell.dinner.enabled, onchange: (e) => { bell.dinner.enabled = e.target.checked; draw(); } }), '저녁 식사'),
        h('label', '저녁 방과후', sel(bell.evening.length, [0, 1, 2, 3, 4].map((n) => [n, n ? `${n}개` : '없음']), (v) => {
          while (bell.evening.length < v) bell.evening.push({ label: `방과후${bell.evening.length + 1}`, start: '', end: '' });
          bell.evening.length = v;
        }, '저녁 방과후 수'))),
      h('details', h('summary.small', '⏱ 시각 자동 채우기'),
        h('div.inline-form', { style: { marginTop: '8px' } },
          h('label', '1교시 시작', h('input', { type: 'time', value: auto.first, oninput: (e) => (auto.first = e.target.value) })),
          h('label', '수업(분)', h('input', { type: 'number', min: 20, max: 120, value: auto.lesson, oninput: (e) => (auto.lesson = +e.target.value) })),
          h('label', '쉬는 시간(분)', h('input', { type: 'number', min: 0, max: 60, value: auto.rest, oninput: (e) => (auto.rest = +e.target.value) })),
          h('label', '점심(분)', h('input', { type: 'number', min: 0, max: 120, value: auto.lunchLen, oninput: (e) => (auto.lunchLen = +e.target.value) })),
          h('button.small', { onclick: () => {
            const r = autoTimes({ ...auto, count: bell.periodCount, lunchAfter: bell.lunch.after });
            if (!r) return toast('1교시 시작 시각을 입력하세요.', 'error');
            bell.times = r.times;
            if (r.lunch) bell.lunch = { ...bell.lunch, ...r.lunch };
            draw();
          } }, '채우기')),
        h('p.muted.small', '정규 교시만 채웁니다. 학교 시정표와 다르면 표에서 직접 고치세요.')),
      h('div.records-wrap', h('table.grid.timetable.bell-table',
        h('thead', h('tr', h('th', '교시'), h('th', '시간'), [1, 2, 3, 4, 5].map((d) => h('th', WEEKDAYS[d])))),
        h('tbody', rows))));
  };
  draw();

  const lists = h('div', { style: { display: 'none' } },
    h('datalist#set-course-list', (s.courses || []).map((x) => h('option', { value: x }))),
    h('datalist#set-class-list', store.classList().map((x) => h('option', { value: x }))),
    h('datalist#set-room-list', (s.rooms || []).map((x) => h('option', { value: x }))));
  return card('일과 시간 · 기본 시간표', lists,
    h('p.muted.small', `학교 시정표(등교, 교시별 시각, 점심·저녁)와 요일별 ${subj}을 넣으세요. 7·8교시가 없으면 정규 교시 수를 줄이면 됩니다. 고등학교 저녁 방과후·자율학습은 이름을 바꿔 쓸 수 있고, 수업일지에도 기록할 수 있습니다. 교사수첩에서 과목을 바꾸면 그 날만 바뀝니다.`),
    wrap,
    h('div.row', h('button.primary', { onclick: async () => {
      bell.times = bell.times.slice(0, bell.periodCount);
      if (bell.lunch.after > bell.periodCount) bell.lunch.after = bell.periodCount;
      store.updateSettings({ timetable: tt, bell });
      await app.save();
    } }, '일과 시간·시간표 저장')));
}

/** 내 수업명 · 교실/실습실 · 담당 학반 목록 */
function listsCard(app) {
  const { store } = app;
  const s = store.settings;
  const ta = (label, arr, ph) => h('label', label, h('textarea', { rows: 5, placeholder: ph, value: (arr || []).join('\n') }));
  const c = ta('내 수업명', s.courses, '한 줄에 하나씩\n예: 정보\n프로그래밍\n인공지능 기초');
  const r = ta('교실 · 실습실', s.rooms, '예: 컴퓨터실1\n메이커실\n1-2 교실');
  const k = ta('담당 학반', s.classes, '예: 1-2\n1-3\n2-1');
  const lines = (el) => [...new Set(el.querySelector('textarea').value.split('\n').map((x) => x.trim()).filter(Boolean))];
  return card('내 수업 · 교실 · 학반',
    h('p.muted.small', '여기 넣은 목록은 시간표와 수업일지에서 골라 쓸 수 있습니다. 학반은 학생 명단의 학년·반에서도 자동으로 모입니다.'),
    h('div.lists-grid', c, r, k),
    h('div.row', h('button.primary', { onclick: async () => { store.updateSettings({ courses: lines(c), rooms: lines(r), classes: lines(k) }); await app.save(); app.render(); } }, '목록 저장')));
}

// ---------- 정보 일괄 등록 (CSV) ----------
const TEMPLATES = {
  schedule: { name: '학사일정', file: '학사일정_예제.csv', rows: (y) => {
    const out = [['날짜', '일정', '휴업']];
    const { start, end } = yearRange(y);
    const d = new Date(start + 'T00:00');
    const e = new Date(end + 'T00:00');
    const sample = { [`${y}-03-02`]: ['입학식, 시업식', ''], [`${y}-05-04`]: ['재량휴업일', 'O'] };
    for (; d <= e; d.setDate(d.getDate() + 1)) {
      const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push([s, ...(sample[s] || ['', ''])]);
    }
    return out;
  } },
  students: { name: '학생정보', file: '학생정보_예제.csv', rows: () => [['학번', '학년', '반', '번호', '이름', '이전학번'], ['10101', '1', '1', '1', '홍길동', ''], ['10102', '1', '1', '2', '성춘향', ''], ['20305', '2', '3', '5', '이몽룡', '10412']] },
  timetable: { name: '시간표(일과 시간)', file: '시간표_예제.csv', rows: () => [
    ['교시', '시작', '끝', '월', '화', '수', '목', '금'],
    ['등교', '08:30', '', '', '', '', '', ''],
    ['1', '09:00', '09:40', '국어', '수학', '사회', '과학', '체육'],
    ['2', '09:50', '10:30', '수학', '국어', '영어', '음악', '미술'],
    ['3', '10:40', '11:20', '', '', '', '', ''],
    ['4', '11:30', '12:10', '', '', '', '', ''],
    ['점심', '12:10', '13:00', '', '', '', '', ''],
    ['5', '13:00', '13:40', '', '', '', '', ''],
    ['6', '13:50', '14:30', '', '', '', '', ''],
    ['저녁', '', '', '', '', '', '', ''],
    ['방과후1', '', '', '', '', '', '', ''],
  ] },
};

async function importCSV(app, kind) {
  const file = await pickFile('.csv,text/csv');
  if (!file) return;
  const rows = parseCSV(await readTextFile(file));
  const body = rows.slice(/^\d/.test(rows[0]?.[0] || '') ? 0 : 1); // 머리글 행 자동 건너뛰기
  const { store } = app;
  let msg = '';
  if (kind === 'schedule') {
    let n = 0, skipped = 0;
    for (const [d, text = '', holRaw = ''] of body) {
      const hol = /^(o|y|yes|1|예|휴업|휴일|v|✓|true)$/i.test(holRaw.trim());
      if (!text.trim() && !hol) continue;
      const date = normalizeDate(d);
      if (!date) { skipped++; continue; }
      if (schoolYearOf(date) !== store.year) { skipped++; continue; }
      let ex = store.work.schedule.find((x) => x.date === date);
      if (!ex) { ex = { id: newId(), date, text: '' }; store.work.schedule.push(ex); }
      ex.text = text.trim() || ex.text || '휴업일';
      if (hol) ex.holiday = true;
      n++;
    }
    store.markDirty();
    msg = (`학사일정 ${n}건 등록${skipped ? ` (${skipped}건 건너뜀: 날짜 형식 오류 또는 다른 학년도)` : ''}`);
  } else if (kind === 'students') {
    const r = await importStudentsCSV(app, rows);
    if (!r) return;
    msg = `학생 ${r.count}명 등록${r.linked ? ` (지난 학년도 기록과 ${r.linked}명 연결)` : ''}`;
  } else if (kind === 'timetable') {
    // 형식: 교시,시작,끝,월,화,수,목,금 (예전 형식 교시,월,…,금 도 지원)
    // 교시 칸: 숫자(정규 교시) / 등교 / 점심 / 저녁 / 그 밖의 이름(저녁 방과후)
    const head = rows[0] || [];
    const hasTime = head.includes('시작');
    const off = hasTime ? 3 : 1;
    const tt = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    const bell = { ...bellOf(store.settings), times: [], evening: [] };
    const lunchAfterRow = { seen: false };
    let maxP = 0;
    for (const r of /^\d/.test(head[0] || '') ? rows : rows.slice(1)) {
      const label = (r[0] || '').trim();
      if (!label) continue;
      const t = { start: hasTime ? r[1] || '' : '', end: hasTime ? r[2] || '' : '' };
      const cells = [1, 2, 3, 4, 5].map((d) => {
        const raw = (r[d + off - 1] || '').trim();
        if (!raw.includes('/')) return raw;
        const [subject = '', cls = '', room = ''] = raw.split('/').map((x) => x.trim());
        return { subject, cls: cls.replace(/^(\d+)~(\d+)$/, '$1-$2'), room };
      });
      if (/^\d+$/.test(label)) {
        const p = +label;
        if (p < 1 || p > 9) continue;
        maxP = Math.max(maxP, p);
        bell.times[p - 1] = t;
        cells.forEach((c, i) => (tt[i + 1][p - 1] = c));
      } else if (label === '등교') bell.arrival = t.start;
      else if (label === '점심') { bell.lunch = { ...t, after: maxP }; lunchAfterRow.seen = true; }
      else if (label === '저녁') bell.dinner = { enabled: !!(t.start || t.end), ...t };
      else if (bell.evening.length < 4) {
        const k = bell.evening.length;
        bell.evening.push({ label, ...t });
        cells.forEach((c, i) => (tt[i + 1][EVENING_BASE + k] = c));
      }
    }
    if (maxP) bell.periodCount = maxP;
    bell.times = Array.from(bell.times, (x) => x || { start: '', end: '' });
    if (!lunchAfterRow.seen && hasTime) bell.lunch = { start: '', end: '', after: 0 };
    for (let d = 1; d <= 5; d++) tt[d] = Array.from(tt[d], (x) => x || '');
    store.updateSettings({ timetable: tt, bell: hasTime ? bell : { ...bellOf(store.settings), periodCount: maxP || bellOf(store.settings).periodCount } });
    msg = (`시간표를 등록했습니다 (정규 ${maxP}교시${bell.evening.length ? `, 저녁 방과후 ${bell.evening.length}개` : ''}).`);
  }
  const r = await app.save();
  if (r.ok && msg) toast(`${msg} · 저장 완료`, 'ok');
  app.render();
}

function bulkCard(app) {
  return card('정보 일괄 등록',
    h('p.muted.small', '예제 파일(CSV)을 내려받아 엑셀이나 한셀에서 편집한 뒤 올리세요. 학사일정은 일정이 빈 날짜를 자동으로 건너뜁니다. 학생정보는 학번·학년·반·번호·이름만 넣습니다(민감정보 최소화). 새 학년도에는 "이전학번" 열을 채우면 지난 학년도 기록과 이어집니다. 중·고등학교 시간표에 학반을 적을 때는 엑셀이 날짜로 바꾸지 않도록 1-2 대신 1~2 처럼 적으세요. 시간표 파일에는 등교·점심·저녁 시각과 저녁 방과후 줄도 넣을 수 있습니다.'),
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
    h('div.col', storageCard(app), yearCard(app)),
    h('div.col', displayCard(app), listsCard(app), bulkCard(app), backupCard(app)),
    h('div.full', timetableCard(app)));
}
