import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorize, BUCKET } from '@/lib/server/supabase';
import { apiError, jsonBody, HttpError } from '@/lib/server/http';
import { snapshotSchema } from '@/lib/validation';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { db, project } = await authorize(request, id);
    const [{ data: assets, error }, { data: calls, error: callsError }] = await Promise.all([
      db.from('assets').select('id,path,type').eq('project_id', id).eq('verified', true),
      db.from('api_calls').select('id,page_id,model,status,input_tokens,cached_tokens,output_tokens,estimated_cost_usd,created_at').eq('project_id', id).order('created_at', { ascending: false }).limit(500)
    ]);
    if (error || callsError) throw new HttpError(503, '读取云端数据失败');
    const files = await Promise.all((assets ?? []).map(async a => {
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(a.path, 900);
      if (error) throw new HttpError(503, '读取文件签名失败');
      return { id: a.id, type: a.type, url: data.signedUrl };
    }));
    return NextResponse.json({ snapshot: project.snapshot, version: project.version, createdAt: project.created_at, updatedAt: project.updated_at, assets: files, usage: (calls ?? []).map(c => ({ id: c.id, pageId: c.page_id, model: c.model, status: c.status, inputTokens: c.input_tokens, cachedTokens: c.cached_tokens, outputTokens: c.output_tokens, cost: c.estimated_cost_usd === null ? null : Number(c.estimated_cost_usd), createdAt: c.created_at })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return apiError(e); }
}
export async function PUT(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const { db } = await authorize(request, id);
    const { version, snapshot } = z.object({ version: z.number().int().min(0), snapshot: snapshotSchema }).parse(await jsonBody(request));
    const { data, error } = await db.rpc('save_project', { p_project: id, p_version: version, p_snapshot: snapshot });
    if (error) {
      if (error.message.includes('VERSION_CONFLICT')) throw new HttpError(409, '云端有更新，请先备份本机文本，再重新载入云端项目');
      throw new HttpError(400, '保存失败：文件未完整上传，或原件/历史记录校验不通过');
    }
    return NextResponse.json({ version: data });
  } catch (e) { return apiError(e); }
}
