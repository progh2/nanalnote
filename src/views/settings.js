// 설정 탭: 저장소(로컬/드롭박스/이 컴퓨터 폴더), 학년도 전환, 화면 설정, 정보 일괄 등록, 백업/복원
import { h, newId, toCSV, parseCSV, readTextFile, pickFile, downloadBlob, toast, confirmDialog, modal, normalizeDate, schoolYearOf, today, yearRange, WEEKDAYS, fill } from '../lib/util.js';
import { LocalBackend } from '../backends/local.js';
import { DropboxBackend, startLogin, logout as dropboxLogout, isPublicMode } from '../backends/dropbox.js';
import { isDesktop, pickFolder, PORTABLE_FOLDER } from '../lib/desktop.js';
import { COLLECTIONS } from '../store.js';
import { THEMES } from '../themes.js';
import { FORMATS, exportFormat, setExportFormat } from '../lib/export.js';
import { ttCell, courseOf } from '../store.js';
import { openStudentImport, readTable, TABLE_ACCEPT } from './import.js';
import { xlsxBlob } from '../lib/xlsx.js';
import { parseDeptRules } from '../lib/students.js';
import { bellOf, rawBell, cascadeFrom, addMin, csatTimes, EVENING_BASE } from '../lib/bell.js';
import { timeSelect } from './ui.js';
import { vaultEnabled, setupPin, changePin, removeVault, validPin, registerPasskey, removePasskey, hasPasskey, passkeyAvailable } from '../lib/vault.js';
import { loadAll, decryptAllToPlain } from '../lib/securestore.js';
import { PROVIDERS, loadAI, saveAI, listModels, testAI } from '../lib/ai.js';

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
  const say = (msg, kind = '') => fill(out, h(`p.${kind || 'muted'}`, msg));
  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { say(e.message, 'err'); } finally { btn.disabled = false; } };

  // ----- 이 컴퓨터 폴더 (데스크톱 앱) -----
  const desk = app.desktop;
  let folderSection = null;
  if (isDesktop()) {
    const curFolder = cfg.folder === PORTABLE_FOLDER ? `${desk?.default_data_dir || ''} (포터블)` : (cfg.folder || desk?.default_data_dir || '');
    folderSection = h('div.storage-opt',
      h('h3', `이 컴퓨터 폴더 (추천)${desk?.portable ? ' · 포터블 모드' : ''}`),
      h('p.muted.small', '고른 폴더에 학년도별 마크다운(.md) 파일로 저장합니다. 드롭박스 프로그램이 동기화하는 폴더(예: Dropbox/Apps/<앱 폴더>)를 고르면 웹판(드롭박스 저장소)과 같은 자료를 함께 쓸 수 있습니다.'),
      desk?.portable ? h('p.muted.small', '포터블 모드: 실행 파일 옆 portable.txt 가 있어 자료와 설정을 이 USB(폴더) 안의 "나날노트자료"에 저장합니다. 다른 컴퓨터에 꽂아도 그대로 이어집니다.') : null,
      h('p', '폴더: ', h('code', curFolder)),
      h('div.row',
        cfg.backend !== 'folder' ? h('button.primary', { onclick: () => app.switchBackend({ backend: 'folder', folder: cfg.folder || (desk?.portable ? PORTABLE_FOLDER : desk?.default_data_dir) }) }, '이 컴퓨터 폴더 사용하기') : h('span.ok', '✓ 사용 중'),
        h('button', { onclick: async () => {
          const dir = await pickFolder(cfg.folder && cfg.folder !== PORTABLE_FOLDER ? cfg.folder : desk?.default_data_dir);
          if (!dir) return;
          if (!(await confirmDialog('자료 폴더 바꾸기', `이제부터 "${dir}" 폴더의 자료를 쓰고 저장합니다. 지금 폴더의 자료는 옮겨지지 않습니다(필요하면 파일을 직접 복사하세요). 계속할까요?`, '바꾸기'))) return;
          await app.switchBackend({ backend: 'folder', folder: dir, folderChosen: true });
        } }, '폴더 바꾸기'),
        desk?.portable && cfg.folder !== PORTABLE_FOLDER ? h('button', { onclick: () => app.switchBackend({ backend: 'folder', folder: PORTABLE_FOLDER, folderChosen: false }) }, 'USB 안 기본 폴더로') : null));
  }

  // ----- 드롭박스 -----
  const dbx = new DropboxBackend();
  const publicPc = h('input', { type: 'checkbox' });
  const dbxInfo = h('span.muted', dbx.connected ? `연결됨${isPublicMode() ? ' · 공용 PC 모드' : ''} (계정 확인 중…)` : '연결 안 됨');
  if (dbx.connected) dbx.account().then((a) => { dbxInfo.textContent = `연결됨${isPublicMode() ? ' · 공용 PC 모드' : ''} · ${a.name?.display_name || ''} (${a.email || ''})`; }).catch((e) => { dbxInfo.textContent = `연결 확인 실패: ${e.message}`; });
  const dbxMigrate = h('button', { onclick: () => busy(dbxMigrate, () => migrateLocal(new DropboxBackend(), '드롭박스', say)) }, '로컬 데이터를 드롭박스로 옮기기');
  const dropboxSection = h('div.storage-opt',
    h('h3', '드롭박스 (추천)'),
    h('p.muted.small', '드롭박스의 Apps 폴더 안 이 앱의 폴더에 학년도별 마크다운(.md) 파일로 저장합니다. PC·휴대폰 어디서나 이 주소로 접속해 쓰고, 파일은 메모장·Obsidian 으로 열거나 Claude(드롭박스 커넥터)가 읽을 수 있습니다. 서버가 없고 로그인 정보는 이 브라우저에만 남습니다.'),
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
        : [h('button.primary', { onclick: async () => { if (await app.confirmLeave()) startLogin(publicPc.checked); } }, '드롭박스 연결'),
          h('label.check.small', publicPc, ' 공용 PC (로그인 정보를 저장하지 않음 — 탭을 닫으면 로그아웃)')],
    ),
  );

  return card('저장소',
    h('p', '현재: ', h('strong', app.store.backend.label),
      cfg.backend !== 'local' ? h('button.small', { style: { marginLeft: '8px' }, onclick: () => app.switchBackend({ backend: 'local' }) }, '이 브라우저(로컬)로 전환') : null),
    folderSection,
    isDesktop() ? h('p.muted.small', '드롭박스 로그인 연결은 웹판(브라우저)에서만 됩니다. 데스크톱 앱에서는 드롭박스 프로그램이 동기화하는 폴더를 "이 컴퓨터 폴더"로 고르세요.') : dropboxSection,
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
  const level = h('select', { 'aria-label': '학교급' }, h('option', { value: 'elem', selected: s.schoolLevel === 'elem' }, '초등학교 (시간표에 과목)'), h('option', { value: 'secondary', selected: s.schoolLevel === 'secondary' }, '중/고등학교 (시간표에 학반/교실)'));
  const showMod = h('input', { type: 'checkbox', checked: s.showModified });
  return card('화면 설정',
    h('div.form',
      h('label', '교원정보 (상단 표시 문구)', info),
      h('label', '학교급', level),
      h('label.check', showMod, ' 최종수정일시를 교사수첩 하단과 인쇄물에 표시'),
      h('label', '내려받기 형식 (이 기기)', h('div.row', { style: { margin: 0 } },
        Object.entries(FORMATS).map(([v, l]) => h(`button.small${exportFormat() === v ? '.active-size' : ''}`, {
          onclick: () => { setExportFormat(v); app.render(); },
        }, `${l} (.${v})`)))),
      h('label', '글자 크기 (이 기기)', h('div.row', { style: { margin: 0 } },
        [[1, '보통'], [1.12, '크게'], [1.25, '아주 크게'], [1.4, '가장 크게']].map(([v, l]) => h(`button.small${app.prefs.fontScale === v ? '.active-size' : ''}`, {
          onclick: () => { app.prefs.fontScale = v; app.render(); },
        }, l)))),
      h('label', '테마', h('div.theme-swatches', THEMES.map(([v, l]) => h(`button.swatch${app.theme === v ? '.active' : ''}`, {
        'data-theme-preview': v, onclick: () => { app.setTheme(v); app.render(); },
      }, h('span.sw', { 'data-theme': v }, h('i'), h('i'), h('i')), l))))),
    h('div.row', h('button.primary', { onclick: async () => {
      const patch = { teacherInfo: info.value, schoolLevel: level.value, showModified: showMod.checked };
      // 학교급을 바꿨고 아직 시정표를 손대지 않았다면 교시 수 기본값도 따라간다
      if (level.value !== s.schoolLevel) {
        if (!s.bell) patch.bell = { ...rawBell({ schoolLevel: level.value }) };
        else {
          // 수업 길이를 손대지 않았다면(이전 학교급 기본값) 새 학교급 기본값(초등 40분, 중·고 50분)으로
          const b = rawBell(s);
          if (b.lessonLen === (s.schoolLevel === 'secondary' ? 50 : 40)) patch.bell = { ...b, lessonLen: level.value === 'secondary' ? 50 : 40 };
        }
      }
      store.updateSettings(patch);
      await app.save();
    } }, '적용')));
}

/** 일과 시간(시정표) + 기본 시간표 */
function timetableCard(app) {
  const { store } = app;
  const s = store.settings;
  const tt = JSON.parse(JSON.stringify(s.timetable));
  const bell = JSON.parse(JSON.stringify(rawBell(s)));
  const subj = s.schoolLevel === 'secondary' ? '수업명·학반·교실' : '과목';
  const wrap = h('div');
  const sec = s.schoolLevel === 'secondary';
  const ttInput = (d, i, label) => {
    if (!sec) return h('td', h('input', { value: ttCell(tt[d]?.[i]).subject, list: 'set-course-list', 'aria-label': `${WEEKDAYS[d]} ${label}`, oninput: (e) => { (tt[d] ||= [])[i] = e.target.value; } }));
    const c = ttCell(tt[d]?.[i]);
    const set = (k) => (e) => { c[k] = e.target.value; (tt[d] ||= [])[i] = { ...c }; };
    return h('td.tt-cell',
      h('input', { value: c.subject, list: 'set-course-list', placeholder: '수업명', 'aria-label': `${WEEKDAYS[d]} ${label} 수업명`, oninput: set('subject') }),
      h('input', { value: c.cls, list: 'set-class-list', placeholder: '학반', 'aria-label': `${WEEKDAYS[d]} ${label} 학반`, oninput: set('cls') }),
      h('input', { value: c.room, list: 'set-room-list', placeholder: '교실', 'aria-label': `${WEEKDAYS[d]} ${label} 교실`, oninput: set('room') }));
  };
  const range = (obj, label, { onStart } = {}) => h('span.range',
    timeSelect(obj.start, (v) => { obj.start = v; if (onStart) { onStart(v); draw(); } }, `${label} 시작`), h('span.tilde', ' ~ '),
    timeSelect(obj.end, (v) => { obj.end = v; }, `${label} 끝`));

  // 좁은 화면(폴드 커버 화면, 휴대폰)에서는 요일을 하나씩 골라 편집
  const narrow = () => window.matchMedia('(max-width: 760px)').matches;
  app.ttDay ||= Math.min(5, Math.max(1, new Date().getDay() || 1));
  const days = () => (narrow() ? [app.ttDay] : [1, 2, 3, 4, 5]);
  if (!window.__ttMq) { window.__ttMq = true; window.matchMedia('(max-width: 760px)').addEventListener('change', () => { if (app.tab === 'settings') app.render(); }); }
  const draw = () => {
    const count = bell.periodCount;
    const rows = [];
    const lunchRow = () => h('tr.bell-row', h('th', '🍚 점심'), h('td.time-cell', range(bell.lunch, '점심')), h('td.muted.small', { colspan: days().length }, `${bell.lunch.after}교시 다음`));
    if (bell.lunch.after === 0) rows.push(lunchRow());
    for (let i = 0; i < count; i++) {
      const t = (bell.times[i] ||= { start: '', end: '' });
      rows.push(h('tr', h('th', `${i + 1}교시`),
        // 시작을 고르면 끝(수업 길이)과 다음 교시들이 점심 전까지/끝까지 자동으로 채워진다
        h('td.time-cell', range(t, `${i + 1}교시`, { onStart: () => cascadeFrom(bell, i + 1) })),
        days().map((d) => ttInput(d, i, `${i + 1}교시`))));
      if (bell.lunch.after === i + 1) rows.push(lunchRow());
    }
    if (bell.dinner.enabled) rows.push(h('tr.bell-row', h('th', '🍱 저녁'), h('td.time-cell', range(bell.dinner, '저녁')), h('td.muted.small', { colspan: days().length }, '저녁 식사')));
    bell.evening.forEach((ev, k) => {
      const idx = EVENING_BASE + k;
      rows.push(h('tr.evening',
        h('th', h('input', { value: ev.label, 'aria-label': `저녁 방과후 ${k + 1} 이름`, style: { width: '6.5em' }, oninput: (e) => (ev.label = e.target.value.trim() || `방과후${k + 1}`) })),
        h('td.time-cell', range(ev, ev.label, { onStart: (v) => { ev.end = addMin(v, bell.lessonLen); } })),
        days().map((d) => ttInput(d, idx, ev.label))));
    });

    const sel = (val, opts, on, label) => h('select', { 'aria-label': label, onchange: (e) => { on(+e.target.value); draw(); } }, opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));
    const num = (val, on, label, min, max) => h('input', { type: 'number', min, max, step: 5, value: val, 'aria-label': label, onchange: (e) => { on(+e.target.value); } });
    const c = bell.csat;
    fill(wrap, 
      h('div.inline-form',
        h('label', '🏫 등교', timeSelect(bell.arrival, (v) => (bell.arrival = v), '등교')),
        h('label', '정규 교시', sel(bell.periodCount, [4, 5, 6, 7, 8].map((n) => [n, `${n}교시까지`]), (v) => (bell.periodCount = v), '정규 교시 수')),
        h('label', '수업', num(bell.lessonLen, (v) => (bell.lessonLen = v), '수업 시간(분)', 20, 120), '분'),
        h('label', '쉬는 시간', num(bell.breakLen, (v) => (bell.breakLen = v), '쉬는 시간(분)', 0, 60), '분'),
        h('label', '점심', sel(bell.lunch.after, [[0, '없음'], ...Array.from({ length: bell.periodCount }, (_, i) => [i + 1, `${i + 1}교시 다음`])], (v) => (bell.lunch.after = v), '점심 위치')),
        h('label', h('input', { type: 'checkbox', checked: bell.dinner.enabled, onchange: (e) => { bell.dinner.enabled = e.target.checked; draw(); } }), '저녁 식사'),
        h('label', '저녁 방과후', sel(bell.evening.length, [0, 1, 2, 3, 4].map((n) => [n, n ? `${n}개` : '없음']), (v) => {
          while (bell.evening.length < v) bell.evening.push({ label: `방과후${bell.evening.length + 1}`, start: '', end: '' });
          bell.evening.length = v;
        }, '저녁 방과후 수'))),
      h('p.muted.small', '1교시 시작을 고르면 수업 시간에 맞춰 점심 전 교시까지, 점심 뒤 첫 교시 시작을 고르면 마지막 교시까지 자동으로 채워집니다. 끝 시각은 따로 고칠 수 있습니다.'),
      narrow() ? h('div.day-pick', h('span.small.muted', '요일'), [1, 2, 3, 4, 5].map((d) => h(`button.small${app.ttDay === d ? '.active' : ''}`, { onclick: () => { app.ttDay = d; draw(); } }, WEEKDAYS[d]))) : null,
      h('div.records-wrap', h('table.grid.timetable.bell-table',
        h('thead', h('tr', h('th', '교시'), h('th', '시간'), days().map((d) => h('th', WEEKDAYS[d])))),
        h('tbody', rows))),
      h('div.csat-box',
        h('div', h('strong', '수능대비 시간표 시각'), h('span.muted.small', ' — 교사수첩에서 날짜별로 "수능대비 시간표"를 체크한 날에만 점심이 3교시 다음으로 옮겨집니다. 비워 두면 3교시 끝 기준으로 자동 계산합니다.')),
        h('div.inline-form', { style: { marginTop: '6px' } },
          h('label', '점심', range(c.lunch, '수능대비 점심', { onStart: (v) => { c.lunch.end = addMin(v, minutes(bell.lunch.end) - minutes(bell.lunch.start) > 0 ? minutes(bell.lunch.end) - minutes(bell.lunch.start) : 50); } })),
          h('label', '4교시', range(c.p4, '수능대비 4교시', { onStart: (v) => { c.p4.end = addMin(v, bell.lessonLen); } })),
          h('button.small', { onclick: () => { const t = csatTimes({ ...bell, csat: { lunch: {}, p4: {} } }); c.lunch = t.lunch; c.p4 = t.p4; draw(); } }, '3교시 기준으로 채우기'))));
  };
  const minutes = (t) => { const m = /^(\d+):(\d+)$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : 0; };
  draw();

  const lists = h('div', { style: { display: 'none' } },
    h('datalist#set-course-list', (s.courses || []).map(courseOf).map((x) => h('option', { value: x.name }))),
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

/** 내 수업명(축약) · 교실/실습실 · 담당 학반(담임·부담임) */
function listsCard(app) {
  const { store } = app;
  const s = store.settings;
  const ta = (label, text, ph) => h('label', label, h('textarea', { rows: 6, placeholder: ph, value: text }));
  const c = ta('내 수업명 (| 뒤는 축약 이름)', (s.courses || []).map(courseOf).map((x) => (x.short ? `${x.name} | ${x.short}` : x.name)).join('\n'), '한 줄에 하나씩\n예: 정보\n인공지능 기초 | AI기초\n프로그래밍 | 프로그');
  const r = ta('교실 · 실습실', (s.rooms || []).join('\n'), '예: 컴퓨터실1\n메이커실\n1-2 교실');
  const k = ta('담당 학반', (s.classes || []).join('\n'), '예: 1-2\n1-3\n2-1');
  const lines = (el) => [...new Set(el.querySelector('textarea').value.split('\n').map((x) => x.trim()).filter(Boolean))];
  const homerooms = JSON.parse(JSON.stringify(s.homerooms || {}));
  const hrTable = h('div.records-wrap', h('table.grid',
    h('thead', h('tr', h('th', '학반'), h('th', '담임'), h('th', '부담임'))),
    h('tbody', store.classList().map((cls) => {
      const x = (homerooms[cls] ||= { main: '', sub: '' });
      return h('tr', h('th', cls),
        h('td', h('input', { value: x.main, placeholder: '담임 선생님', 'aria-label': `${cls} 담임`, oninput: (e) => (x.main = e.target.value) })),
        h('td', h('input', { value: x.sub, placeholder: '부담임 선생님', 'aria-label': `${cls} 부담임`, oninput: (e) => (x.sub = e.target.value) })));
    }))));
  // 학과 규칙
  const DEPT_EXAMPLE = '2024~2026 1~4반 뉴미디어소프트웨어과\n2024~2026 5~6반 뉴미디어디자인과\n2027~ 1~4반 지능형소프트웨어과\n2027~ 5~6반 지능형디자인과';
  const deptPreview = h('div.dept-preview.small');
  const drawDept = () => {
    const rules = parseDeptRules(deptTa.value);
    const bad = deptTa.value.split('\n').filter((l) => l.trim() && !parseDeptRules(l).length);
    fill(deptPreview, rules.length ? h('ul', rules.map((x) => h('li', `${x.from}${x.to === x.from ? '' : x.to === 9999 ? '학년도 이후' : `~${x.to}`} 입학 · ${x.c1 === x.c2 ? x.c1 : `${x.c1}~${x.c2}`}반 → `, h('strong', x.name)))) : null,
      bad.length ? h('p.error-text', `알아듣지 못한 줄: ${bad.join(' / ')}`) : null);
  };
  const cohortIn = h('input', { type: 'number', min: 1950, max: 2100, value: s.cohortBase || '', placeholder: '예: 2010', 'aria-label': '1기 입학 학년도', style: { width: '7em' } });
  const deptTa = h('textarea', { rows: 4, value: s.deptRules || '', placeholder: DEPT_EXAMPLE, 'aria-label': '학과 규칙', oninput: () => drawDept() });
  drawDept();
  return card('내 수업 · 교실 · 학반',
    h('p.muted.small', '여기 넣은 목록은 시간표와 수업일지에서 골라 쓸 수 있습니다. 수업명 뒤에 "| 축약"을 붙이면 교사수첩에 짧게 표시됩니다. 학반은 학생 명단의 학년·반에서도 자동으로 모입니다.'),
    h('div.lists-grid', c, r, k),
    h('h3', '학반별 담임 · 부담임'),
    store.classList().length ? hrTable : h('p.muted.small', '담당 학반을 넣거나 학생 명단을 등록하면 학반별로 담임·부담임을 적을 수 있습니다.'),
    h('h3', '학과 (입학 학년도 · 반별)'),
    h('p.muted.small', '한 줄에 하나씩 "입학 학년도 반 학과"로 적으면 학생의 학과를 자동으로 채웁니다. 학생마다 직접 적은 학과가 있으면 그것을 씁니다. 입학 학년도를 적지 않은 학생은 지금 학년으로 어림합니다(2학년 → 작년 입학).'),
    h('label.row', { style: { gap: '8px', alignItems: 'center' } }, h('span.small', '기수: 1기 입학 학년도'), cohortIn, h('span.muted.small', '— 예: 2010 이면 2010 입학이 1기, 2027 입학이 18기. 졸업생·학생에 "○기"로 보입니다.')),
    deptTa, h('div.row', { style: { margin: '4px 0' } }, h('button.small', { onclick: () => { deptTa.value = DEPT_EXAMPLE; drawDept(); } }, '예시대로 채우기'), h('span.muted.small', '— 채운 뒤 [목록 저장]')), deptPreview,
    h('div.row', h('button.primary', { onclick: async () => {
      const courses = lines(c).map((x) => { const [name, short] = x.split(/\s*\|\s*/); return short ? { name, short } : name; });
      const hrs = Object.fromEntries(Object.entries(homerooms).filter(([, x]) => x.main.trim() || x.sub.trim()).map(([kk, x]) => [kk, { main: x.main.trim(), sub: x.sub.trim() }]));
      store.updateSettings({ courses, rooms: lines(r), classes: lines(k), homerooms: hrs, deptRules: deptTa.value.trim(), cohortBase: +cohortIn.value || '' });
      await app.save(); app.render();
    } }, '목록 저장')));
}

/** AI 연결: Anthropic · OpenAI · Ollama 키/주소, 모델 불러오기, 테스트 */
function aiCard(app) {
  const cfg = loadAI();
  const out = h('div.result');
  const say = (m, k = 'muted') => fill(out, h(`p.${k}`, m));
  const wrap = h('div');
  const draw = () => {
    const p = cfg.provider;
    const modelSel = h('select', { 'aria-label': '모델', onchange: (e) => { cfg.models[p] = e.target.value; } },
      h('option', { value: '' }, '- 모델 선택 -'),
      [...new Set([cfg.models[p], ...(cfg.list?.[p] || [])].filter(Boolean))].map((id) => h('option', { value: id, selected: id === cfg.models[p] }, id)));
    const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { say(e.message, 'err'); } finally { btn.disabled = false; } };
    const loadBtn = h('button.small', { onclick: () => busy(loadBtn, async () => {
      say('모델 목록을 불러오는 중…');
      const list = await listModels(p, cfg);
      (cfg.list ||= {})[p] = list.map((m) => m.id);
      if (!cfg.models[p] && list.length) cfg.models[p] = list[0].id;
      draw();
      say(`모델 ${list.length}개를 불러왔습니다.`, 'ok');
    }) }, '모델 불러오기');
    const testBtn = h('button.small', { onclick: () => busy(testBtn, async () => {
      if (!cfg.models[p]) throw new Error('먼저 모델을 고르세요.');
      say('테스트 중…');
      const reply = await testAI(cfg);
      say(`연결 성공 (${cfg.models[p]}): "${reply}"`, 'ok');
    }) }, '테스트');
    fill(wrap, 
      h('div.form',
        h('label', '사용할 AI', h('select', { 'aria-label': '사용할 AI', onchange: (e) => { cfg.provider = e.target.value; draw(); fill(out); } },
          PROVIDERS.map(([v, l]) => h('option', { value: v, selected: v === p }, l)))),
        p === 'ollama'
          ? h('label', 'Ollama 주소', h('input', { value: cfg.ollamaUrl, placeholder: 'http://localhost:11434', oninput: (e) => (cfg.ollamaUrl = e.target.value.trim()) }))
          : h('label', `${p === 'anthropic' ? 'Anthropic' : 'OpenAI'} API 키`, h('input', { type: 'password', autocomplete: 'off', value: cfg.keys[p] || '', placeholder: p === 'anthropic' ? 'sk-ant-…' : 'sk-…', oninput: (e) => (cfg.keys[p] = e.target.value.trim()) })),
        h('label', '모델', h('div.row', { style: { margin: 0 } }, modelSel, loadBtn, testBtn))),
      p === 'ollama' ? h('p.muted.small', 'Ollama 를 이 컴퓨터에서 실행하고, 이 사이트에서 접근할 수 있도록 환경변수 OLLAMA_ORIGINS=https://progh2.github.io 를 설정한 뒤 다시 시작하세요. 이미지를 읽으려면 비전 모델(예: qwen2.5vl, gemma3, llava)이 필요합니다.') : null,
      p === 'anthropic' ? h('p.muted.small', '기본 추천 모델은 claude-opus-5-5 입니다. 키는 console.anthropic.com 에서 만듭니다.') : null,
      p === 'openai' ? h('p.muted.small', '이미지를 읽을 수 있는 모델(비전 지원)을 고르세요. 키는 platform.openai.com 에서 만듭니다.') : null);
  };
  draw();
  return card('AI (학사일정 자동 추출)',
    h('p.muted.small', '학사일정·주간업무계획 이미지/PDF/HWPX 를 올리면 AI 가 날짜별 일정을 뽑아 학사일정에 넣어 줍니다(반영 전 확인). 키는 이 브라우저에만 저장되며, PIN 잠금을 쓰면 암호화됩니다. 문서 내용은 고른 AI 회사로 전송되니 학생 개인정보가 담긴 문서는 올리지 마세요.'),
    wrap,
    h('div.row', h('button.primary', { onclick: () => { const { list, ...rest } = cfg; saveAI({ ...rest, list }); toast('AI 설정을 저장했습니다.', 'ok'); } }, 'AI 설정 저장')),
    out);
}

/** 이 기기 보안: PIN 잠금·암호화, 패스키, 자동 잠금, 자동 저장 */
function securityCard(app) {
  const enabled = vaultEnabled();
  const out = h('div.result');
  const say = (m, k = 'muted') => fill(out, h(`p.${k}`, m));
  const askPin = async (title) => {
    const a = h('input', { type: 'password', inputmode: 'numeric', maxlength: 6, autocomplete: 'new-password', placeholder: '숫자 6자리', 'aria-label': '새 PIN' });
    const b = h('input', { type: 'password', inputmode: 'numeric', maxlength: 6, autocomplete: 'new-password', placeholder: '한 번 더', 'aria-label': 'PIN 확인' });
    const ok = await modal(title, h('div.form', h('label', '새 PIN', a), h('label', 'PIN 확인', b),
      h('p.muted.small', 'PIN 을 잊으면 이 기기에 저장된 로그인 정보·캐시를 지우고 다시 연결해야 합니다. 로컬 저장소만 쓴다면 먼저 JSON 백업을 받아 두세요.')),
    [{ label: '취소', value: false }, { label: '설정', value: true, primary: true }]);
    if (!ok) return null;
    if (!validPin(a.value)) { toast('PIN 은 숫자 6자리여야 합니다.', 'error'); return null; }
    if (a.value !== b.value) { toast('두 PIN 이 다릅니다.', 'error'); return null; }
    return a.value;
  };
  const autolockSel = h('select', { 'aria-label': '자동 잠금', disabled: !enabled, onchange: (e) => { app.prefs.autolock = +e.target.value; toast('자동 잠금 시간을 바꿨습니다.', 'ok'); } },
    [[0, '사용 안 함'], [1, '1분'], [3, '3분'], [5, '5분'], [10, '10분'], [15, '15분'], [30, '30분'], [60, '1시간']].map(([v, l]) => h('option', { value: v, selected: app.prefs.autolock === v }, l)));
  return card('보안 · 저장 (이 기기)',
    h('p.muted.small', 'PIN 을 설정하면 이 브라우저에 남는 드롭박스 로그인 정보, 캐시된 일지, 로컬 데이터, 사진을 암호화합니다. 앱을 열 때와 자동 잠금 뒤에 PIN(또는 지문·얼굴·Windows Hello)이 필요합니다.'),
    h('p', '잠금: ', h('strong', enabled ? '사용 중 (PIN 6자리)' : '사용 안 함')),
    h('div.row',
      !enabled ? h('button.primary', { onclick: async () => {
        const pin = await askPin('PIN 설정');
        if (!pin) return;
        await setupPin(pin);
        await loadAll(); // 지금까지 평문으로 있던 정보를 암호화해서 다시 저장
        toast('PIN 을 설정하고 저장된 정보를 암호화했습니다.', 'ok');
        app.render();
      } }, 'PIN 설정') : [
        h('button', { onclick: async () => { const pin = await askPin('PIN 바꾸기'); if (!pin) return; await changePin(pin); toast('PIN 을 바꿨습니다.', 'ok'); } }, 'PIN 바꾸기'),
        h('button', { onclick: async () => {
          if (!(await confirmDialog('잠금 해제', '잠금과 암호화를 끄고 저장된 정보를 평문으로 되돌립니다. 계속할까요?', '끄기'))) return;
          await decryptAllToPlain(); removeVault(); toast('잠금을 껐습니다.', 'ok'); app.render();
        } }, '잠금 끄기'),
        h('button', { onclick: () => app.lock() }, '🔒 지금 잠그기')]),
    enabled ? h('div.row',
      hasPasskey()
        ? [h('span.ok', '✓ 지문·얼굴·Windows Hello 등록됨'), h('button.small', { onclick: () => { removePasskey(); toast('패스키를 지웠습니다.', 'ok'); app.render(); } }, '해제')]
        : h('button', { disabled: !passkeyAvailable(), onclick: async () => {
          try { await registerPasskey(); toast('등록했습니다. 다음부터 지문·얼굴·Windows Hello 로 열 수 있습니다.', 'ok'); app.render(); } catch (e) { say(e.message, 'err'); }
        } }, '🔑 지문·얼굴·Windows Hello 등록')) : null,
    h('div.inline-form', { style: { marginTop: '8px' } },
      h('label', '자동 잠금', autolockSel, h('span.muted.small', enabled ? ' 동안 쓰지 않으면 잠금' : ' (PIN 설정 후 사용)')),
      h('label', h('input', { type: 'checkbox', checked: app.prefs.autosave, onchange: (e) => { app.prefs.autosave = e.target.checked; toast(e.target.checked ? '고치면 자동으로 저장합니다.' : '저장 버튼(Ctrl+S)을 눌러야 저장됩니다.', 'ok'); } }), '자동 저장')),
    out);
}

// ---------- 정보 일괄 등록 (CSV) ----------
const TEMPLATES = {
  schedule: { name: '학사일정', file: '학사일정_예제.csv', rows: (y) => {
    const out = [['날짜', '일정', '휴업', '수능대비']];
    const { start, end } = yearRange(y);
    const d = new Date(start + 'T00:00');
    const e = new Date(end + 'T00:00');
    const sample = { [`${y}-03-02`]: ['입학식, 시업식', '', ''], [`${y}-05-04`]: ['재량휴업일', 'O', ''], [`${y}-11-05`]: ['3학년 수능대비', '', 'O'] };
    for (; d <= e; d.setDate(d.getDate() + 1)) {
      const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push([s, ...(sample[s] || ['', '', ''])]);
    }
    return out;
  } },
  students: { name: '학생정보', file: '학생정보_예제.csv', rows: () => [['학번', '학년', '반', '번호', '이름', '성별', '이메일', '전화번호', '이전학번'], ['10101', '1', '1', '1', '홍길동', '남', '', '', ''], ['10102', '1', '1', '2', '성춘향', '여', '', '', ''], ['20305', '2', '3', '5', '이몽룡', '남', '', '', '10412']] },
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
  const file = await pickFile(TABLE_ACCEPT);
  if (!file) return;
  // 학생 명단은 미리 보기 창에서 (시트 고르기·더하고 고치기/바꾸기)
  if (kind === 'students') { await openStudentImport(app, file); return; }
  const rows = (await readTable(file))[0]?.rows || [];
  const body = rows.slice(/^\d/.test(rows[0]?.[0] || '') ? 0 : 1); // 머리글 행 자동 건너뛰기
  const { store } = app;
  let msg = '';
  if (kind === 'schedule') {
    let n = 0, skipped = 0;
    const yes = (v) => /^(o|y|yes|1|예|휴업|휴일|수능대비|v|✓|true)$/i.test(String(v || '').trim());
    for (const [d, text = '', holRaw = '', csatRaw = ''] of body) {
      const hol = yes(holRaw), csat = yes(csatRaw);
      if (!text.trim() && !hol && !csat) continue;
      const date = normalizeDate(d);
      if (!date) { skipped++; continue; }
      if (schoolYearOf(date) !== store.year) { skipped++; continue; }
      let ex = store.work.schedule.find((x) => x.date === date);
      if (!ex) { ex = { id: newId(), date, text: '' }; store.work.schedule.push(ex); }
      ex.text = text.trim() || ex.text || (hol ? '휴업일' : '');
      if (hol) ex.holiday = true;
      if (csat) ex.csat = true;
      n++;
    }
    store.markDirty();
    msg = (`학사일정 ${n}건 등록${skipped ? ` (${skipped}건 건너뜀: 날짜 형식 오류 또는 다른 학년도)` : ''}`);
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
    h('table.grid.bulk-table', h('tbody', Object.entries(TEMPLATES).map(([k, t]) => h('tr',
      h('th', t.name),
      h('td', h('button.small', { onclick: () => downloadBlob(xlsxBlob([{ name: t.name, rows: t.rows(app.store.year) }]), t.file.replace(/\.csv$/, '.xlsx')) }, '예제 엑셀 받기')),
      h('td', h('button.small.primary', { onclick: () => importCSV(app, k).catch((e) => toast(e.message, 'error')) }, '엑셀·CSV 올리기')))))));
}

function backupCard(app) {
  return card('백업 / 복원',
    h('p.muted.small', `현재 ${app.store.year}학년도 자료를 JSON 파일로 백업하거나, 백업 파일을 현재 저장소에 복원합니다.`),
    h('div.row',
      h('button', { onclick: () => {
        const data = { app: 'nanalnote', version: 1, year: app.store.year, exportedAt: new Date().toISOString(), data: app.store.base };
        downloadBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `나날노트_백업_${app.store.year}.json`);
      } }, 'JSON 백업 받기'),
      h('button', { onclick: async () => {
        const f = await pickFile('.json,application/json');
        if (!f) return;
        try {
          const j = JSON.parse(await readTextFile(f));
          if (!['nanalnote', 'sammynote-web'].includes(j.app) || !j.data) throw new Error('나날노트 백업 파일이 아닙니다.');
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
  const grid = h('div.settings',
    h('div.col', storageCard(app), securityCard(app), aiCard(app), yearCard(app)),
    h('div.col', displayCard(app), listsCard(app), bulkCard(app), backupCard(app)),
    h('div.full', timetableCard(app)));
  // 휴대폰·태블릿: 카드가 길게 이어지므로 위에 바로가기 단추
  const cards = [...grid.querySelectorAll('section.card')].filter((c) => c.querySelector('h2'));
  const nav = h('nav.settings-nav', { 'aria-label': '설정 바로가기' }, cards.map((c) => h('button.small', {
    onclick: () => {
      const top = c.getBoundingClientRect().top + window.scrollY - (document.getElementById('header')?.offsetHeight || 0) - 8;
      window.scrollTo({ top, behavior: 'smooth' });
    },
  }, c.querySelector('h2').textContent.trim())));
  return h('div', nav, grid);
}
