import { fullQuad, type ScanPage, type SourceFile } from '../types';
import { putAsset } from './storage';
import { imageCanvas, canvasBlob } from './images';
export async function importFiles(files: File[], start: number, progress: (text: string) => void) {
  const pages: ScanPage[] = [], sources: SourceFile[] = [];
  for (const file of files) {
    if (file.size > 30 * 1024 * 1024) throw new Error(`${file.name} 超过 30 MB，请拆分文件后重试`);
    const sourceId = crypto.randomUUID(), assetId = crypto.randomUUID();
    const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!pdf && !file.type.startsWith('image/')) throw new Error(`不支持 ${file.name}`);
    await putAsset({ id: assetId, blob: pdf ? new Blob([file], { type: 'application/pdf' }) : file, name: file.name });
    sources.push({ id: sourceId, name: file.name, type: pdf ? 'application/pdf' : file.type, assetId });
    const add = async (blob: Blob, sourcePage: number, width: number, height: number, originalId: string) => {
      if (start + pages.length >= 100) throw new Error('每个项目最多 100 页，请新建项目');
      if (originalId !== assetId) await putAsset({ id: originalId, blob, name: `${file.name}-${sourcePage}.jpg` });
      pages.push({ id: crypto.randomUUID(), sourceId, sourceName: file.name, sourcePage, order: start + pages.length, originalAssetId: originalId, processedAssetId: null, width, height, crop: fullQuad(), rotation: 0, text: '', results: [], revisions: [], reviewed: false });
    };
    if (pdf) {
      progress(`正在打开 ${file.name}`);
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
      const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: '/vendor/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/standard_fonts/', wasmUrl: '/vendor/pdfjs-wasm/', iccUrl: '/vendor/iccs/' });
      const doc = await task.promise;
      try {
        if (doc.numPages + start + pages.length > 100) throw new Error('PDF 页数超过项目剩余额度（100 页），请拆分后导入');
        for (let n = 1; n <= doc.numPages; n++) {
          progress(`${file.name} · 第 ${n}/${doc.numPages} 页`);
          const page = await doc.getPage(n), base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(2, 2200 / Math.max(base.width, base.height)) });
          const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, viewport }).promise;
          await add(await canvasBlob(canvas), n, canvas.width, canvas.height, crypto.randomUUID()); page.cleanup();
        }
      } finally { await task.destroy(); }
    } else {
      progress(`正在导入 ${file.name}`);
      const canvas = await imageCanvas(file);
      // Preserve the original file separately; normalized JPEG is the page working original.
      await add(await canvasBlob(canvas), 1, canvas.width, canvas.height, crypto.randomUUID());
    }
  }
  return { pages, sources };
}
