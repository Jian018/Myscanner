import type { OcrResult, ScanPage, Word } from '../types';
import { getAsset } from './storage';
export async function recognizePages(pages: ScanPage[], language: string, onProgress: (message: string) => void, onResult: (pageId: string, result: OcrResult) => Promise<void>) {
  const { createWorker, OEM } = await import('tesseract.js');
  let label = '';
  const worker = await createWorker(language, OEM.LSTM_ONLY, {
    workerPath: '/vendor/tesseract-worker.min.js', corePath: '/vendor/tesseract-core',
    logger: m => onProgress(`${label} · ${m.status} ${Math.round(m.progress * 100)}%`)
  });
  try {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]; label = `识别 ${i + 1}/${pages.length}`;
      const asset = await getAsset(page.processedAssetId ?? page.originalAssetId);
      const { data } = await worker.recognize(asset.blob, {}, { text: true, blocks: true });
      const words: Word[] = (data.blocks ?? []).flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words.map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })))));
      const uncertain = words.filter(w => w.confidence < 75 && w.text.trim()).map(w => `${w.text}（${Math.round(w.confidence)}%）`);
      const review = uncertain.length ? [`需要人工检查：${uncertain.slice(0, 80).join('、')}${uncertain.length > 80 ? '…' : ''}`] : [];
      if (!data.text.trim()) review.push('需要人工检查：未识别到文字，可能为空白、模糊或语言不匹配');
      if (data.confidence < 75) review.push(`需要人工检查：整页置信度 ${Math.round(data.confidence)}%`);
      await onResult(page.id, { id: crypto.randomUUID(), engine: 'tesseract', text: data.text, confidence: data.confidence, words, review, createdAt: new Date().toISOString() });
    }
  } finally { await worker.terminate(); }
}
