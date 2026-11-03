import { z } from 'zod';
const uuid = z.uuid();
const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export const quadSchema = z.tuple([point, point, point, point]).refine(q => {
  const cross = q.map((p, i) => {
    const b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    return (b.x - p.x) * (c.y - b.y) - (b.y - p.y) * (c.x - b.x);
  });
  return cross.every(n => n > 0.0001);
}, '扫描范围需要是顺时针排列的凸四边形，且面积不能过小');
export const analysisSchema = z.object({
  text: z.string().max(100000),
  blocks: z.array(z.object({ kind: z.enum(['heading', 'paragraph', 'table', 'image']), text: z.string(), rows: z.array(z.array(z.string())) })).max(1000),
  review: z.array(z.string()).max(1000)
});
const word = z.object({ text: z.string(), confidence: z.number(), bbox: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }) });
const result = z.object({ id: uuid, engine: z.enum(['tesseract', 'openai']), text: z.string().max(100000), confidence: z.number().nullable(), words: z.array(word).max(30000), review: z.array(z.string()), analysis: analysisSchema.optional(), createdAt: z.iso.datetime() });
const revision = z.object({ id: uuid, before: z.string().max(100000), after: z.string().max(100000), createdAt: z.iso.datetime() });
export const pageSchema = z.object({
  id: uuid, sourceId: uuid, sourceName: z.string().max(300), sourcePage: z.number().int().positive(), order: z.number().int().min(0),
  originalAssetId: uuid, processedAssetId: uuid.nullable(), width: z.number().int().positive().max(10000), height: z.number().int().positive().max(10000),
  crop: quadSchema, rotation: z.number().int().min(0).max(270).multipleOf(90), text: z.string().max(100000),
  results: z.array(result).max(100), archivedResults: z.array(result).max(500).optional(), revisions: z.array(revision).max(500), reviewed: z.boolean()
});
export const snapshotSchema = z.object({
  name: z.string().trim().min(1).max(150),
  sources: z.array(z.object({ id: uuid, name: z.string().max(300), type: z.string().max(100), assetId: uuid })).max(100),
  pages: z.array(pageSchema).max(100)
}).superRefine((p, ctx) => {
  const ids = new Set(p.pages.map(x => x.id));
  const orders = new Set(p.pages.map(x => x.order));
  const sources = new Set(p.sources.map(x => x.id));
  if (ids.size !== p.pages.length || orders.size !== p.pages.length || sources.size !== p.sources.length || p.pages.some(x => !sources.has(x.sourceId))) {
    ctx.addIssue({ code: 'custom', message: '页面、顺序或来源无效' });
  }
});
export const uploadSchema = z.object({ assetId: uuid, type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']), size: z.number().int().positive().max(30 * 1024 * 1024) });
export const analyzeSchema = z.object({ pageId: uuid, requestId: uuid, consent: z.literal(true) });
export function estimateCost(input: number, cached: number, output: number, rates: { input: number; cached: number; output: number }) {
  return ((input - Math.min(input, cached)) * rates.input + Math.min(input, cached) * rates.cached + output * rates.output) / 1_000_000;
}
