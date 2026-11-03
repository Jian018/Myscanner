import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fullQuad } from '../src/lib/types';
const mocks = vi.hoisted(() => ({ create: vi.fn(), reserve: vi.fn(), logs: [] as Record<string, unknown>[], pageId: '00000000-0000-4000-8000-000000000001' }));
vi.mock('openai', () => {
  class APIError extends Error { status = 400; }
  class OpenAI { static APIError = APIError; responses = { create: mocks.create }; }
  return { default: OpenAI };
});
vi.mock('../src/lib/server/config', () => ({ aiConfig: () => ({ enabled: true, model: 'test-vision', rates: { input: 1, cached: 0.5, output: 2 }, limit: 20 }) }));
vi.mock('../src/lib/server/supabase', () => ({ BUCKET: 'scanner-originals', authorize: async () => ({ db: {
  rpc: mocks.reserve,
  storage: { from: () => ({ download: async () => ({ data: new Blob(['image'], { type: 'image/jpeg' }), error: null }) }) },
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query,
      update: (data: Record<string,unknown>) => { mocks.logs.push(data); return query; },
      single: async () => ({ data: table === 'pages' ? { payload: { id: mocks.pageId, sourceId: mocks.pageId, sourceName: 'test.jpg', sourcePage: 1, order: 0, originalAssetId: mocks.pageId, processedAssetId: null, width: 100, height: 100, crop: fullQuad(), rotation: 0, text: '', results: [], revisions: [], reviewed: false } } : { path: 'test/image', type: 'image/jpeg', size: 5 }, error: null }),
      then: (resolve: (data: { error:null }) => void) => Promise.resolve(resolve({ error: null }))
    }; return query;
  }
} }) }));
import { POST } from '../src/app/api/projects/[id]/analyze/route';
function request(consent = true) { return new Request('https://scanner.test/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageId: mocks.pageId, requestId: crypto.randomUUID(), consent }) }); }
const context = { params: Promise.resolve({ id: mocks.pageId }) };
beforeEach(() => { mocks.logs.length = 0; mocks.create.mockReset(); mocks.reserve.mockReset().mockResolvedValue({ error: null }); });
describe('AI consent and billing boundaries', () => {
  it('does not call the provider without explicit consent', async () => {
    expect((await POST(request(false),context)).status).toBe(400); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it('records tokens and costs even if the model output is refused or invalid', async () => {
    mocks.create.mockResolvedValue({ id: 'response-test', status: 'completed', output_text: 'invalid JSON', usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 200 }, output_tokens: 100 } });
    expect((await POST(request(),context)).status).toBe(502);
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
    expect(mocks.logs[0]).toMatchObject({ status: 'invalid_output', input_tokens: 1000, cached_tokens: 200, output_tokens: 100, estimated_cost_usd: 0.0011 });
  });
  it('preserves unknown cost on timeouts and makes no automatic retry', async () => {
    mocks.create.mockRejectedValue(new Error('timeout'));
    expect((await POST(request(),context)).status).toBe(502);
    expect(mocks.logs[0]).toMatchObject({ status: 'unknown' }); expect(mocks.logs[0]).not.toHaveProperty('estimated_cost_usd',0); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it('does not call OpenAI when the persistent budget reservation fails', async () => {
    mocks.reserve.mockResolvedValue({ error: { message: 'DAILY_LIMIT' } });
    expect((await POST(request(),context)).status).toBe(429); expect(mocks.create).not.toHaveBeenCalled();
  });
});
