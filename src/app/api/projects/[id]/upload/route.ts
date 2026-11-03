import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorize, BUCKET } from '@/lib/server/supabase';
import { apiError, jsonBody, HttpError } from '@/lib/server/http';
import { uploadSchema } from '@/lib/validation';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params, { db } = await authorize(request, id);
    const input = await jsonBody(request, 2000);
    if (input.complete === true) {
      const { assetId } = z.object({ assetId: z.uuid() }).parse(input);
      const { data: asset, error } = await db.from('assets').select('*').eq('project_id', id).eq('id', assetId).single();
      if (error || !asset) throw new HttpError(404, '上传记录不存在');
      const { data: info, error: infoError } = await db.storage.from(BUCKET).info(asset.path);
      if (infoError || info.size !== Number(asset.size) || info.contentType !== asset.type) throw new HttpError(400, '文件上传不完整或类型不符，请重试');
      const { error: updateError } = await db.from('assets').update({ verified: true }).eq('project_id', id).eq('id', assetId);
      if (updateError) throw new HttpError(503, '无法确认上传结果');
      return NextResponse.json({ verified: true });
    }
    const { assetId, type, size } = uploadSchema.parse(input);
    const { error } = await db.rpc('reserve_asset', { p_project: id, p_id: assetId, p_type: type, p_size: size });
    if (error) throw new HttpError(400, '云端存储额度不足（每项目 512 MB），或文件记录不匹配');
    const { data: asset, error: readError } = await db.from('assets').select('verified,path').eq('project_id', id).eq('id', assetId).single();
    if (readError) throw new HttpError(503, '无法读取上传记录');
    if (asset.verified) return NextResponse.json({ exists: true });
    // A prior PUT may have completed even if the browser lost its response.
    const { data: info } = await db.storage.from(BUCKET).info(asset.path);
    if (info && info.size === size && info.contentType === type) {
      const { error: updateError } = await db.from('assets').update({ verified: true }).eq('project_id', id).eq('id', assetId);
      if (updateError) throw new HttpError(503, '无法确认上传记录');
      return NextResponse.json({ exists: true });
    }
    const { data, error: signError } = await db.storage.from(BUCKET).createSignedUploadUrl(asset.path, { upsert: false });
    if (signError) throw new HttpError(503, '生成上传签名失败');
    return NextResponse.json({ exists: false, url: data.signedUrl }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return apiError(e); }
}
