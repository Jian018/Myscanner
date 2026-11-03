-- Run once in a new Supabase project. No public table/Storage policies.
begin;
create table public.projects (
  id uuid primary key default gen_random_uuid(), name text not null,
  token_hash text not null, version integer not null default 0,
  snapshot jsonb not null default '{"name":"未命名扫描项目","sources":[],"pages":[]}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.assets (
  project_id uuid not null references public.projects(id), id uuid not null,
  path text not null unique, type text not null, size bigint not null check(size > 0 and size <= 31457280),
  verified boolean not null default false, created_at timestamptz not null default now(), primary key(project_id,id)
);
create table public.source_files (
  id uuid primary key, project_id uuid not null references public.projects(id),
  asset_id uuid not null, name text not null, type text not null,
  unique(project_id,id), foreign key(project_id,asset_id) references public.assets(project_id,id)
);
create table public.pages (
  id uuid primary key, project_id uuid not null references public.projects(id), source_id uuid not null,
  source_page integer not null check(source_page > 0), position integer not null check(position >= 0),
  original_asset_id uuid not null, processed_asset_id uuid, payload jsonb not null,
  unique(project_id,id), unique(project_id,position) deferrable initially deferred,
  foreign key(project_id,source_id) references public.source_files(project_id,id),
  foreign key(project_id,original_asset_id) references public.assets(project_id,id),
  foreign key(project_id,processed_asset_id) references public.assets(project_id,id)
);
create table public.ocr_results (
  id uuid primary key, project_id uuid not null, page_id uuid not null,
  engine text not null check(engine in ('tesseract','openai')), payload jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(project_id,page_id) references public.pages(project_id,id)
);
create table public.revisions (
  id uuid primary key, project_id uuid not null, page_id uuid not null,
  before_text text not null, after_text text not null, created_at timestamptz not null default now(),
  foreign key(project_id,page_id) references public.pages(project_id,id)
);
create table public.api_calls (
  id uuid primary key, project_id uuid not null, page_id uuid not null,
  model text not null, status text not null default 'reserved',
  input_tokens integer, cached_tokens integer, output_tokens integer,
  estimated_cost_usd numeric(16,8), rates jsonb not null, error text, provider_response_id text,
  result jsonb, created_at timestamptz not null default now(), finished_at timestamptz,
  foreign key(project_id,page_id) references public.pages(project_id,id)
);
create index api_calls_created_at on public.api_calls(created_at);
create index ocr_results_page on public.ocr_results(project_id,page_id);
create index revisions_page on public.revisions(project_id,page_id);
alter table public.projects enable row level security;
alter table public.assets enable row level security;
alter table public.source_files enable row level security;
alter table public.pages enable row level security;
alter table public.ocr_results enable row level security;
alter table public.revisions enable row level security;
alter table public.api_calls enable row level security;
revoke all on public.projects, public.assets, public.source_files, public.pages, public.ocr_results, public.revisions, public.api_calls from anon, authenticated;
grant all on public.projects, public.assets, public.source_files, public.pages, public.ocr_results, public.revisions, public.api_calls to service_role;

-- All calls run with service_role from server-only code; never expose these functions to anon.
create function public.reserve_asset(p_project uuid, p_id uuid, p_type text, p_size bigint)
returns void language plpgsql set search_path = public as $$
declare a assets;
begin
  perform 1 from projects where id=p_project for update;
  select * into a from assets where project_id=p_project and id=p_id;
  if found then
    if a.type <> p_type or a.size <> p_size then raise exception 'ASSET_IMMUTABLE'; end if;
    return;
  end if;
  if (select coalesce(sum(size),0) from assets where project_id=p_project) + p_size > 536870912
     or (select count(*) from assets where project_id=p_project) >= 1000 then raise exception 'STORAGE_LIMIT'; end if;
  insert into assets(project_id,id,path,type,size) values(p_project,p_id,p_project::text || '/' || p_id::text,p_type,p_size);
end $$;

create function public.save_project(p_project uuid, p_version integer, p_snapshot jsonb)
returns integer language plpgsql set search_path = public as $$
declare v integer; s jsonb; p jsonb; r jsonb;
begin
  select version into v from projects where id=p_project for update;
  if v is null then raise exception 'NOT_FOUND'; end if;
  if v <> p_version then raise exception 'VERSION_CONFLICT'; end if;
  -- No removal of sources or pages in phase one. Originals remain reachable.
  if exists(select 1 from pages x where x.project_id=p_project and not exists(select 1 from jsonb_array_elements(p_snapshot->'pages') y where (y->>'id')::uuid=x.id))
     or exists(select 1 from source_files x where x.project_id=p_project and not exists(select 1 from jsonb_array_elements(p_snapshot->'sources') y where (y->>'id')::uuid=x.id)) then raise exception 'ORIGINALS_PROTECTED'; end if;
  for s in select * from jsonb_array_elements(p_snapshot->'sources') loop
    if not exists(select 1 from assets where project_id=p_project and id=(s->>'assetId')::uuid and verified) then raise exception 'ASSET_NOT_UPLOADED'; end if;
    if exists(select 1 from source_files where id=(s->>'id')::uuid and (project_id<>p_project or asset_id<>(s->>'assetId')::uuid)) then raise exception 'SOURCE_IMMUTABLE'; end if;
    insert into source_files(id,project_id,asset_id,name,type) values((s->>'id')::uuid,p_project,(s->>'assetId')::uuid,s->>'name',s->>'type') on conflict(id) do nothing;
  end loop;
  for p in select * from jsonb_array_elements(p_snapshot->'pages') loop
    if exists(select 1 from pages where id=(p->>'id')::uuid and (project_id<>p_project or original_asset_id<>(p->>'originalAssetId')::uuid or source_id<>(p->>'sourceId')::uuid or source_page<>(p->>'sourcePage')::integer)) then raise exception 'PAGE_ORIGINAL_IMMUTABLE'; end if;
    if not exists(select 1 from assets where project_id=p_project and id=(p->>'originalAssetId')::uuid and verified)
       or (p->>'processedAssetId' is not null and not exists(select 1 from assets where project_id=p_project and id=(p->>'processedAssetId')::uuid and verified)) then raise exception 'ASSET_NOT_UPLOADED'; end if;
    insert into pages(id,project_id,source_id,source_page,position,original_asset_id,processed_asset_id,payload)
    values((p->>'id')::uuid,p_project,(p->>'sourceId')::uuid,(p->>'sourcePage')::integer,(p->>'order')::integer,(p->>'originalAssetId')::uuid,(p->>'processedAssetId')::uuid,p)
    on conflict(id) do update set position=excluded.position,processed_asset_id=excluded.processed_asset_id,payload=excluded.payload;
    for r in select * from jsonb_array_elements((p->'results') || coalesce(p->'archivedResults','[]'::jsonb)) loop
      if exists(select 1 from ocr_results where id=(r->>'id')::uuid and (project_id<>p_project or page_id<>(p->>'id')::uuid or payload<>r)) then raise exception 'OCR_IMMUTABLE'; end if;
      insert into ocr_results(id,project_id,page_id,engine,payload,created_at) values((r->>'id')::uuid,p_project,(p->>'id')::uuid,r->>'engine',r,(r->>'createdAt')::timestamptz) on conflict(id) do nothing;
    end loop;
    for r in select * from jsonb_array_elements(p->'revisions') loop
      if exists(select 1 from revisions where id=(r->>'id')::uuid and (project_id<>p_project or page_id<>(p->>'id')::uuid or before_text<>r->>'before' or after_text<>r->>'after')) then raise exception 'REVISION_IMMUTABLE'; end if;
      insert into revisions(id,project_id,page_id,before_text,after_text,created_at) values((r->>'id')::uuid,p_project,(p->>'id')::uuid,r->>'before',r->>'after',(r->>'createdAt')::timestamptz) on conflict(id) do nothing;
    end loop;
  end loop;
  update projects set snapshot=p_snapshot, name=p_snapshot->>'name',version=v+1,updated_at=now() where id=p_project;
  return v+1;
end $$;

create function public.reserve_ai(p_id uuid,p_project uuid,p_page uuid,p_model text,p_rates jsonb,p_limit integer)
returns void language plpgsql set search_path = public as $$
begin
  -- Global, UTC-day reservation: prevents parallel requests and new projects bypassing the cap.
  perform pg_advisory_xact_lock(91827123);
  if exists(select 1 from api_calls where id=p_id) then raise exception 'DUPLICATE_REQUEST'; end if;
  if (select count(*) from api_calls where created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') >= p_limit then raise exception 'DAILY_LIMIT'; end if;
  insert into api_calls(id,project_id,page_id,model,rates) values(p_id,p_project,p_page,p_model,p_rates);
end $$;
revoke all on function public.reserve_asset(uuid,uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.save_project(uuid,integer,jsonb) from public,anon,authenticated;
revoke all on function public.reserve_ai(uuid,uuid,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.reserve_asset(uuid,uuid,text,bigint) to service_role;
grant execute on function public.save_project(uuid,integer,jsonb) to service_role;
grant execute on function public.reserve_ai(uuid,uuid,uuid,text,jsonb,integer) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('scanner-originals','scanner-originals',false,31457280,array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict(id) do nothing;
commit;
