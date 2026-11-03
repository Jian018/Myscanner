import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fullQuad, type ScanPage } from '../src/lib/types';
let db: PGlite;
const pid = crypto.randomUUID(), source = crypto.randomUUID(), original = crypto.randomUUID(), sourceAsset = crypto.randomUUID();
const pages: ScanPage[] = [0, 1].map(order => ({ id: crypto.randomUUID(), sourceId: source, sourceName: 'test.pdf', sourcePage: order + 5, order, originalAssetId: original, processedAssetId: null, width: 100, height: 200, crop: fullQuad(), rotation: 0, text: '原文', results: [], revisions: [], reviewed: false }));
const snapshot = () => ({ name: 'Test', sources: [{ id: source, name: 'test.pdf', type: 'application/pdf', assetId: sourceAsset }], pages });
async function save(version: number, data = snapshot()) { return db.query('select public.save_project($1,$2,$3::jsonb) as version', [pid, version, JSON.stringify(data)]); }
beforeAll(async () => {
  db = new PGlite(); await db.waitReady;
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);");
  await db.exec(await readFile(new URL('../supabase/migrations/001_initial.sql', import.meta.url), 'utf8'));
  await db.query('insert into projects(id,name,token_hash) values($1,$2,$3)', [pid, 'Test', 'hash']);
  for (const id of [original,sourceAsset]) {
    await db.query("select reserve_asset($1,$2,'image/jpeg',100)", [pid,id]);
    await db.query('update assets set verified=true where project_id=$1 and id=$2', [pid,id]);
  }
});
afterAll(async () => { await db?.close(); });
describe('actual PostgreSQL migration', () => {
  it('creates a private bucket and denies anonymous database access', async () => {
    const bucket = await db.query<{ public: boolean }>('select public from storage.buckets'); expect(bucket.rows[0].public).toBe(false);
    await db.exec('set role anon');
    await expect(db.query('select * from public.projects')).rejects.toThrow(/permission denied/);
    await expect(db.query('select public.reserve_asset($1,$2,$3,$4)', [pid,crypto.randomUUID(),'image/jpeg',100])).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
  });
  it('saves atomically and reorders without changing original page numbers', async () => {
    expect((await save(0)).rows).toEqual([{ version: 1 }]);
    const swapped = { ...snapshot(), pages: pages.map(p => ({ ...p, order: 1 - p.order })) };
    await save(1, swapped);
    const result = await db.query<{ source_page: number }>('select source_page from pages where project_id=$1 order by position', [pid]);
    expect(result.rows.map(x => x.source_page)).toEqual([6,5]);
  });
  it('rejects stale saves and original replacement, rolling back changes', async () => {
    await expect(save(1)).rejects.toThrow('VERSION_CONFLICT');
    const invalid = { ...snapshot(), pages: pages.map(p => ({ ...p, originalAssetId: crypto.randomUUID() })) };
    await expect(save(2, invalid)).rejects.toThrow('PAGE_ORIGINAL_IMMUTABLE');
    expect((await db.query<{ version: number }>('select version from projects where id=$1',[pid])).rows[0].version).toBe(2);
    await expect(save(2, { ...snapshot(), pages: [] })).rejects.toThrow('ORIGINALS_PROTECTED');
  });
  it('preserves append-only human revision records', async () => {
    const revision = { id: crypto.randomUUID(), before: '原文', after: '修订', createdAt: new Date().toISOString() };
    const data = { ...snapshot(), pages: pages.map((p,i) => i ? p : { ...p, text: '修订', revisions: [revision] }) };
    await save(2, data);
    const tampered = { ...data, pages: data.pages.map((p,i) => i ? p : { ...p, revisions: [{ ...revision, after: '被改写' }] }) };
    await expect(save(3, tampered)).rejects.toThrow('REVISION_IMMUTABLE');
  });
  it('reserves calls before inference, deduplicates requests, and applies global daily cap', async () => {
    const call = crypto.randomUUID(), args = [call,pid,pages[0].id,'test-vision',JSON.stringify({input:1,cached:1,output:1}),1];
    await db.query('select reserve_ai($1,$2,$3,$4,$5,$6)', args);
    await expect(db.query('select reserve_ai($1,$2,$3,$4,$5,$6)', args)).rejects.toThrow('DUPLICATE_REQUEST');
    await expect(db.query('select reserve_ai($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(),...args.slice(1)])).rejects.toThrow('DAILY_LIMIT');
    const usage = await db.query<{ status:string; estimated_cost_usd:null }>('select status,estimated_cost_usd from api_calls where id=$1',[call]);
    expect(usage.rows[0]).toEqual({ status:'reserved',estimated_cost_usd:null });
  });
});
