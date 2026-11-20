// 엑셀(.xlsx) 읽기·쓰기 — 외부 라이브러리 없이 (xlsx 는 XML 파일들을 zip 으로 묶은 것)
// 읽기: 첫 시트(또는 모든 시트)의 칸을 글자로. 쓰기: 머리줄 굵게·고정, 열 너비, 모든 칸은 글자(학번 앞 0·전화번호 보존)
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

const unesc = (s) => s.replace(/&(lt|gt|quot|apos|amp|#(\d+)|#x([0-9a-f]+));/gi, (m, n, d, x) =>
  d ? String.fromCodePoint(+d) : x ? String.fromCodePoint(parseInt(x, 16)) : { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[n.toLowerCase()]);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // XML 에 못 넣는 제어 문자 제거
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** <t> 들을 이어 붙인 글자 (서식 있는 글자 <r><t> 포함, 윗주 <rPh> 제외) */
const texts = (xml) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g)].map((m) => unesc(m[1] || '')).join('');

/** "AB12" → 열 번호(0부터) */
export function colIndex(ref) {
  const letters = String(ref).match(/^[A-Z]+/i)?.[0].toUpperCase() || 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export const colName = (i) => { let s = ''; i += 1; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

function parseSheet(xml, shared) {
  const rows = [];
  const data = xml.match(/<sheetData[^>]*>([\s\S]*?)<\/sheetData>/)?.[1] || '';
  let rIdx = -1;
  for (const rm of data.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const attrs = rm[1] || rm[3] || '';
    const rn = attrs.match(/\br="(\d+)"/);
    rIdx = rn ? +rn[1] - 1 : rIdx + 1;
    const row = [];
    let cIdx = -1;
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = cm[1];
      const ref = ca.match(/\br="([A-Z]+)\d*"/i);
      cIdx = ref ? colIndex(ref[1]) : cIdx + 1;
      const t = ca.match(/\bt="(\w+)"/)?.[1] || 'n';
      const inner = cm[2] || '';
      let v = '';
      if (t === 'inlineStr') v = texts(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] || '');
      else {
        const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (raw == null) v = '';
        else if (t === 's') v = shared[+raw] ?? '';
        else if (t === 'b') v = raw === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'str' || t === 'e') v = unesc(raw);
        else v = numStr(raw);
      }
      row[cIdx] = v;
    }
    rows[rIdx] = Array.from(row, (x) => x ?? '');
  }
  return Array.from(rows, (r) => r || []);
}

/** 1.0E+4 같은 숫자 표기를 사람이 쓰는 모양으로 (학번 20101 → "20101") */
function numStr(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  return String(+n.toPrecision(12));
}

/**
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {{name:string, rows:string[][]}[]}  시트 순서대로
 */
export function readXlsx(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8[0] === 0xd0 && u8[1] === 0xcf) throw new Error('예전 엑셀 파일(.xls)은 읽을 수 없습니다. 엑셀에서 "다른 이름으로 저장 → Excel 통합 문서(.xlsx)"로 저장해 올려 주세요.');
  let files;
  try { files = unzipSync(u8); } catch { throw new Error('엑셀(.xlsx) 파일이 아닙니다.'); }
  const get = (p) => { const k = Object.keys(files).find((x) => x.toLowerCase() === p.toLowerCase()); return k ? strFromU8(files[k]) : null; };
  const wb = get('xl/workbook.xml');
  if (!wb) throw new Error('엑셀(.xlsx) 파일이 아닙니다.');
  const shared = [];
  const ss = get('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]));
  const rels = {};
  for (const m of (get('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1], target = m[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) rels[id] = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const out = [];
  let i = 0;
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    i++;
    const name = unesc(m[0].match(/\bname="([^"]*)"/)?.[1] || `Sheet${i}`);
    const rid = m[0].match(/\br:id="([^"]+)"/)?.[1] || m[0].match(/\bid="([^"]+)"/)?.[1];
    const xml = get(rels[rid] || `xl/worksheets/sheet${i}.xml`);
    if (xml) out.push({ name, rows: parseSheet(xml, shared) });
  }
  return out;
}

/**
 * @param {{name:string, rows:any[][], widths?:number[]}[]} sheets  첫 줄은 머리줄(굵게, 고정)
 * @returns {Uint8Array}
 */
export function writeXlsx(sheets) {
  const safe = (n, i) => (String(n || `시트${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `시트${i + 1}`);
  const names = [];
  sheets.forEach((s, i) => { let n = safe(s.name, i), k = 2; while (names.includes(n)) n = `${safe(s.name, i).slice(0, 28)}(${k++})`; names.push(n); });
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    // 0: 기본, 1: 머리줄(굵게·연한 배경·테두리), 2: 줄바꿈 칸
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/><family val="2"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF9AA4B2"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>`,
  };
  sheets.forEach((s, i) => {
    const rows = s.rows || [];
    const ncol = Math.max(1, ...rows.map((r) => r.length));
    const widths = Array.from({ length: ncol }, (_, c) => s.widths?.[c] ?? Math.min(50, Math.max(6, ...rows.slice(0, 200).map((r) => {
      const v = String(r[c] ?? '').split('\n')[0];
      return [...v].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0) + 2;
    }))));
    const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (v == null || v === '' ? '' : `<c r="${colName(ci)}${ri + 1}" t="inlineStr" s="${ri === 0 ? 1 : 2}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`)).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${rows.length > 1 ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews><cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData>${rows.length > 1 ? `<autoFilter ref="A1:${colName(ncol - 1)}${rows.length}"/>` : ''}</worksheet>`;
  });
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 });
}

export const xlsxBlob = (sheets) => new Blob([writeXlsx(sheets)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

/** 표의 머리줄 찾기: 위쪽 몇 줄에서 원하는 열 이름이 가장 많이 들어 있는 줄 (학교 서식은 제목 줄이 먼저 오는 경우가 많다) */
export function findHeaderRow(rows, want, scan = 15) {
  let best = -1, score = 0;
  rows.slice(0, scan).forEach((r, i) => {
    const cells = r.map((c) => String(c || '').replace(/\s/g, ''));
    const n = want.filter((alts) => cells.some((c) => alts.includes(c))).length;
    if (n > score) { score = n; best = i; }
  });
  return best;
}
