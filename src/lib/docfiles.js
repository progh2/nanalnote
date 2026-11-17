// 올린 문서 처리: PDF → 쪽 이미지, HWPX → 본문 텍스트 + 미리보기 이미지
// (pdf.js, fflate 는 필요할 때만 불러온다)

/** PDF 를 쪽별 JPEG 이미지로 (긴 변 약 1800px) */
export async function pdfToImages(file, { maxPages = 30, longSide = 1800, onProgress } = {}) {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const total = doc.numPages;
  const n = Math.min(doc.numPages, maxPages);
  const out = [];
  for (let i = 1; i <= n; i++) {
    onProgress?.(i, n);
    const page = await doc.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = longSide / Math.max(vp1.width, vp1.height);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
    out.push(await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.88)));
    page.cleanup();
  }
  await task.destroy();
  return { images: out, total };
}

/** HWPX(한글 문서, zip+XML)에서 본문 텍스트(표는 칸을 " | " 로)와 미리보기 이미지 */
export async function hwpxExtract(file) {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const names = Object.keys(files);
  const sections = names.filter((n) => /^Contents\/section\d+\.xml$/i.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  const lines = [];
  const local = (el) => el.localName || el.nodeName.split(':').pop();
  const textOf = (el) => [...el.getElementsByTagName('*')].filter((x) => local(x) === 't').map((x) => x.textContent).join('');
  const walk = (el) => {
    for (const c of el.children) {
      const n = local(c);
      if (n === 'tbl') {
        // 이 표의 행만 (hp:tbl > hp:tr > hp:tc), 칸 안의 중첩 표는 칸 글자로 합쳐짐
        for (const tr of [...c.children].filter((x) => local(x) === 'tr')) {
          const cells = [...tr.children].filter((x) => local(x) === 'tc').map((tc) => textOf(tc).replace(/\s+/g, ' ').trim());
          if (cells.some(Boolean)) lines.push(cells.join(' | '));
        }
        lines.push('');
      } else if (n === 'p') {
        if ([...c.getElementsByTagName('*')].some((x) => local(x) === 'tbl')) walk(c);
        else { const t = textOf(c).trim(); if (t) lines.push(t); }
      } else walk(c);
    }
  };
  for (const s of sections) {
    const xml = new DOMParser().parseFromString(strFromU8(files[s]), 'application/xml');
    walk(xml.documentElement);
  }
  let text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text && files['Preview/PrvText.txt']) text = strFromU8(files['Preview/PrvText.txt']);
  const prv = names.find((n) => /^Preview\/PrvImage\.(png|jpg|jpeg|gif|bmp)$/i.test(n));
  const preview = prv ? new Blob([files[prv]], { type: /png$/i.test(prv) ? 'image/png' : 'image/jpeg' }) : null;
  return { text, preview };
}

export const kindOfFile = (file) => {
  const n = (file.name || '').toLowerCase();
  if (file.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.hwpx')) return 'hwpx';
  if (n.endsWith('.hwp')) return 'hwp';
  if (/^image\//.test(file.type) || /\.(png|jpe?g|gif|webp|bmp)$/.test(n)) return 'image';
  return 'other';
};
