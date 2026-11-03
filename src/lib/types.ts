export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];
export type Word = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
export type Analysis = {
  text: string;
  blocks: { kind: 'heading' | 'paragraph' | 'table' | 'image'; text: string; rows: string[][] }[];
  review: string[];
};
export type OcrResult = {
  id: string; engine: 'tesseract' | 'openai'; text: string; confidence: number | null;
  words: Word[]; review: string[]; analysis?: Analysis; createdAt: string;
};
export type Revision = { id: string; before: string; after: string; createdAt: string };
export type ScanPage = {
  id: string; sourceId: string; sourceName: string; sourcePage: number; order: number;
  originalAssetId: string; processedAssetId: string | null; width: number; height: number;
  crop: Quad; rotation: number; text: string; results: OcrResult[]; revisions: Revision[];
  reviewed: boolean; archivedResults?: OcrResult[];
};
export type SourceFile = { id: string; name: string; type: string; assetId: string };
export type Usage = { id: string; pageId: string; model: string; status: string; inputTokens: number | null; cachedTokens: number | null; outputTokens: number | null; cost: number | null; createdAt: string };
export type Project = {
  id: string; name: string; createdAt: string; updatedAt: string; pages: ScanPage[]; sources: SourceFile[];
  cloud: { id: string; token: string; version: number } | null; usage: Usage[];
};
export type Asset = { id: string; blob: Blob; name: string };
export const fullQuad = (): Quad => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
export function newProject(): Project {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name: '未命名扫描项目', createdAt: now, updatedAt: now, pages: [], sources: [], cloud: null, usage: [] };
}
export function ordered(pages: ScanPage[]) { return [...pages].sort((a, b) => a.order - b.order); }
export function needsReview(page: ScanPage) {
  return !page.reviewed;
}
