import './styles/base.css';
import './styles/themes.css';
import { Store } from './store.js';
import { LocalBackend } from './backends/local.js';
import { NotionBackend } from './backends/notion.js';
import { DropboxBackend, completeLogin } from './backends/dropbox.js';
import { h, today, schoolYearOf, addDays, toast, modal, koDate } from './lib/util.js';
import * as holidays from './lib/holidays.js';
import { renderNotebook } from './views/notebook.js';
import { renderStudents } from './views/students.js';
import { renderReports } from './views/reports.js';
import { renderSettings } from './views/settings.js';
import { THEMES } from './themes.js';


const CONFIG_KEY = 'sn:config';
const loadConfig = () => { try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch { return {}; } };

function makeBackend(cfg) {
  if (cfg.backend === 'notion') return new NotionBackend({ url: cfg.url, key: cfg.key });
  if (cfg.backend === 'dropbox') return new DropboxBackend();
  return new LocalBackend();
}

const app = {
  config: loadConfig(),
  store: null,
  date: today(),
  tab: 'notebook',
  reportTab: 'calendar',
  selectedStudent: null,
  error: null,

  saveConfig(patch) {
    this.config = { ...this.config, ...patch };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
  },

  get theme() { return localStorage.getItem('sn:theme') || 'light'; },
  setTheme(t) { localStorage.setItem('sn:theme', t); document.documentElement.dataset.theme = t; },

  holidayFetcher() { return this.store.backend.holidayFetcher(); },
  specials(date) { return holidays.getDay(date, this.holidayFetcher()); },
  monthSpecials(y, m) { return holidays.getMonth(y, m, this.holidayFetcher()); },

  /** 저장 안 된 내용이 있으면 물어본다. 진행해도 되면 true */
  async confirmLeave() {
    if (!this.store.dirty) return true;
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

  async save() {
    const r = await this.store.save(this.tab === 'notebook' ? [this.date] : []);
    if (r.busy) return r;
    if (r.ok) toast(r.count ? '저장했습니다.' : '변경된 내용이 없습니다.', 'ok');
    else toast(`일부 저장 실패: ${r.error}`, 'error');
    this.render();
    return r;
  },

  async switchBackend(cfg) {
    if (!(await this.confirmLeave())) return;
    this.saveConfig(cfg);
    this.store.setBackend(makeBackend(this.config));
    await this.loadYear(schoolYearOf(this.date));
  },

  renderHeader() {
    const el = document.getElementById('header');
    if (!el || !this.store) return;
    const s = this.store;
    const status = this.loading ? '불러오는 중…' : s.saving ? '저장 중…' : s.dirty ? '저장 안 됨' : '저장됨';
    const tabs = [['notebook', '교사수첩'], ['students', '학생관리'], ['reports', '보고서'], ['settings', '설정']];
    el.replaceChildren(
      h('div.brand',
        h('span.logo', '✎'),
        h('div', h('strong', '쌔미노트'), h('small', ' Web')),
        h('span.teacher-info', s.year ? (s.settings.teacherInfo || '') : '')),
      h('div.date-nav',
        h('button.icon-btn', { title: '이전 날 (Alt+←)', onclick: () => this.setDate(addDays(this.date, -1)) }, '◀'),
        h('input', { type: 'date', value: this.date, onchange: (e) => this.setDate(e.target.value) }),
        h('button.icon-btn', { title: '다음 날 (Alt+→)', onclick: () => this.setDate(addDays(this.date, 1)) }, '▶'),
        h('button.ghost', { onclick: () => this.setDate(today()) }, '오늘'),
        h('span.badge', s.year ? `${s.year}학년도` : '')),
      h('div.head-right',
        h('span.badge.backend', { title: s.backend.label }, { notion: 'Notion', dropbox: 'Dropbox' }[s.backend.name] || '로컬'),
        h(`span.status${s.dirty ? '.dirty' : ''}`, status),
        h('select.theme-pick', { title: '테마', onchange: (e) => this.setTheme(e.target.value) },
          THEMES.map(([v, l]) => h('option', { value: v, selected: v === this.theme }, l))),
        h('button.primary', { onclick: () => this.save(), disabled: s.saving, title: 'Ctrl+S' }, '저장')),
      h('nav.tabs', tabs.map(([k, l]) => h(`button${this.tab === k ? '.active' : ''}`, { onclick: () => this.go(k) }, l))),
    );
  },

  render() {
    this.renderHeader();
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
      const views = { notebook: renderNotebook, students: renderStudents, reports: renderReports, settings: renderSettings };
      view = views[this.tab](this);
    }
    main.replaceChildren(view);
    document.title = `쌔미노트 · ${koDate(this.date)}`;
  },
};

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (!e.repeat) app.save(); // 꾹 누르고 있어도 한 번만 저장
  } else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); app.setDate(addDays(app.date, -1)); }
  else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); app.setDate(addDays(app.date, 1)); }
});

window.addEventListener('beforeunload', (e) => {
  if (app.store?.dirty) { e.preventDefault(); e.returnValue = ''; }
});

async function start() {
  app.setTheme(app.theme);
  document.getElementById('app').replaceChildren(h('header#header'), h('main#main'));
  // 드롭박스 로그인 후 돌아온 경우 (?code=...)
  let loginMsg = null;
  try {
    if (await completeLogin()) { app.saveConfig({ backend: 'dropbox' }); loginMsg = ['드롭박스에 연결했습니다. 이제 드롭박스 Apps 폴더에 마크다운으로 저장됩니다.', 'ok']; app.tab = 'settings'; }
  } catch (e) { loginMsg = [e.message, 'error']; app.tab = 'settings'; }
  app.store = new Store(makeBackend(app.config));
  app.store.on(() => app.renderHeader());
  await app.loadYear(schoolYearOf(app.date));
  if (loginMsg) toast(...loginMsg);
  // 원본처럼 실행할 때마다 이번 달 특일정보를 새로 받아온다 (API 사용 시)
  const f = app.holidayFetcher();
  if (f) {
    const [y, m] = app.date.split('-').map(Number);
    holidays.getMonth(y, m, f, { refresh: true }).then(() => app.tab === 'notebook' && !app.store.dirty && app.render()).catch(() => {});
  }
}

start();
window.sammy = app; // 디버깅용
