// 대회·활동: 대회·공모전·프로그램(캠프·연수 등)과 참가 학생·팀, 단계(예선·본선…)별 결과, 수상, 수료
// 레코드: { id, name, kind, host, start, end, summary, completion(수료 관리), links:[{title,url}], files:[{title,file,uploaded}],
//           stages:[{id,name,start,end,memo}], entries:[{id,team,members:[uid],results:{stageId:결과},award,done,memo}] }

export const KINDS = ['대회', '공모전', '프로그램', '기타'];
export const RESULTS = ['참가', '통과', '탈락', '불참'];
export const AWARDS = ['대상', '최우수상', '우수상', '장려상', '금상', '은상', '동상', '입선', '특별상', '참가상'];
export const STAGE_PRESETS = ['접수', '예선', '본선', '결선', '시상식', '수료식'];
export const STATUS = { soon: '예정', active: '진행 중', done: '끝남' };
export const FILES_FOLDER = '대회·활동자료';

export const stageId = () => `st_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** 대회 전체 기간: 대회 기간이 없으면 단계 날짜들로 */
export function spanOf(c) {
  const ds = [c.start, c.end, ...(c.stages || []).flatMap((s) => [s.start, s.end])].filter(Boolean).sort();
  return { start: c.start || ds[0] || '', end: c.end || ds.at(-1) || '' };
}

/** 예정·진행 중·끝남 */
export function contestStatus(c, today) {
  const { start, end } = spanOf(c);
  if (end && end < today) return 'done';
  if (start && start > today) return 'soon';
  return 'active';
}

const ddays = (date, today) => Math.round((new Date(date + 'T00:00') - new Date(today + 'T00:00')) / 86400000);

/** 오늘 이후 가장 가까운 일정 → { label, date, n } (없으면 null) */
export function nextEvent(c, today) {
  const ev = [];
  const add = (date, label) => { if (date && date >= today) ev.push({ date, label }); };
  for (const s of c.stages || []) {
    if (s.start && s.end && s.start !== s.end) { add(s.start, `${s.name} 시작`); add(s.end, `${s.name} 마감`); } else add(s.start || s.end, s.name);
  }
  if (!ev.length) { add(c.start, '시작'); add(c.end, '마감'); }
  ev.sort((a, b) => a.date.localeCompare(b.date));
  return ev[0] ? { ...ev[0], n: ddays(ev[0].date, today) } : null;
}

/** 그날 대회·활동 일정 (시작일·마감일·하루짜리 단계, 대회 시작·끝) */
export function dayEvents(contests, date) {
  const out = [];
  for (const c of contests || []) {
    for (const s of c.stages || []) {
      if (s.start && s.end && s.start !== s.end) {
        if (s.start === date) out.push({ c, text: `${s.name} 시작` });
        if (s.end === date) out.push({ c, text: `${s.name} 마감` });
      } else if ((s.start || s.end) === date) out.push({ c, text: s.name });
    }
    if (!out.some((x) => x.c === c)) {
      if (c.start === date) out.push({ c, text: '시작' });
      if (c.end === date) out.push({ c, text: '끝' });
    }
  }
  return out;
}

/** 단계별 결과를 사람이 읽는 말로: "예선 통과 · 본선 참가" */
export function resultText(c, e) {
  return (c.stages || []).map((s) => (e.results?.[s.id] ? `${s.name} ${e.results[s.id]}` : '')).filter(Boolean).join(' · ');
}

/** 마지막으로 결과가 있는 단계 */
export function lastResult(c, e) {
  const st = [...(c.stages || [])].reverse().find((s) => e.results?.[s.id]);
  return st ? `${st.name} ${e.results[st.id]}` : '';
}

/** 학생 한 명의 대회·활동 기록 → [{c, e}] (최근 것부터) */
export function activitiesOf(contests, uid) {
  const out = [];
  for (const c of contests || []) for (const e of c.entries || []) if ((e.members || []).includes(uid)) out.push({ c, e });
  return out.sort((a, b) => (spanOf(b.c).start || '').localeCompare(spanOf(a.c).start || ''));
}

/** 수상 개수 */
export const awardCount = (c) => (c.entries || []).filter((e) => (e.award || '').trim()).length;

/** 보고서·엑셀용: 학생별 한 줄씩 */
export function activityRows(contests, students, label) {
  const rows = [];
  for (const c of contests || []) {
    const { start, end } = spanOf(c);
    for (const e of c.entries || []) {
      for (const uid of e.members || []) {
        const s = students.find((x) => x.uid === uid);
        rows.push({ uid, s, c, e, studentNo: s?.studentNo || '', name: s?.name || label(uid), contest: c.name, kind: c.kind || '', host: c.host || '',
          period: [start, end].filter(Boolean).join(' ~ '), team: e.team || '', result: resultText(c, e), award: e.award || '',
          done: c.completion ? (e.done ? '수료' : '미수료') : '', memo: e.memo || '' });
      }
    }
  }
  return rows.sort((a, b) => (a.studentNo || '~').localeCompare(b.studentNo || '~') || a.name.localeCompare(b.name, 'ko') || (b.period).localeCompare(a.period));
}

export const ACTIVITY_HEAD = ['학번', '이름', '대회·활동', '종류', '주최', '기간', '팀', '결과', '수상', '수료', '메모'];
export const activityRowCells = (r) => [r.studentNo, r.name, r.contest, r.kind, r.host, r.period, r.team, r.result, r.award, r.done, r.memo];

/** 대회 하나를 엑셀 시트들로: 개요, 일정, 참가(팀별), 참가 학생(한 명씩) */
export function contestSheets(c, label, students = []) {
  const { start, end } = spanOf(c);
  const stages = c.stages || [];
  return [
    { name: '개요', rows: [['항목', '내용'], ['이름', c.name], ['종류', c.kind || ''], ['주최', c.host || ''], ['기간', [start, end].filter(Boolean).join(' ~ ')],
      ['개요', c.summary || ''], ...(c.links || []).map((l) => ['링크', `${l.title ? `${l.title} ` : ''}${l.url}`]), ...(c.files || []).map((f) => ['파일', f.title || f.file])] },
    { name: '일정', rows: [['단계', '시작', '끝', '메모'], ...stages.map((s) => [s.name, s.start || '', s.end || '', s.memo || ''])] },
    { name: '참가', rows: [['팀', '학생', ...stages.map((s) => s.name), '수상', ...(c.completion ? ['수료'] : []), '메모'],
      ...(c.entries || []).map((e) => [e.team || '', (e.members || []).map(label).join(', '), ...stages.map((s) => e.results?.[s.id] || ''), e.award || '', ...(c.completion ? [e.done ? '수료' : ''] : []), e.memo || ''])] },
    { name: '참가 학생', rows: [ACTIVITY_HEAD, ...activityRows([c], students, label).map(activityRowCells)] },
  ];
}
