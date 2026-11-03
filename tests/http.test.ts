import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonBody, apiError, HttpError } from '../src/lib/server/http';
import { aiConfig } from '../src/lib/server/config';
afterEach(() => vi.unstubAllEnvs());
describe('server request boundaries', () => {
  it('rejects cross-origin requests and oversized streamed bodies', async () => {
    await expect(jsonBody(new Request('https://scanner.test/api/projects', { method: 'POST', headers: { Origin: 'https://attacker.test', 'Content-Type': 'application/json' }, body: '{}' }))).rejects.toMatchObject({ status: 403 });
    await expect(jsonBody(new Request('https://scanner.test/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"long":"1234567890"}' }), 5)).rejects.toMatchObject({ status: 413 });
  });
  it('rejects invalid JSON and hides internal errors', async () => {
    await expect(jsonBody(new Request('https://scanner.test/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }))).rejects.toMatchObject({ status: 400 });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = apiError(new Error('secret-provider-key'));
    expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain('secret-provider-key'); spy.mockRestore();
    expect(apiError(new HttpError(409, '版本冲突')).status).toBe(409);
  });
  it('keeps AI disabled until model, storage and all prices are configured', () => {
    for (const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','OPENAI_API_KEY','OPENAI_MODEL']) vi.stubEnv(key, 'configured');
    vi.stubEnv('OPENAI_INPUT_USD_PER_MILLION', ''); vi.stubEnv('OPENAI_CACHED_INPUT_USD_PER_MILLION', ''); vi.stubEnv('OPENAI_OUTPUT_USD_PER_MILLION', '');
    expect(aiConfig().enabled).toBe(false);
    for (const key of ['OPENAI_INPUT_USD_PER_MILLION','OPENAI_CACHED_INPUT_USD_PER_MILLION','OPENAI_OUTPUT_USD_PER_MILLION']) vi.stubEnv(key, '1');
    expect(aiConfig().enabled).toBe(true);
    vi.stubEnv('AI_DAILY_LIMIT', '-1'); expect(aiConfig().enabled).toBe(false);
  });
});
