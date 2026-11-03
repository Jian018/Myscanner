import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { HttpError, sameOrigin } from './http';
export const BUCKET = 'scanner-originals';
export function database() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, '请先配置 Supabase；本地扫描仍可使用');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export async function authorize(request: Request, id: string) {
  sameOrigin(request);
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, '项目不存在或访问凭证无效');
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, '需要有效的项目访问凭证');
  const db = database();
  const { data, error } = await db.from('projects').select('*').eq('id', id).maybeSingle();
  if (error) throw new HttpError(503, '数据库尚未就绪，请运行迁移 SQL');
  if (!data || !timingSafeEqual(Buffer.from(hashToken(token)), Buffer.from(data.token_hash))) throw new HttpError(404, '项目不存在或访问凭证无效');
  return { db, project: data };
}
