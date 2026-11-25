// 한글(.hwpx) 만들기 — 외부 라이브러리 없이 XML 을 써서 zip 으로 묶는다 (OWPML)
// 글자·문단 모양은 hwpx/header.xml(보고서 틀)에 정의된 번호를 쓴다:
//   글자 1 = 10pt 돋움(본문), 7 = 20pt 굵게(제목), 13 = 12pt 굵게 돋움(소제목), 9 = 10pt 굵게(표 머리), 11 = 9pt(작은 글)
//   문단 0 = 양쪽 160%, 20 = 가운데, 22 = 표 칸(130%), 23 = 오른쪽, 27 = 위·아래 줄 있는 소제목
//   테두리 3 = 실선, 4 = 실선 + 옅은 배경(표 머리)
import { zipSync, strToU8 } from 'fflate';
import HEADER from './hwpx/header.xml?raw';
import CONTENT from './hwpx/content.hpf?raw';
import CONTAINER from './hwpx/container.xml?raw';
import CONTAINER_RDF from './hwpx/container.rdf?raw';
import MANIFEST from './hwpx/manifest.xml?raw';
import VERSION from './hwpx/version.xml?raw';
import SETTINGS from './hwpx/settings.xml?raw';

const NS = 'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"';
const PAGE_W = 59528, MARGIN_LR = 5670; // A4, 좌우 여백 20mm
export const BODY_W = PAGE_W - MARGIN_LR * 2;

// XML 1.0 에 쓸 수 없는 제어 문자는 지운다
const esc = (s) => String(s ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SEC_PR = `<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">
<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>
<hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>
<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>
<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>
<hp:pagePr landscape="WIDELY" width="${PAGE_W}" height="84186" gutterType="LEFT_ONLY">
<hp:margin header="2835" footer="2835" gutter="0" left="${MARGIN_LR}" right="${MARGIN_LR}" top="4252" bottom="4252"/>
</hp:pagePr>
<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>
<hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>
<hp:pageBorderFill type="BOTH" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>
<hp:pageBorderFill type="EVEN" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>
<hp:pageBorderFill type="ODD" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>
</hp:secPr>`;

/**
 * 블록 목록 → 한글 문서(Blob)
 * 블록: {t:'title'|'h'|'p'|'ml'|'small', text, bold?} · {t:'table', headers, rows, widths(%)} · {t:'break'}
 */
export function buildHwpx(blocks, { footer = '' } = {}) {
  let id = 1000000000;
  const nid = () => ++id;
  const para = (text, { para: pp = 0, char = 1, pageBreak = false } = {}) =>
    `<hp:p id="${nid()}" paraPrIDRef="${pp}" styleIDRef="0" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0"><hp:run charPrIDRef="${char}">${text === '' ? '<hp:t/>' : `<hp:t>${esc(text)}</hp:t>`}</hp:run></hp:p>`;
  const lines = (text, opts) => String(text ?? '').split('\n').map((l, i) => para(l, { ...opts, pageBreak: i === 0 && opts?.pageBreak })).join('');

  const table = (headers, rows, widths, pageBreak) => {
    const n = headers.length;
    const pct = widths?.length === n ? widths : headers.map(() => 100 / n);
    const sum = pct.reduce((a, b) => a + b, 0);
    const ws = pct.map((w) => Math.floor((BODY_W * w) / sum));
    ws[n - 1] += BODY_W - ws.reduce((a, b) => a + b, 0);
    const ROW_H = 1600;
    const all = [headers, ...rows];
    const cell = (text, r, c, head) => `<hp:tc name="" header="${head ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${head ? 4 : 3}">`
      + `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${head ? 'CENTER' : 'TOP'}" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">`
      + lines(text, { para: head ? 21 : 22, char: head ? 9 : 1 })
      + `</hp:subList><hp:cellAddr colAddr="${c}" rowAddr="${r}"/><hp:cellSpan colSpan="1" rowSpan="1"/>`
      + `<hp:cellSz width="${ws[c]}" height="${ROW_H}"/><hp:cellMargin left="510" right="510" top="141" bottom="141"/></hp:tc>`;
    const trs = all.map((row, r) => `<hp:tr>${headers.map((_, c) => cell(row[c] ?? '', r, c, r === 0)).join('')}</hp:tr>`).join('');
    return `<hp:p id="${nid()}" paraPrIDRef="0" styleIDRef="0" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0"><hp:run charPrIDRef="1">`
      + `<hp:tbl id="${nid()}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${all.length}" colCnt="${n}" cellSpacing="0" borderFillIDRef="3" noAdjust="0">`
      + `<hp:sz width="${BODY_W}" widthRelTo="ABSOLUTE" height="${ROW_H * all.length}" heightRelTo="ABSOLUTE" protect="0"/>`
      + '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
      + '<hp:outMargin left="0" right="0" top="0" bottom="283"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>'
      + `${trs}</hp:tbl></hp:run><hp:run charPrIDRef="1"><hp:t/></hp:run></hp:p>`;
  };

  const body = [];
  let brk = false;
  for (const b of blocks) {
    if (b.t === 'break') { brk = true; continue; }
    const o = { pageBreak: brk };
    brk = false;
    if (b.t === 'title') body.push(lines(b.text, { ...o, para: 20, char: 7 }));
    else if (b.t === 'h') body.push(lines(b.text, { ...o, para: 27, char: 13 }));
    else if (b.t === 'small') body.push(lines(b.text, { ...o, para: 0, char: 11 }));
    else if (b.t === 'p' || b.t === 'ml') body.push(lines(b.text, { ...o, char: b.bold ? 13 : 1 }));
    else if (b.t === 'table') body.push(table(b.headers, b.rows, b.widths, o.pageBreak));
  }
  if (footer) body.push(para(''), para(footer, { para: 23, char: 11 }));

  const first = `<hp:p id="${nid()}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="1">${SEC_PR}<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl></hp:run><hp:run charPrIDRef="1"><hp:t/></hp:run></hp:p>`;
  const section = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hs:sec ${NS}>${first}${body.join('')}</hs:sec>`;
  const title = blocks.find((b) => b.t === 'title')?.text || '';
  const preview = blocks.filter((b) => b.t !== 'table' && b.t !== 'break').map((b) => b.text).join('\n').slice(0, 1000);

  const files = {
    mimetype: [strToU8('application/hwp+zip'), { level: 0 }],
    'version.xml': strToU8(VERSION),
    'Contents/header.xml': strToU8(HEADER),
    'Contents/section0.xml': strToU8(section),
    'Contents/content.hpf': strToU8(CONTENT.replace('<opf:title/>', `<opf:title>${esc(title)}</opf:title>`)),
    'Preview/PrvText.txt': strToU8(preview),
    'settings.xml': strToU8(SETTINGS),
    'META-INF/container.xml': strToU8(CONTAINER),
    'META-INF/container.rdf': strToU8(CONTAINER_RDF),
    'META-INF/manifest.xml': strToU8(MANIFEST),
  };
  const zip = zipSync(files, { level: 6 });
  return new Blob([zip], { type: 'application/hwp+zip' });
}
