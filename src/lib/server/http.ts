import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, '不允许跨站请求');
}
export async function jsonBody(request: Request, limit = 3_500_000) {
  sameOrigin(request);
  if (!request.headers.get('content-type')?.includes('application/json')) throw new HttpError(415, '需要 JSON 请求');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '请求为空');
  let length = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); throw new HttpError(413, '项目数据过大，请拆分项目'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'JSON 格式无效'); }
}
export function apiError(error: unknown) {
  if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ error: '输入无效', details: error.issues.map(x => x.message).slice(0, 5) }, { status: 400 });
  // Do not expose provider responses, SQL errors, signed URLs or credentials.
  console.error('scanner_api_error', error instanceof Error ? error.name : 'unknown');
  return NextResponse.json({ error: '服务暂时不可用，请检查服务器配置后重试' }, { status: 500 });
}
