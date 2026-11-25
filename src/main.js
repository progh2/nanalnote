import './styles/base.css';
import './styles/themes.css';
import { Store } from './store.js';
import { LocalBackend } from './backends/local.js';
import { DropboxBackend, completeLogin } from './backends/dropbox.js';
import { FolderBackend } from './backends/folder.js';
import { isDesktop, appPaths, installDesktopHooks, PORTABLE_FOLDER } from './lib/desktop.js';
import { h, today, schoolYearOf, addDays, toast, modal, koDate, weekdayOf, WEEKDAYS, debounce, fill } from './lib/util.js';
import * as holidays from './lib/holidays.js';
import { vaultEnabled, lockNow } from './lib/vault.js';
import { sget, sset, loadAll, flush, memClear } from './lib/securestore.js';
import { renderNotebook } from './views/notebook.js';
import { renderStudents } from './views/students.js';
import { renderReports } from './views/reports.js';
import { renderSettings } from './views/settings.js';
import { renderSchedule, renderContacts } from './views/schedule.js';
import { renderTags } from './views/tags.js';
import { renderPeople } from './views/people.js';
import { openSearch } from './views/search.js';
import { imageFromTransfer } from './lib/photos.js';
import { renderContests } from './views/contests.js';
import { renderAbout } from './views/about.js';
import { APP_NAME, APP_SUB } from './brand.js';
import { renderNotes, addNote } from './views/notes.js';
import { showLockScreen } from './views/lock.js';
import { THEMES } from './themes.js';

const CONFIG_KEY = 'sn:config';
const loadConfig = () => { try { return JSON.parse(sget(CONFIG_KEY) || '{}'); } catch { return {}; } };

function makeBackend(cfg) {
  if (cfg.backend === 'dropbox') return new DropboxBackend();
  if (cfg.backend === 'folder') return new FolderBackend({ folder: cfg.folder });
  return new LocalBackend();
}

// 이 기기 설정 (민감하지 않음)
export const prefs = {
  get autosave() { return localStorage.getItem('sn:autosave') !== '0'; },
  set autosave(v) { localStorage.setItem('sn:autosave', v ? '1' : '0'); },
  get autolock() { return +(localStorage.getItem('sn:autolock') ?? 10); }, // 분, 0 = 끔
  get fontScale() { return +(localStorage.getItem('sn:font') || 1.12); }, // 1 보통, 1.12 크게, 1.25 아주 크게
  set fontScale(v) { localStorage.setItem('sn:font', String(v)); document.documentElement.style.setProperty('--fs', String(v)); },
  set autolock(v) { localStorage.setItem('sn:autolock', String(v)); },
};

const app = {
  config: {},
  store: null,
  date: today(),
  tab: 'notebook',
  reportTab: 'calendar',
  selectedStudent: null,
  error: null,
  prefs,

  saveConfig(patch) {
    this.config = { ...this.config, ...patch };
    sset(CONFIG_KEY, JSON.stringify(this.config));
  },

  get theme() { return localStorage.getItem('sn:theme') || 'light'; },
  setTheme(t) { localStorage.setItem('sn:theme', t); document.documentElement.dataset.theme = t; },

  holidayFetcher() { return this.store.backend.holidayFetcher(); },
  specials(date) { return holidays.getDay(date, this.holidayFetcher()); },
  monthSpecials(y, m) { return holidays.getMonth(y, m, this.holidayFetcher()); },

  /** 다른 날짜·화면으로 가기 전에: 자동 저장이면 바로 저장, 아니면 물어본다. 진행해도 되면 true */
  async confirmLeave() {
    if (!this.store.dirty) return true;
    if (prefs.autosave) { const r = await this.save({ silent: true }); return r.ok || r.busy; }
    const v = await modal('저장하지 않은 내용', h('p', '수정한 내용이 저장되지 않았습니다. 저장할까요?'), [
      { label: '취소', value: 'cancel' }, { label: '저장 안 함', value: 'discard' }, { label: '저장', value: 'save', primary: true },
    ]);
    if (v === 'save') return (await this.save()).ok;
    if (v === 'discard') { this.store.discard(); return true; }
    return false;
  },

  async setDate(date, { force = false } = {}) {
    if (!date || date === this.date) return;
    if (!force && !(await this.confirmLeave())) { this.render(); return; }
    const y = schoolYearOf(date);
    this.date = date;
    if (y !== this.store.year) await this.loadYear(y);
    else this.render();
  },

  async go(tab) {
    if (this.store.dirty && prefs.autosave) await this.save({ silent: true });
    this.tab = tab;
    this.render();
  },

  async loadYear(year) {
    this.loading = true;
    this.renderHeader();
    try {
      await this.store.load(year);
      this.error = null;
    } catch (e) {
      this.error = e.message;
      this.store.year = year;
    } finally {
      this.loading = false;
    }
    this.render();
  },

  /**
   * 저장. silent: 자동 저장(화면을 다시 그리지 않고, 성공 알림도 띄우지 않음 — 입력 중인 칸이 끊기지 않게)
   */
  async save({ silent = false } = {}) {
    if (this.store.saving) { this.pendingSave = true; return { ok: false, busy: true }; }
    const r = await this.store.save(this.tab === 'notebook' ? [this.date] : []);
    if (!r.ok && !r.busy) toast(`저장 실패: ${r.error}`, 'error');
    else if (!silent) toast(r.count ? '저장했습니다.' : '변경된 내용이 없습니다.', 'ok');
    if (!silent) this.render();
    else this.renderHeader();
    if (this.pendingSave) { this.pendingSave = false; if (this.store.dirty) this.scheduleAutosave(); }
    return r;
  },

  scheduleAutosave: debounce(() => {
    if (!prefs.autosave || !app.store?.dirty || app.locking) return;
    app.save({ silent: true });
  }, 1200),

  async switchBackend(cfg) {
    if (!(await this.confirmLeave())) return;
    this.saveConfig(cfg);
    this.store.setBackend(makeBackend(this.config));
    await this.loadYear(schoolYearOf(this.date));
  },

  /** 지금 잠그기: 저장 → 암호화 쓰기 마무리 → 메모리 지우고 새로고침(잠금 화면) */
  async lock() {
    if (!vaultEnabled() || this.locking) return;
    this.locking = true;
    try { if (this.store?.dirty) await this.store.save(this.tab === 'notebook' ? [this.date] : []); } catch { /* 잠금은 계속 */ }
    await flush();
    memClear();
    lockNow();
    location.reload();
  },

  renderHeader() {
    const el = document.getElementById('header');
    if (!el || !this.store) return;
    const s = this.store;
    const status = this.loading ? '불러오는 중…' : s.saving ? '저장 중…' : s.dirty ? (prefs.autosave ? '저장 대기' : '저장 안 됨') : '저장됨';
    const tabs = [['notebook', '교사수첩'], ['schedule', '학사일정'], ['contacts', '연락'], ['tags', '태그'], ['students', '학생관리'], ['people', '사람·기관'], ['contests', '대회·활동'], ['reports', '보고서'], ['settings', '설정'], ['about', '소개']];
    // 요일: 일요일·공휴일·학교 휴업일은 빨강, 토요일은 파랑
    const wd = weekdayOf(this.date);
    const wdEl = h(`span.wd${wd === 0 ? '.sun' : wd === 6 ? '.sat' : ''}`, `(${WEEKDAYS[wd]})`);
    if (s.year && s.isSchoolHoliday(this.date)) wdEl.classList.add('sun');
    this.specials(this.date).then((list) => { if (list.some((x) => x.holiday)) wdEl.classList.add('sun'); }).catch(() => {});
    fill(el, 
      h('div.brand',
        h('span.logo', '✎'),
        h('div', h('strong', APP_NAME), APP_SUB ? h('small', ` ${APP_SUB}`) : null),
        h('span.teacher-info', s.year ? (s.settings.teacherInfo || '') : '')),
      h('div.date-nav',
        h('button.icon-btn', { title: '이전 날 (Alt+←)', onclick: () => this.setDate(addDays(this.date, -1)) }, '◀'),
        h('input', { type: 'date', value: this.date, 'aria-label': '날짜', onchange: (e) => this.setDate(e.target.value) }),
        wdEl,
        h('button.icon-btn', { title: '다음 날 (Alt+→)', onclick: () => this.setDate(addDays(this.date, 1)) }, '▶'),
        h('button.ghost', { onclick: () => this.setDate(today()) }, '오늘'),
        h('span.badge', s.year ? `${s.year}학년도` : '')),
      h('div.head-right',
        h('span.badge.backend', { title: s.backend.label }, { dropbox: 'Dropbox', folder: '폴더' }[s.backend.name] || '로컬'),
        h(`span.status${s.dirty ? '.dirty' : ''}`, status),
        h('button.icon-btn', { title: '전체 검색 (Ctrl+K)', 'aria-label': '전체 검색', onclick: () => openSearch(this) }, '🔍'),
        h('button.icon-btn', { title: '포스트잇 추가', onclick: () => addNote(this) }, '🗒'),
        vaultEnabled() ? h('button.icon-btn', { title: '지금 잠그기', onclick: () => this.lock() }, '🔒') : null,
        h('select.theme-pick', { title: '테마', onchange: (e) => this.setTheme(e.target.value) },
          THEMES.map(([v, l]) => h('option', { value: v, selected: v === this.theme }, l))),
        h('button.primary', { onclick: () => this.save(), disabled: s.saving, title: 'Ctrl+S' }, '저장')),
      h('nav.tabs', tabs.map(([k, l]) => h(`button${this.tab === k ? '.active' : ''}`, { onclick: () => this.go(k) }, l))),
    );
    // 좁은 화면에서 지금 탭이 보이게 가로로 밀어 둔다
    const act = el.querySelector('nav.tabs button.active');
    if (act) { const nav = act.parentElement; if (act.offsetLeft < nav.scrollLeft || act.offsetLeft + act.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = act.offsetLeft - (nav.clientWidth - act.offsetWidth) / 2; }
  },

  render() {
    this.renderHeader();
    watchHeader();
    const main = document.getElementById('main');
    if (!main) return;
    let view;
    if (this.loading) view = h('div.empty', '불러오는 중…');
    else if (this.error && this.tab !== 'settings') {
      view = h('div.card.error-card',
        h('h3', '데이터를 불러오지 못했습니다'),
        h('p', this.error),
        h('div.row', h('button.primary', { onclick: () => this.loadYear(schoolYearOf(this.date)) }, '다시 시도'),
          h('button', { onclick: () => this.go('settings') }, '설정으로 이동')));
    } else {
      this.pasteImage = null; // 사진 칸이 있는 화면이 다시 걸어 둔다
      const views = { notebook: renderNotebook, schedule: renderSchedule, contacts: renderContacts, tags: renderTags, students: renderStudents, people: renderPeople, contests: renderContests, reports: renderReports, settings: renderSettings, about: renderAbout };
      view = views[this.tab](this);
    }
    // 다시 그려도 커서를 잃지 않게: data-keep 이 붙은 칸(검색칸 등)에 있던 포커스·커서 위치를 새 칸으로 옮긴다
    const act = document.activeElement;
    const keep = act?.dataset?.keep && main.contains(act) ? { key: act.dataset.keep, a: act.selectionStart, b: act.selectionEnd } : null;
    // 목록 스크롤 위치도 지킨다 (사람·학생을 하나씩 눌러 볼 때 목록이 맨 위로 돌아가지 않게)
    const scrolls = [...main.querySelectorAll('[data-scroll-key]')].map((el) => [el.dataset.scrollKey, el.scrollTop]).filter(([, y]) => y > 0);
    fill(main, view);
    for (const [k, y] of scrolls) { const el = main.querySelector(`[data-scroll-key="${k}"]`); if (el) el.scrollTop = y; }
    if (keep) {
      const el = main.querySelector(`[data-keep="${keep.key}"]`);
      if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(keep.a, keep.b); } catch { /* 커서를 둘 수 없는 칸 */ } }
    }
    renderNotes(this);
    document.title = `${APP_NAME} · ${koDate(this.date)}`;
  },
};

/** 머리줄 높이를 CSS 변수(--head-h)로: 넓은 화면의 왼쪽 목록 고정 위치 등에 쓴다 */
let headObs = null;
function watchHeader() {
  const el = document.getElementById('header');
  if (!el || headObs) return;
  const set = () => document.documentElement.style.setProperty('--head-h', `${el.offsetHeight}px`);
  headObs = new ResizeObserver(set);
  headObs.observe(el);
  set();
}

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (!e.repeat) app.save(); // 꾹 누르고 있어도 한 번만 저장
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (app.store?.year && !document.querySelector('.lock-screen')) openSearch(app);
  } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, textarea, select, [contenteditable]')) {
    // 글 쓰는 칸 밖에서 / 를 누르면 검색
    if (app.store?.year && !document.querySelector('.lock-screen, .modal-overlay')) { e.preventDefault(); openSearch(app); }
  } else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); app.setDate(addDays(app.date, -1)); }
  else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); app.setDate(addDays(app.date, 1)); }
});

// 사진 붙여넣기: 학생·사람 화면에서 글 쓰는 칸이 아닌 곳에서 Ctrl+V 하면 지금 보고 있는 학생·사람의 사진으로
document.addEventListener('paste', (e) => {
  if (!app.pasteImage || e.defaultPrevented) return;
  if (e.target.closest?.('input, textarea, [contenteditable], .sheet')) return;
  const f = imageFromTransfer(e.clipboardData);
  if (f) { e.preventDefault(); app.pasteImage(f); }
});

window.addEventListener('beforeunload', (e) => {
  if (app.store?.dirty && !app.locking) {
    if (prefs.autosave) app.save({ silent: true });
    e.preventDefault(); e.returnValue = '';
  }
});

// ---------- 자동 잠금: 설정한 시간 동안 쓰지 않으면 잠금 ----------
let lastActive = Date.now();
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true });
function checkIdle() {
  const min = prefs.autolock;
  if (vaultEnabled() && min > 0 && Date.now() - lastActive > min * 60000) app.lock();
}
setInterval(checkIdle, 15000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkIdle(); });

async function start() {
  app.setTheme(app.theme);
  document.documentElement.style.setProperty('--fs', String(prefs.fontScale));
  // 잠금이 켜져 있으면 먼저 PIN/패스키로 열기
  if (vaultEnabled()) {
    await showLockScreen(document.getElementById('app'));
    await loadAll();
    lastActive = Date.now();
  }
  app.config = loadConfig();
  // 노션 저장소는 더 이상 지원하지 않는다 → 이 브라우저(로컬)로
  if (app.config.backend === 'notion') { const { url, key, ...rest } = app.config; app.config = rest; app.saveConfig({ backend: 'local' }); app.notionRemoved = true; }
  // 데스크톱 앱: 처음에는 "이 컴퓨터 폴더" 저장소 (포터블은 USB 안 나날노트자료 폴더)
  if (isDesktop()) {
    installDesktopHooks();
    const p = await appPaths().catch(() => null);
    if (p && !app.config.backend) app.saveConfig({ backend: 'folder', folder: p.portable ? PORTABLE_FOLDER : p.default_data_dir });
    if (p?.portable && app.config.backend === 'folder' && app.config.folder !== PORTABLE_FOLDER && !app.config.folderChosen) app.saveConfig({ folder: PORTABLE_FOLDER });
    app.desktop = p;
  }
  document.getElementById('app').replaceChildren(h('header#header'), h('main#main'), h('div#notes'));
  // 드롭박스 로그인 후 돌아온 경우 (?code=...)
  let loginMsg = null;
  try {
    if (await completeLogin()) { app.saveConfig({ backend: 'dropbox' }); loginMsg = ['드롭박스에 연결했습니다. 이제 드롭박스 Apps 폴더에 마크다운으로 저장됩니다.', 'ok']; app.tab = 'settings'; }
  } catch (e) { loginMsg = [e.message, 'error']; app.tab = 'settings'; }
  app.store = new Store(makeBackend(app.config));
  app.store.on((type) => {
    if (type === 'change') app.scheduleAutosave();
    else app.renderHeader();
  });
  await app.loadYear(schoolYearOf(app.date));
  if (loginMsg) toast(...loginMsg);
  if (app.notionRemoved) toast('노션 저장소 기능이 없어져 "이 브라우저(로컬)" 저장소로 바꿨습니다. 설정 > 저장소에서 드롭박스를 고를 수 있어요.', 'error');
  // 원본처럼 실행할 때마다 이번 달 특일정보를 새로 받아온다 (API 사용 시)
  const f = app.holidayFetcher();
  if (f) {
    const [y, m] = app.date.split('-').map(Number);
    holidays.getMonth(y, m, f, { refresh: true }).then(() => app.tab === 'notebook' && !app.store.dirty && app.render()).catch(() => {});
  }
}

start();
window.sammy = app; // 디버깅용
