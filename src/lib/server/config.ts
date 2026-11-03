import 'server-only';
export const cloudConfigured = () => !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY));
export function aiConfig() {
  const rate = (key: string) => { const raw = process.env[key]; return raw?.trim() ? Number(raw) : NaN; };
  const rates = { input: rate('OPENAI_INPUT_USD_PER_MILLION'), cached: rate('OPENAI_CACHED_INPUT_USD_PER_MILLION'), output: rate('OPENAI_OUTPUT_USD_PER_MILLION') };
  const limit = Number(process.env.AI_DAILY_LIMIT || '20');
  const enabled = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) && cloudConfigured() && Object.values(rates).every(x => Number.isFinite(x) && x >= 0) && Number.isInteger(limit) && limit > 0 && limit <= 1000;
  return { enabled, model: process.env.OPENAI_MODEL || '', rates, limit };
}
