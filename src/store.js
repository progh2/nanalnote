// 앱 상태 저장소: 학년도 단위로 데이터를 불러오고, 저장 시 변경분(diff)만 백엔드에 반영한다.
// 원본 쌔미노트처럼 "저장" 버튼(Ctrl+S)을 눌렀을 때만 변경 내용이 반영된다.

import { clone, newId, isTempId } from './lib/util.js';
import { splitParagraphs, mentionedStudents } from './lib/counsel.js';

export const COLLECTIONS = ['settings', 'students', 'schedule', 'days', 'lessons', 'tasks', 'attendance', 'counsel', 'records'];

export const DEFAULT_SETTINGS = {
  teacherInfo: '',
  schoolLevel: 'elem', // elem | secondary
  showModified: true,
  timetable: { 1: [], 2: [], 3: [], 4: [], 5: [] }, // 요일(1=월) -> 교시별 과목/교실
};

export const ATT_TYPES = ['결석', '지각', '조퇴', '결과'];
export const ATT_REASONS = ['질병', '미인정', '기타', '출석인정'];

const emptyData = () => Object.fromEntries(COLLECTIONS.map((c) => [c, []]));

export class Store {
  constructor(backend) {
    this.backend = backend;
    this.year = null;
    this.base = emptyData();
    this.work = emptyData();
    this.counselDraft = {}; // date -> text (저장 전 편집 중인 상담일지)
    this.dirty = false;
    this.saving = false;
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type) { for (const fn of this.listeners) fn(type); }

  setBackend(backend) { this.backend = backend; this.year = null; }

  async load(year) {
    const data = await this.backend.loadYear(year);
    const full = emptyData();
    for (const c of COLLECTIONS) full[c] = Array.isArray(data?.[c]) ? data[c] : [];
    this.year = year;
    this.base = full;
    this.work = clone(full);
    this.counselDraft = {};
    this.dirty = false;
    this.emit('load');
  }

  markDirty() {
    if (!this.dirty) { this.dirty = true; this.emit('dirty'); }
  }

  discard() {
    this.work = clone(this.base);
    this.counselDraft = {};
    this.dirty = false;
    this.emit('load');
  }

  // ---------- 조회 도우미 ----------
  get settings() {
    const s = this.work.settings.find((x) => x.key === 'main');
    return { ...DEFAULT_SETTINGS, ...(s?.value || {}), timetable: { ...DEFAULT_SETTINGS.timetable, ...(s?.value?.timetable || {}) } };
  }

  updateSettings(patch) {
    let s = this.work.settings.find((x) => x.key === 'main');
    if (!s) { s = { id: newId(), key: 'main', value: {} }; this.work.settings.push(s); }
    s.value = { ...this.settings, ...patch };
    this.markDirty();
  }

  get periods() { return this.settings.schoolLevel === 'secondary' ? 8 : 6; }

  studentNames() {
    return [...this.work.students].sort((a, b) => (a.no ?? 0) - (b.no ?? 0)).map((s) => s.name);
  }

  scheduleText(date) { return this.work.schedule.find((x) => x.date === date)?.text || ''; }

  setScheduleText(date, text) {
    const s = this.work.schedule.find((x) => x.date === date);
    if (s) s.text = text;
    else if (text.trim()) this.work.schedule.push({ id: newId(), date, text });
    this.markDirty();
  }

  day(date) { return this.work.days.find((x) => x.date === date); }

  /** 해당 날짜에 보일 업무일지: 작성일 <= 날짜 && (미완료 || 완료일 >= 날짜) */
  visibleTasks(date) {
    return this.work.tasks.filter((t) => t.created <= date && (!t.doneDate || t.doneDate >= date))
      .sort((a, b) => (a.created + a.id).localeCompare(b.created + b.id));
  }

  visibleRecords(date) {
    return this.work.records.filter((r) => r.created <= date && (!r.doneDate || r.doneDate >= date))
      .sort((a, b) => (a.created + a.id).localeCompare(b.created + b.id));
  }

  /** 교시별 수업일지 (저장된 값 > 기본 시간표) */
  lessonsFor(date, weekday) {
    const tt = this.settings.timetable[weekday] || [];
    const out = [];
    for (let p = 1; p <= this.periods; p++) {
      const saved = this.work.lessons.find((l) => l.date === date && l.period === p);
      out.push(saved || { id: null, date, period: p, subject: tt[p - 1] || '', content: '' });
    }
    return out;
  }

  setLesson(date, period, patch) {
    let l = this.work.lessons.find((x) => x.date === date && x.period === period);
    if (!l) {
      const weekday = new Date(date + 'T00:00').getDay();
      l = { id: newId(), date, period, subject: this.settings.timetable[weekday]?.[period - 1] || '', content: '' };
      this.work.lessons.push(l);
    }
    Object.assign(l, patch);
    this.markDirty();
  }

  counselText(date) {
    if (date in this.counselDraft) return this.counselDraft[date];
    return this.work.counsel.filter((c) => c.date === date).sort((a, b) => a.order - b.order).map((c) => c.text).join('\n\n');
  }

  setCounselText(date, text) { this.counselDraft[date] = text; this.markDirty(); }

  /** 학생 한 명에 대한 상담 일지 모음 (저장되지 않은 초안 포함) */
  counselFor(name) {
    const names = this.studentNames();
    const out = [];
    const draftDates = new Set(Object.keys(this.counselDraft));
    for (const c of this.work.counsel) if (!draftDates.has(c.date) && (c.students || []).includes(name)) out.push(c);
    for (const d of draftDates) {
      splitParagraphs(this.counselDraft[d]).forEach((text, i) => {
        if (mentionedStudents(text, names).includes(name)) out.push({ date: d, order: i, text });
      });
    }
    return out.sort((a, b) => (a.date + a.order).localeCompare(b.date + b.order));
  }

  // ---------- 저장 ----------
  /** 상담일지 초안을 단락 단위 레코드로 변환 */
  applyCounselDrafts() {
    const names = this.studentNames();
    for (const [date, text] of Object.entries(this.counselDraft)) {
      const paras = splitParagraphs(text);
      const existing = this.work.counsel.filter((c) => c.date === date).sort((a, b) => a.order - b.order);
      paras.forEach((p, i) => {
        const students = mentionedStudents(p, names);
        if (existing[i]) Object.assign(existing[i], { order: i, text: p, students });
        else this.work.counsel.push({ id: newId(), date, order: i, text: p, students });
      });
      const remove = new Set(existing.slice(paras.length).map((c) => c.id));
      this.work.counsel = this.work.counsel.filter((c) => !remove.has(c.id));
    }
    this.counselDraft = {};
  }

  /** 의미 없는 빈 레코드 정리 및 요록 제목 자동 채번 */
  normalize() {
    const w = this.work;
    const tt = this.settings.timetable;
    w.tasks = w.tasks.filter((t) => (t.text || '').trim());
    w.attendance = w.attendance.filter((a) => a.student);
    // 제목도 내용도 없는 요록은 삭제, 내용만 있으면 날짜+순번으로 제목 채번
    w.records = w.records.filter((r) => (r.title || '').trim() || Object.values(r.entries || {}).some((v) => String(v).trim()));
    for (const r of w.records) {
      if (!(r.title || '').trim()) {
        const prefix = r.created.replace(/-/g, '');
        let n = 1;
        while (w.records.some((x) => x.title === `${prefix}-${n}`)) n++;
        r.title = `${prefix}-${n}`;
      }
    }
    // 내용이 비어 있는 학사일정/수업일지는 저장하지 않음(기존 항목은 삭제)
    w.schedule = w.schedule.filter((s) => (s.text || '').trim());
    w.lessons = w.lessons.filter((l) => {
      const def = tt[new Date(l.date + 'T00:00').getDay()]?.[l.period - 1] || '';
      return (l.content || '').trim() || (l.subject || '') !== def;
    });
  }

  diff() {
    const ops = [];
    for (const col of COLLECTIONS) {
      const baseMap = new Map(this.base[col].map((x) => [x.id, x]));
      const workIds = new Set();
      for (const item of this.work[col]) {
        workIds.add(item.id);
        const b = baseMap.get(item.id);
        if (!b || JSON.stringify(b) !== JSON.stringify(item)) ops.push({ op: 'upsert', col, item: clone(item) });
      }
      for (const b of this.base[col]) if (!workIds.has(b.id) && !isTempId(b.id)) ops.push({ op: 'delete', col, id: b.id });
    }
    return ops;
  }

  /** @param touchDates 최종수정일시를 갱신할 날짜(현재 교사수첩 날짜) */
  async save(touchDates = []) {
    if (this.saving) return { ok: false, busy: true };
    this.saving = true;
    this.emit('saving');
    try {
      const draftDates = Object.keys(this.counselDraft);
      this.applyCounselDrafts();
      this.normalize();
      let ops = this.diff();
      if (!ops.length) { this.dirty = false; this.emit('saved'); return { ok: true, count: 0 }; }
      const now = new Date().toISOString();
      for (const date of new Set([...touchDates, ...draftDates])) {
        let d = this.day(date);
        if (!d) { d = { id: newId(), date }; this.work.days.push(d); }
        d.updatedAt = now;
      }
      ops = this.diff();

      const results = await this.backend.applyOps(this.year, ops);
      let failed = 0;
      results.forEach((r, i) => {
        const op = ops[i];
        if (!r?.ok) { failed++; return; }
        if (op.op === 'delete') {
          this.base[op.col] = this.base[op.col].filter((x) => x.id !== op.id);
          return;
        }
        const newIdVal = r.id || op.item.id;
        if (newIdVal !== op.item.id) {
          const w = this.work[op.col].find((x) => x.id === op.item.id);
          if (w) w.id = newIdVal;
        }
        const saved = { ...op.item, id: newIdVal };
        const idx = this.base[op.col].findIndex((x) => x.id === newIdVal);
        if (idx >= 0) this.base[op.col][idx] = saved; else this.base[op.col].push(saved);
      });
      this.dirty = failed > 0;
      this.emit('saved');
      if (failed) {
        const err = results.find((r) => !r?.ok)?.error || '알 수 없는 오류';
        return { ok: false, failed, error: err };
      }
      return { ok: true, count: ops.length };
    } finally {
      this.saving = false;
      this.emit('idle');
    }
  }
}
