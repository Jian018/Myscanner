import { ordered, type Project, type ScanPage } from '../types';
import { getAsset } from './storage';
import { imageCanvas, canvasBlob } from './images';
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const safeName = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'scan';
export async function exportJpg(project: Project, page: ScanPage) {
  const { blob } = await getAsset(page.processedAssetId ?? page.originalAssetId);
  download(await canvasBlob(await imageCanvas(blob)), `${safeName(project.name)}-${String(page.order + 1).padStart(3, '0')}.jpg`);
}
export async function exportOriginal(project: Project, page: ScanPage) {
  const source = project.sources.find(s => s.id === page.sourceId);
  if (!source) throw new Error('找不到原始文件');
  download((await getAsset(source.assetId)).blob, safeName(source.name));
}
export async function exportAllJpg(project: Project, progress: (s: string) => void) {
  const { Zip, ZipPassThrough } = await import('fflate');
  // Incremental ZIP avoids retaining every uncompressed image twice in memory.
  const chunks: Uint8Array[] = [];
  const done = new Promise<Uint8Array[]>((resolve, reject) => {
    const zip = new Zip((error, data, final) => {
      if (error) { reject(error); return; }
      chunks.push(data); if (final) resolve(chunks);
    });
    (async () => {
      for (const page of ordered(project.pages)) {
        progress(`导出 JPG · ${page.order + 1}/${project.pages.length}`);
        const asset = await getAsset(page.processedAssetId ?? page.originalAssetId);
        const blob = await canvasBlob(await imageCanvas(asset.blob));
        const file = new ZipPassThrough(`${String(page.order + 1).padStart(3,'0')}.jpg`);
        zip.add(file); file.push(new Uint8Array(await blob.arrayBuffer()), true);
      }
      zip.end();
    })().catch(reject);
  });
  download(new Blob((await done).map(b => new Uint8Array(b)), { type: 'application/zip' }), `${safeName(project.name)}-jpg.zip`);
}
export async function buildPdf(project: Project, mode: 'scan' | 'reflow', progress: (s: string) => void): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const response = await fetch('/fonts/NotoSansSC-Regular.ttf');
  if (!response.ok) throw new Error('中文字体加载失败');
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  // Embed the static font intact: fontkit's subset writer corrupts some CJK glyphs.
  const font = await doc.embedFont(await response.arrayBuffer());
  doc.setTitle(project.name); doc.setProducer('AI Smart Scanner');
  // Noto CJK cannot encode every symbol; keep unsupported code points visible as review markers.
  const supported = new Set(font.getCharacterSet());
  const clean = (s: string) => Array.from(s.replace(/\r/g, '').replace(/\t/g, '    ')).map(c => c === '\n' || supported.has(c.codePointAt(0)!) ? c : '□').join('');
  const wrap = (text: string, size: number, max: number) => {
    const lines: string[] = [];
    for (const paragraph of clean(text).split('\n')) {
      let line = '';
      for (const char of paragraph) {
        if (font.widthOfTextAtSize(line + char, size) > max && line) { lines.push(line); line = ''; }
        line += char;
      }
      lines.push(line);
    }
    return lines;
  };
  for (const [index, page] of ordered(project.pages).entries()) {
    progress(`导出 PDF · ${index + 1}/${project.pages.length}`);
    if (mode === 'scan') {
      const asset = await getAsset(page.processedAssetId ?? page.originalAssetId);
      const jpg = await canvasBlob(await imageCanvas(asset.blob));
      const image = await doc.embedJpg(await jpg.arrayBuffer());
      const scale = Math.min(595 / image.width, 842 / image.height);
      const pdfPage = doc.addPage([image.width * scale, image.height * scale]);
      pdfPage.drawImage(image, { x: 0, y: 0, width: pdfPage.getWidth(), height: pdfPage.getHeight() });
      const latest = page.results.at(-1);
      if (latest?.engine === 'tesseract' && latest.text === page.text && latest.words.length) {
        for (const word of latest.words) {
          const text = clean(word.text).replace(/\n/g, ' '), size = Math.max(1, (word.bbox.y1 - word.bbox.y0) * scale * 0.8);
          const width = font.widthOfTextAtSize(text, size), boxWidth = Math.max(1, (word.bbox.x1 - word.bbox.x0) * scale);
          // Text stays at its OCR box. Font size is reduced for long words to avoid overlap.
          pdfPage.drawText(text, { font, size: width > boxWidth ? size * boxWidth / width : size, x: word.bbox.x0 * scale, y: Math.max(0, pdfPage.getHeight() - word.bbox.y1 * scale), opacity: 0 });
        }
      } else {
        const lines = wrap(page.text, 8, pdfPage.getWidth() - 16), step = Math.min(10, (pdfPage.getHeight() - 16) / Math.max(lines.length, 1));
        lines.forEach((line, i) => { if (line) pdfPage.drawText(line, { font, size: Math.min(8, step * 0.85), x: 8, y: pdfPage.getHeight() - 8 - (i + 1) * step, opacity: 0 }); });
      }
    } else {
      let target = doc.addPage([595, 842]), y = 796;
      target.drawText(clean(`第 ${page.order + 1} 页 · 来源 ${page.sourcePage}`), { x: 44, y, font, size: 10, color: rgb(0.3, 0.4, 0.36) }); y -= 32;
      for (const line of wrap(page.text || '[未识别文字，需要人工检查]', 11, 507)) {
        if (y < 44) { target = doc.addPage([595, 842]); y = 796; }
        if (line) target.drawText(line, { x: 44, y, font, size: 11 }); y -= 18;
      }
    }
  }
  return doc.save();
}
export async function exportPdf(project: Project, mode: 'scan' | 'reflow', progress: (s: string) => void) {
  const bytes = await buildPdf(project, mode, progress);
  download(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), `${safeName(project.name)}-${mode}.pdf`);
}
export async function buildDocx(project: Project) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell } = await import('docx');
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];
  for (const page of ordered(project.pages)) {
    children.push(new Paragraph({ text: `第 ${page.order + 1} 页 · ${page.sourceName} / 原页 ${page.sourcePage}`, heading: HeadingLevel.HEADING_1, pageBreakBefore: page.order > 0 }));
    const analysis = page.results.findLast(r => r.analysis && r.text === page.text)?.analysis;
    if (analysis?.blocks.length) {
      for (const block of analysis.blocks) {
        if (block.kind === 'table' && block.rows.length && block.rows.some(r => r.length)) {
          const columns = Math.max(...block.rows.map(r => r.length));
          children.push(new Table({ rows: block.rows.map(row => new TableRow({ children: Array.from({ length: columns }, (_, i) => new TableCell({ children: [new Paragraph(row[i] ?? '')] })) })) }));
        } else children.push(new Paragraph({ text: block.text, heading: block.kind === 'heading' ? HeadingLevel.HEADING_2 : undefined }));
      }
    } else for (const line of (page.text || '[未识别文字，需要人工检查]').split('\n')) children.push(new Paragraph({ children: [new TextRun(line)] }));
    if (!page.reviewed) children.push(new Paragraph({ children: [new TextRun({ text: '需要人工检查：本页尚未标记为已核对。', color: 'A66A22' })] }));
  }
  const doc = new Document({ creator: 'AI Smart Scanner', title: project.name, sections: [{ children }] });
  return Packer.toBlob(doc);
}
export async function exportDocx(project: Project) { download(await buildDocx(project), `${safeName(project.name)}.docx`); }
