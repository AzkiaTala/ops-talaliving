-- 0175_core_upload_read_write.sql — every upload failed with
-- `cannot execute INSERT in a read-only transaction` (F169, D319).
--
-- ── Why ───────────────────────────────────────────────────────────────────
--
-- PostgREST runs a function declared `stable` or `immutable` inside a
-- **read-only transaction**, POST or not — the volatility is its promise that
-- nothing is written. `ops_core.drive_folder_for` (0035, 0036, 0172) was
-- declared `stable`, and it returns its answer through `ops_core.ok()` /
-- `invalid()`, which write the audit row (0003). So the first thing the upload
-- route asks — *which drive does this go in* — died on its own audit insert,
-- and **no file has ever been uploaded**: on 2026-09-28 production held 326
-- link attachments, zero files, and every `drive_folders.folder_id` still null.
--
-- The smoke suite could not see it. It calls the function from psql inside an
-- ordinary read-write transaction, where a stable function calling a volatile
-- one is allowed. Only PostgREST sets `transaction read only`, so only the app
-- met it. `smoke/175_core_upload_read_write.sql` now calls every such seam the
-- way PostgREST does.
--
-- The same mistake sat in four more seams reached from the browser:
--
--   * `ops_prod.item_trail`, `ops_prod.job_trail` — answer through `ok()`, so
--     they failed on **every** call, not only on a refusal;
--   * `ops_procure.item_purchases`, `ops_inv.product_stock` — answer rows, but
--     refuse through `refused()` / `not_found()`, so a refusal arrived as a 500
--     about a read-only transaction instead of the refusal.
--
-- A function that writes the trail is volatile. `ops_acct.account_guard` and
-- `ops_inv.asset_refs_invalid` are left alone: they are not granted to
-- `authenticated`, so they are only ever called from inside volatile seams.
--
-- ── What Supabase keeps about a file ──────────────────────────────────────
--
-- `attach_file` recorded the Drive file id and nothing else: not the link
-- people open, not which shared drive or task folder it went in. "Did the KTP
-- go to HRD" could only be answered by opening Drive. Now the row carries
--
--   * `web_view_link` — the link Drive itself returned for the file;
--   * `drive_slug`    — the shared drive, **decided here** from the kind
--                       (`doc_kind_drive`), never taken from the caller;
--   * `drive_path`    — the task folder under OPS (`drive_path_for`, 0172);
--   * `drive_folder_id` — the folder the route actually uploaded into.
--
-- All four are null for rows filed before this and for links (`url`).

alter function ops_core.drive_folder_for(text, text) volatile;
alter function ops_prod.item_trail(text) volatile;
alter function ops_prod.job_trail(text) volatile;
alter function ops_procure.item_purchases(text, integer) volatile;
alter function ops_inv.product_stock(text) volatile;

-- ── the columns ───────────────────────────────────────────────────────────

alter table ops_core.attachments
  add column if not exists web_view_link   text,
  add column if not exists drive_slug      text references ops_core.drive_folders(slug) on update cascade,
  add column if not exists drive_path      text,
  add column if not exists drive_folder_id text;

alter table ops_core.attachments
  drop constraint if exists drive_fields_for_files,
  add constraint drive_fields_for_files check (
    storage_path is not null
    or (web_view_link is null and drive_slug is null and drive_path is null and drive_folder_id is null));

alter table ops_core.attachments
  drop constraint if exists web_view_link_is_drive,
  add constraint web_view_link_is_drive check (
    web_view_link is null or web_view_link ~ '^https://(drive|docs)\.google\.com/');

comment on column ops_core.attachments.web_view_link is
  'The link Google Drive returned for the uploaded file (webViewLink). Opened by people; '
  'the file''s identity is still storage_path. (0175)';
comment on column ops_core.attachments.drive_slug is
  'The shared drive the file was filed in, decided by the database from the kind '
  '(doc_kind_drive), never by the caller. (0175)';
comment on column ops_core.attachments.drive_path is
  'The task folder under the drive''s OPS folder, e.g. INVENTORY/ITEMS (0172). (0175)';
comment on column ops_core.attachments.drive_folder_id is
  'The Drive folder the upload route put the file in — the last segment of drive_path. (0175)';

-- ── attach_file, knowing where the file went ──────────────────────────────
--
-- Dropped, not replaced: new parameters with defaults would be a second
-- signature and every existing call would match both (00_no_overloads). The
-- new ones are appended, so the positional calls in the smoke files keep their
-- meaning.

drop function if exists ops_core.attach_file(text, text, text, bigint, text, text, text);
create or replace function ops_core.attach_file(
  p_storage_path text,
  p_filename text,
  p_mime text default null,
  p_bytes bigint default null,
  p_sha256 text default null,
  p_source text default 'web',
  p_key text default null,
  p_kind text default null,
  p_entity text default null,
  p_web_view_link text default null,
  p_folder_id text default null)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
declare v_id uuid; v_max bigint; res jsonb; replayed jsonb;
        v_kind ops_core.doc_kind_t; v_slug text; v_path text; v_link text;
begin
  replayed := ops_core.idem_replay('documents','attach_file', p_key);
  if replayed is not null then return replayed; end if;

  if coalesce(btrim(p_storage_path), '') = '' then
    return ops_core.invalid('documents','attachment', null,'attach_file',
      'path_required','A stored file needs the id Drive gave it.',
      jsonb_build_object('field','storage_path'));
  end if;
  if coalesce(btrim(p_filename), '') = '' then
    return ops_core.invalid('documents','attachment', null,'attach_file',
      'filename_required','A file needs the name a person will recognise it by.',
      jsonb_build_object('field','filename'));
  end if;

  -- The limit is a setting rather than a constant, because the answer to "why
  -- can I not upload this" should be changeable by whoever is asked it.
  v_max := ops_core.setting_num('upload.max_bytes');
  if v_max is not null and coalesce(p_bytes, 0) > v_max then
    return ops_core.invalid('documents','attachment', null,'attach_file',
      'file_too_large',
      format('File is %s MB, over the %s MB limit.',
             round(p_bytes / 1048576.0, 1), round(v_max / 1048576.0)),
      jsonb_build_object('field','bytes','limit', v_max));
  end if;

  -- Where it went is the database's answer, the same one `drive_folder_for`
  -- gave the route a moment ago: the drive from the kind, the folder from the
  -- kind and the record. Never the caller's say-so — the drive is the
  -- personal-data boundary (0035).
  if p_kind is not null then
    v_kind := ops_core.doc_kind_of(p_kind);
    if v_kind is null then
      return ops_core.invalid('documents','attachment', null,'attach_file',
        'unknown_kind', format('"%s" is not a kind of document this system files.', p_kind),
        jsonb_build_object('field','kind','given', p_kind));
    end if;
    select d.slug into v_slug from ops_core.doc_kind_drive d where d.kind = v_kind;
    if v_slug is null then
      return ops_core.invalid('documents','attachment', null,'attach_file',
        'no_drive_for_kind', format('Nothing says which shared drive a %s belongs in.', v_kind),
        jsonb_build_object('field','kind','kind', v_kind));
    end if;
    v_path := ops_core.drive_path_for(v_kind, p_entity);
  end if;

  v_link := nullif(btrim(p_web_view_link), '');
  if v_link is not null and v_link !~ '^https://(drive|docs)\.google\.com/' then
    return ops_core.invalid('documents','attachment', null,'attach_file',
      'not_a_drive_link', 'The link recorded for an uploaded file must be the one Google Drive gave it.',
      jsonb_build_object('field','web_view_link'));
  end if;

  insert into ops_core.attachments (storage_path, filename, mime, bytes, sha256, source, uploaded_by,
                                    web_view_link, drive_slug, drive_path, drive_folder_id)
  values (btrim(p_storage_path), btrim(p_filename), nullif(btrim(p_mime), ''),
          p_bytes, nullif(btrim(p_sha256), ''),
          case when p_source in ('web','chat','api','import') then p_source else 'web' end,
          auth.uid(),
          v_link, v_slug, v_path, nullif(btrim(p_folder_id), ''))
  returning id into v_id;

  perform ops_core.emit('documents','documents.attachment.filed', v_id::text,
    jsonb_build_object('attachment_id', v_id, 'kind', coalesce(v_kind::text, 'file'),
                       'bytes', p_bytes, 'drive', v_slug, 'path', v_path));

  res := ops_core.ok('documents','attachment', v_id::text,'attach_file',
    jsonb_build_object('attachment_id', v_id, 'web_view_link', v_link,
                       'drive', v_slug, 'path', v_path));
  return ops_core.idem_remember('documents','attach_file', p_key, res);
end $$;

revoke all on function ops_core.attach_file(text, text, text, bigint, text, text, text, text, text, text, text) from public;
grant execute on function ops_core.attach_file(text, text, text, bigint, text, text, text, text, text, text, text) to authenticated;

-- ── the view ──────────────────────────────────────────────────────────────
--
-- Appended at the end: `create or replace view` may add columns there and
-- nowhere else. `filed_in` is what a person reads — *PROCUREMENT / OPS /
-- INVENTORY/ITEMS* — so "is it in the right drive" is answerable from the app.

create or replace view ops_core.v_attachment as
  select a.id::text                          as id,
         coalesce(a.storage_path, '')        as storage_path,
         a.url,
         a.filename,
         coalesce(a.sha256, '')              as sha256,
         coalesce(a.mime, '')                as mime,
         coalesce(a.bytes, 0)                as bytes,
         coalesce(u.email, 'system')         as uploaded_by,
         a.uploaded_at,
         a.source,
         (a.sha256 is not null and exists (
            select 1 from ops_core.attachments d
             where d.sha256 = a.sha256
               and (d.uploaded_at, d.id) < (a.uploaded_at, a.id)))  as duplicate_suspect,
         coalesce(c.n, 0)                    as covers_count,
         a.web_view_link,
         case when a.drive_slug is not null
              then concat_ws(' / ', df.label, 'OPS', a.drive_path) end as filed_in
    from ops_core.attachments a
    left join ops_core.users u on u.id = a.uploaded_by
    left join ops_core.drive_folders df on df.slug = a.drive_slug
    left join (
      select attachment_id, count(*) as n
        from ops_core.attachment_links
       where unlinked_at is null
       group by attachment_id
    ) c on c.attachment_id = a.id;

alter view ops_core.v_attachment set (security_invoker = on);

create index if not exists attachments_drive_slug_idx
  on ops_core.attachments (drive_slug) where drive_slug is not null;

analyze ops_core.attachments;
