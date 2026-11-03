import { openDB } from 'idb';
import type { Asset, Project } from '../types';
const db = () => openDB('smart-scanner-v1', 1, { upgrade(db) {
  db.createObjectStore('projects', { keyPath: 'id' });
  db.createObjectStore('assets', { keyPath: 'id' });
} });
export async function putAsset(asset: Asset) { await (await db()).put('assets', asset); }
export async function getAsset(id: string): Promise<Asset> {
  const asset = await (await db()).get('assets', id);
  if (!asset) throw new Error('本地原件不存在，请从云端重新载入');
  return asset;
}
export async function saveProject(project: Project) { await (await db()).put('projects', project); }
export async function listProjects(): Promise<Project[]> {
  return (await (await db()).getAll('projects')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
