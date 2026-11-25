// 블록 목록 → Word(.docx) (export.js 의 블록 형식)
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel,
  Footer, AlignmentType, PageBreak, ShadingType,
} from 'docx';

const FONT = '맑은 고딕';

const para = (text, opts = {}) => {
  const lines = String(text ?? '').split('\n');
  return new Paragraph({
    spacing: { after: 80 },
    children: lines.map((l, i) => new TextRun({ text: l, font: FONT, size: opts.size || 20, bold: opts.bold, color: opts.color, break: i ? 1 : 0 })),
  });
};
const heading = (text, level) => new Paragraph({ heading: level, spacing: { before: level === HeadingLevel.HEADING_1 ? 0 : 200, after: level === HeadingLevel.HEADING_1 ? 120 : 100 }, children: [new TextRun({ text, font: FONT, bold: true })] });

function table(headers, rows, widths) {
  const cell = (text, head, w) => new TableCell({
    width: w ? { size: w, type: WidthType.PERCENTAGE } : undefined,
    shading: head ? { type: ShadingType.CLEAR, fill: 'E8E8E8', color: 'auto' } : undefined,
    children: [para(text, head ? { bold: true } : {})],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((hd, i) => cell(hd, true, widths?.[i])) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, false, widths?.[i])) })),
    ],
  });
}

export async function renderDocx(blocks, footerText) {
  const children = blocks.map((b) => {
    switch (b.t) {
      case 'title': return heading(b.text, HeadingLevel.HEADING_1);
      case 'h': return heading(b.text, HeadingLevel.HEADING_2);
      case 'small': return para(b.text, { color: '555555', size: 18 });
      case 'table': return table(b.headers, b.rows, b.widths);
      case 'break': return new Paragraph({ children: [new PageBreak()] });
      default: return para(b.text, { bold: b.bold, color: b.color });
    }
  });
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      footers: footerText ? { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: footerText, font: FONT, size: 16, color: '777777' })] })] }) } : undefined,
      children,
    }],
  });
  return Packer.toBlob(doc);
}
