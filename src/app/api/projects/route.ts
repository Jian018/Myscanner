import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { database, hashToken } from '@/lib/server/supabase';
import { apiError, jsonBody, HttpError } from '@/lib/server/http';
export async function POST(request: Request) {
  try {
    const { name } = z.object({ name: z.string().trim().min(1).max(150) }).parse(await jsonBody(request, 1000));
    const token = randomBytes(32).toString('hex');
    const { data, error } = await database().from('projects').insert({ name, token_hash: hashToken(token), snapshot: { name, sources: [], pages: [] } }).select('id,version').single();
    if (error) throw new HttpError(503, '无法创建项目，请先运行 Supabase 迁移 SQL');
    return NextResponse.json({ ...data, token }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return apiError(e); }
}
