import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fullQuad, newProject, type Project } from '../src/lib/types';
import { buildPdf, buildDocx } from '../src/lib/client/export';
const project: Project = { ...newProject(), pages: [0,1].map(i => ({ id: crypto.randomUUID(), sourceId: crypto.randomUUID(), sourceName: 'source.pdf', sourcePage: i + 8, order: 1 - i, originalAssetId: crypto.randomUUID(), processedAssetId: null, width: 600, height: 800, crop: fullQuad(), rotation: 0, text: i ? '原始第九页：人工修订已保存。' : '原始第八页：需要人工检查。', results: [], revisions: [], reviewed: false })) };
describe('actual export round trips', () => {
  it('exports searchable Chinese in current display order with a valid complete font', async () => {
    const font = await readFile(new URL('../public/fonts/NotoSansSC-Regular.ttf', import.meta.url));
    vi.stubGlobal('fetch', async () => new Response(font));
    try {
      const bytes = await buildPdf(project, 'reflow', () => {});
      const task = getDocument({ data: bytes }); const pdf = await task.promise;
      expect(pdf.numPages).toBe(2);
      const first = await (await pdf.getPage(1)).getTextContent();
      expect(first.items.map(x => 'str' in x ? x.str : '').join('')).toContain('原始第九页：人工修订已保存。');
      await task.destroy();
      const { PDFDocument, PDFRawStream, decodePDFRawStream } = await import('pdf-lib');
      const parsed = await PDFDocument.load(await buildPdf(project, 'reflow', () => {}));
      const fontkit = (await import('@pdf-lib/fontkit')).default;
      const validFonts = parsed.context.enumerateIndirectObjects().flatMap(([,o]) => o instanceof PDFRawStream ? [decodePDFRawStream(o).decode()] : []).filter(b => b.byteLength > 5_000_000);
      expect(validFonts.length).toBe(1);
      // A broken subset has no cmap or corrupt glyph offsets despite searchable text.
      const embedded = fontkit.create(validFonts[0]);
      expect(embedded.glyphForCodePoint('文'.codePointAt(0)!).path.toSVG().length).toBeGreaterThan(30);
    } finally { vi.unstubAllGlobals(); }
  });
  it('exports current edited text and review state into real editable DOCX XML', async () => {
    const blob = await buildDocx(project), files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const xml = strFromU8(files['word/document.xml']);
    expect(xml).toContain('人工修订已保存'); expect(xml).toContain('需要人工检查');
    expect(xml.indexOf('原始第九页')).toBeLessThan(xml.indexOf('原始第八页'));
  });
});
