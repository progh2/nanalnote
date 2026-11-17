// 앱 상태 저장소: 학년도 단위로 데이터를 불러오고, 저장 시 변경분(diff)만 백엔드에 반영한다.
// 저장 버튼(Ctrl+S) 또는 자동 저장 때 변경분만 보낸다. 입력 중인 빈 항목은 화면에 남겨 두고 저장에서만 뺀다.

import { clone, newId, isTempId } from './lib/util.js';
import { splitParagraphs } from './lib/counsel.js';
import { normStudent, sortStudents, buildIndex, toUid, labelOf, mentionedUids, classKeys, newUid } from './lib/students.js';
import { bellOf, periodList, periodLabel } from './lib/bell.js';

export const COLLECTIONS = ['settings', 'students', 'schedule', 'days', 'lessons', 'tasks', 'attendance', 'counsel', 'records', 'trips', 'notes', 'docs'];

export const DEFAULT_SETTINGS = {
  teacherInfo: '',
  schoolLevel: 'elem', // elem | secondary
  showModified: true,
  timetable: { 1: [], 2: [], 3: [], 4: [], 5: [] }, // 요일(1=월) -> 교시별 칸 (문자열=과목, 또는 { subject, cls, room })
  courses: [], // 내 수업명 목록
  rooms: [], // 교실·실습실 목록
  classes: [], // 담당 학반 목록 (예: 1-2)
  homerooms: {}, // 학반 -> { main: 담임, sub: 부담임 }
};

/** 수업명 목록 항목: "인공지능 기초" 또는 { name, short } */
export const courseOf = (c) => (c && typeof c === 'object' ? { name: c.name || '', short: c.short || '' } : { name: String(c || ''), short: '' });
/** 수업명 → 화면에 보일 축약 이름 */
export function courseShort(settings, subject) {
  const c = (settings.courses || []).map(courseOf).find((x) => x.name === subject);
  return c?.short || subject || '';
}

/** D-day 표시: 마감일 - 기준일 */
export function dday(due, date) {
  if (!due) return null;
  const n = Math.round((new Date(due + 'T00:00') - new Date(date + 'T00:00')) / 86400000);
  return { n, label: n === 0 ? 'D-day' : n > 0 ? `D-${n}` : `D+${-n}` };
}

/** 시간표 칸 → { subject, cls, room } */
export function ttCell(v) {
  if (v && typeof v === 'object') return { subject: v.subject || '', cls: v.cls || '', room: v.room || '' };
  return { subject: String(v || ''), cls: '', room: '' };
}
export const ttIsEmpty = (v) => { const c = ttCell(v); return !c.subject && !c.cls && !c.room; };

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
    migrateRefs(full);
    this.year = year;
    this.base = full;
    this.work = clone(full);
    this.counselDraft = {};
    this.dirty = false;
    this.emit('load');
  }

  markDirty() {
    this.seq = (this.seq || 0) + 1;
    if (!this.dirty) { this.dirty = true; this.emit('dirty'); }
    this.emit('change');
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

  /** 정규 교시 수 (설정 > 일과 시간) */
  get periods() { return bellOf(this.settings).periodCount; }
  get bell() { return bellOf(this.settings); }
  periodLabel(p) { return periodLabel(this.settings, p); }

  /** 정렬된 학생 목록 (학년-반-번호 순) */
  students() { return sortStudents(this.work.students); }
  studentIndex() { return buildIndex(this.work.students); }
  /** uid(또는 옛 이름 참조) → "학번 이름" */
  label(ref) { return labelOf(ref, this.studentIndex()); }
  /** 학반 목록: 설정의 담당 학반 + 학생 명단의 학반 */
  classList() {
    return [...new Set([...(this.settings.classes || []), ...classKeys(this.work.students)])].sort((a, b) => {
      const [ag, ac] = a.split('-').map(Number), [bg, bc] = b.split('-').map(Number);
      return (ag - bg) || (ac - bc) || a.localeCompare(b);
    });
  }
  /** 학반(예: '1-2')의 학생들. 빈 값이면 전체 */
  studentsOf(cls) { return this.students().filter((s) => !cls || `${s.grade}-${s.cls}` === cls); }

  // ----- 휴업일 -----
  scheduleItem(date) { return this.work.schedule.find((x) => x.date === date); }
  isSchoolHoliday(date) { return !!this.scheduleItem(date)?.holiday; }
  setSchoolHoliday(date, on) {
    let s = this.scheduleItem(date);
    if (!s) { s = { id: newId(), date, text: '' }; this.work.schedule.push(s); }
    s.holiday = !!on;
    if (on && !s.text.trim()) s.text = '휴업일';
    if (!on) delete s.holiday;
    this.markDirty();
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

  /** 교시별 수업일지 (저장된 값 > 기본 시간표). 저녁 방과후는 교시 번호 11부터 */
  lessonsFor(date, weekday) {
    const tt = this.settings.timetable[weekday] || [];
    const out = [];
    for (const { p } of periodList(this.settings)) {
      const saved = this.work.lessons.find((l) => l.date === date && l.period === p);
      out.push(saved || { id: null, date, period: p, ...ttCell(tt[p - 1]), content: '' });
    }
    // 교시 수를 줄였어도 이미 기록한 수업일지는 보이게 한다
    for (const l of this.work.lessons) if (l.date === date && !out.some((o) => o.period === l.period)) out.push(l);
    out.sort((a, b) => a.period - b.period);
    return out;
  }

  setLesson(date, period, patch) {
    let l = this.work.lessons.find((x) => x.date === date && x.period === period);
    if (!l) {
      const weekday = new Date(date + 'T00:00').getDay();
      l = { id: newId(), date, period, ...ttCell(this.settings.timetable[weekday]?.[period - 1]), content: '' };
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

  /** 학생 한 명(uid)에 대한 상담 일지 모음 (저장되지 않은 초안 포함) */
  counselFor(uid) {
    const students = this.work.students;
    const out = [];
    const draftDates = new Set(Object.keys(this.counselDraft));
    for (const c of this.work.counsel) if (!draftDates.has(c.date) && (c.students || []).includes(uid)) out.push(c);
    for (const d of draftDates) {
      splitParagraphs(this.counselDraft[d]).forEach((text, i) => {
        if (mentionedUids(text, students).includes(uid)) out.push({ date: d, order: i, text });
      });
    }
    return out.sort((a, b) => (a.date + a.order).localeCompare(b.date + b.order));
  }

  tripsOn(date) { return this.work.trips.filter((t) => t.date === date); }

  // ---------- 저장 ----------
  /** 상담일지 초안을 단락 단위 레코드로 변환 */
  applyCounselDrafts() {
    const students = this.work.students;
    for (const [date, text] of Object.entries(this.counselDraft)) {
      const paras = splitParagraphs(text);
      const existing = this.work.counsel.filter((c) => c.date === date).sort((a, b) => a.order - b.order);
      paras.forEach((p, i) => {
        const uids = mentionedUids(p, students);
        if (existing[i]) Object.assign(existing[i], { order: i, text: p, students: uids });
        else this.work.counsel.push({ id: newId(), date, order: i, text: p, students: uids });
      });
      const remove = new Set(existing.slice(paras.length).map((c) => c.id));
      this.work.counsel = this.work.counsel.filter((c) => !remove.has(c.id));
    }
    this.counselDraft = {};
  }

  /** 저장 전 값 다듬기 (항목을 지우지 않고 그 자리에서 고침: 화면이 들고 있는 객체가 그대로 유지되도록) */
  normalize() {
    const w = this.work;
    for (const x of w.students) { Object.assign(x, normStudent(x)); x.uid ||= newUid(); }
    // 내용만 있고 제목이 없는 요록은 날짜+순번으로 제목 채번
    for (const r of w.records) {
      if (!(r.title || '').trim() && Object.values(r.entries || {}).some((v) => String(v).trim())) {
        const prefix = r.created.replace(/-/g, '');
        let n = 1;
        while (w.records.some((x) => x.title === `${prefix}-${n}`)) n++;
        r.title = `${prefix}-${n}`;
      }
    }
  }

  /** 저장할 가치가 있는 항목인가 (입력 중인 빈 항목은 저장하지 않음 → 기존 항목이면 삭제로 처리) */
  saveable(col, x) {
    switch (col) {
      case 'tasks': return !!(x.text || '').trim();
      case 'students': return !!(x.name || '').trim();
      case 'attendance': return !!x.student;
      case 'records': return !!(x.title || '').trim();
      case 'schedule': return !!((x.text || '').trim() || x.holiday);
      case 'trips': return !!((x.place || '').trim() || (x.purpose || '').trim() || (x.time || '').trim());
      case 'notes': return !!(x.text || '').trim() || !x.temp;
      case 'lessons': {
        const def = ttCell(this.settings.timetable[new Date(x.date + 'T00:00').getDay()]?.[x.period - 1]);
        return !!((x.content || '').trim() || (x.subject || '') !== def.subject || (x.cls || '') !== def.cls || (x.room || '') !== def.room);
      }
      default: return true;
    }
  }

  diff() {
    const ops = [];
    for (const col of COLLECTIONS) {
      const baseMap = new Map(this.base[col].map((x) => [x.id, x]));
      const keep = new Set();
      for (const item of this.work[col]) {
        if (!this.saveable(col, item)) continue;
        keep.add(item.id);
        const b = baseMap.get(item.id);
        if (!b || JSON.stringify(b) !== JSON.stringify(item)) ops.push({ op: 'upsert', col, item: clone(item) });
      }
      for (const b of this.base[col]) if (!keep.has(b.id) && !isTempId(b.id)) ops.push({ op: 'delete', col, id: b.id });
    }
    return ops;
  }

  /** @param touchDates 최종수정일시를 갱신할 날짜(현재 교사수첩 날짜) */
  async save(touchDates = []) {
    if (this.saving) return { ok: false, busy: true };
    this.saving = true;
    const seqAtStart = this.seq || 0;
    this.emit('saving');
    try {
      const draftDates = Object.keys(this.counselDraft);
      this.applyCounselDrafts();
      this.normalize();
      let ops = this.diff();
      if (!ops.length) { this.dirty = (this.seq || 0) !== seqAtStart; this.emit('saved'); return { ok: true, count: 0 }; }
      const now = new Date().toISOString();
      for (const date of new Set([...touchDates, ...draftDates])) {
        let d = this.day(date);
        if (!d) { d = { id: newId(), date }; this.work.days.push(d); }
        d.updatedAt = now;
      }
      ops = this.diff();

      const idx = this.studentIndex();
      const results = await this.backend.applyOps(this.year, ops, { label: (ref) => labelOf(ref, idx), students: this.work.students });
      let failed = 0;
      results.forEach((r, i) => {
        const op = ops[i];
        if (!r?.ok) { failed++; return; }
        if (op.op === 'delete') {
          this.base[op.col] = this.base[op.col].filter((x) => x.id !== op.id);
          // 화면에 아직 남아 있는(입력 중인) 항목이면 새 항목으로 다시 저장되도록 임시 id 부여
          const w = this.work[op.col].find((x) => x.id === op.id);
          if (w) w.id = newId();
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
      // 저장하는 동안 새로 고친 내용이 있으면 여전히 '저장 안 됨'
      this.dirty = failed > 0 || (this.seq || 0) !== seqAtStart;
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

/**
 * 불러온 데이터의 학생 참조를 uid 로 맞춘다.
 * - 학생에 uid 가 없으면 레코드 id 를 uid 로 사용 (예전 데이터)
 * - 출결/상담/요록의 이름·"학번 이름" 참조를 uid 로 변환 (노션·마크다운은 사람이 읽는 이름으로 저장되어 있음)
 */
export function migrateRefs(data) {
  data.students = data.students.map((s) => ({ ...normStudent(s), uid: s.uid || s.id }));
  const idx = buildIndex(data.students);
  for (const a of data.attendance) a.student = toUid(a.student, idx);
  for (const c of data.counsel) c.students = [...new Set((c.students || []).map((r) => toUid(r, idx)))];
  for (const r of data.records) {
    const e = {};
    for (const [k, v] of Object.entries(r.entries || {})) e[toUid(k, idx)] = v;
    r.entries = e;
  }
}
