import { describe, expect, it } from 'vitest';
import { estimateCost, quadSchema, snapshotSchema } from '../src/lib/validation';
import { fullQuad, needsReview, newProject, ordered, type ScanPage } from '../src/lib/types';
describe('scan invariants', () => {
  it('accepts clockwise corners and rejects self-intersecting/degenerate crops', () => {
    expect(quadSchema.safeParse(fullQuad()).success).toBe(true);
    expect(quadSchema.safeParse([fullQuad()[0], fullQuad()[2], fullQuad()[1], fullQuad()[3]]).success).toBe(false);
    expect(quadSchema.safeParse(fullQuad().map(() => ({ x: 0, y: 0 }))).success).toBe(false);
  });
  it('does not confuse original page numbers with display order', () => {
    const pages = [{ sourcePage: 9, order: 1 }, { sourcePage: 10, order: 0 }] as ScanPage[];
    expect(ordered(pages).map(x => x.sourcePage)).toEqual([10, 9]);
    expect(pages[0].order).toBe(1);
  });
  it('never treats an unrecognized page as reviewed', () => {
    expect(needsReview({ reviewed: false, results: [] } as unknown as ScanPage)).toBe(true);
    expect(needsReview({ reviewed: false, results: [{ confidence: 99, review: [] }] } as unknown as ScanPage)).toBe(true);
  });
  it('validates project and source relationships', () => {
    const p = newProject();
    expect(snapshotSchema.safeParse(p).success).toBe(true);
    expect(snapshotSchema.safeParse({ ...p, name: '' }).success).toBe(false);
  });
  it('accounts for cached input separately without double charging', () => {
    expect(estimateCost(1000, 400, 200, { input: 2, cached: 0.5, output: 8 })).toBeCloseTo(0.003);
    expect(estimateCost(100, 200, 0, { input: 2, cached: 1, output: 8 })).toBeCloseTo(0.0001);
  });
});
