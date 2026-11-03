import type { Project, Usage } from '../types';
import { snapshotSchema } from '../validation';
import { getAsset, putAsset } from './storage';
export async function api<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers }, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data as T;
}
export async function createCloud(project: Project) {
  return api<NonNullable<Project['cloud']>>('/api/projects', { method: 'POST', body: JSON.stringify({ name: project.name }) });
}
export async function saveCloud(project: Project, progress: (s: string) => void) {
  if (!project.cloud) throw new Error('项目尚未创建');
  const snapshot = snapshotSchema.parse(project);
  const ids = [...new Set([...project.sources.map(s => s.assetId), ...project.pages.flatMap(p => [p.originalAssetId, ...(p.processedAssetId ? [p.processedAssetId] : [])])])];
  const base = `/api/projects/${project.cloud.id}`, token = project.cloud.token;
  for (const [i, id] of ids.entries()) {
    progress(`云端保存 · 文件 ${i + 1}/${ids.length}`);
    const { blob } = await getAsset(id);
    const signed = await api<{ exists: boolean; url?: string }>(`${base}/upload`, { method: 'POST', body: JSON.stringify({ assetId: id, type: blob.type, size: blob.size }) }, token);
    if (!signed.exists) {
      const response = await fetch(signed.url!, { method: 'PUT', headers: { 'Content-Type': blob.type, 'x-upsert': 'false' }, body: blob });
      if (!response.ok) throw new Error('文件上传失败，原图仍保存在本机，可稍后重试');
      await api(`${base}/upload`, { method: 'POST', body: JSON.stringify({ assetId: id, complete: true }) }, token);
    }
  }
  return api<{ version: number }>(base, { method: 'PUT', body: JSON.stringify({ version: project.cloud.version, snapshot }) }, token);
}
export async function loadCloud(id: string, token: string, progress: (s: string) => void): Promise<Project> {
  if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(token)) throw new Error('项目 ID 或访问凭证格式不正确');
  const data = await api<{ snapshot: unknown; version: number; createdAt: string; updatedAt: string; usage: Usage[]; assets: { id: string; type: string; url: string }[] }>(`/api/projects/${id}`, {}, token);
  const snapshot = snapshotSchema.parse(data.snapshot);
  const needed = new Set([...snapshot.sources.map(s => s.assetId), ...snapshot.pages.flatMap(p => [p.originalAssetId, ...(p.processedAssetId ? [p.processedAssetId] : [])])]);
  for (const [i, asset] of data.assets.filter(a => needed.has(a.id)).entries()) {
    progress(`载入云端 · 文件 ${i + 1}/${needed.size}`);
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error('云端文件下载失败，请稍后重试');
    await putAsset({ id: asset.id, blob: new Blob([await response.arrayBuffer()], { type: asset.type }), name: asset.id });
  }
  if (data.assets.filter(a => needed.has(a.id)).length !== needed.size) throw new Error('云端项目缺少文件，未覆盖本机项目');
  return { ...snapshot, id, createdAt: data.createdAt, updatedAt: data.updatedAt, cloud: { id, token, version: data.version }, usage: data.usage };
}
