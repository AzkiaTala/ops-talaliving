-- 0177_core_upload_audit.sql — the audit log said `file · ok` for an upload
-- that failed (F172).
--
-- ── What the owner saw ────────────────────────────────────────────────────
--
-- After 0175, three uploads from Procurement failed at Drive (*File not found:
-- 16btMm…*), and IT → Audit log showed three rows reading **file · ok ·
-- documents · attachment**, with no document number, no reason and no detail.
--
-- Those rows were not the upload. `drive_folder_for` answers its question —
-- *which drive and folder does a Foto go in* — through `ops_core.ok()`, and
-- every envelope writes an audit row. So asking where a file goes was logged
-- as `file ok`, and the failure that came next was not logged at all: it
-- happens in Google, after the database has answered, and nothing wrote it
-- down. The log told IT the one thing that had not happened.
--
-- ── What changes ──────────────────────────────────────────────────────────
--
-- 1. **Asking is not an event.** `drive_folder_for` answers `ok` without an
--    audit row. The log records changes, and working out a folder changes
--    nothing. Its refusals are still logged (an unknown kind, a drive with no
--    folder), because a refusal is a decision somebody may need to trace.
-- 2. **A failed upload is logged as a refusal.** The upload route calls
--    `record_upload_failure` when Drive refuses. The row reads
--    `upload · refused`, names the file, carries the plain explanation as its
--    reason, and keeps Google's own answer in `detail`.
-- 3. **A filed document says what and where.** `attach_file`'s row names the
--    file (not a uuid) and gives its reason as
--    `kursi.jpg → PROCUREMENT / OPS / INVENTORY/ITEMS`.

-- ── 1. the question, unlogged when answered ───────────────────────────────

create or replace function ops_core.drive_folder_for(p_kind text, p_entity text default null)
returns jsonb
language plpgsql volatile security definer set search_path = ops_core, pg_temp as $$
declare v_kind ops_core.doc_kind_t; f record;
begin
  v_kind := ops_core.doc_kind_of(p_kind);
  if v_kind is null then
    return ops_core.invalid('documents','attachment', null,'resolve_folder',
      'unknown_kind', format('"%s" is not a kind of document this system files.', p_kind),
      jsonb_build_object('field','kind','given', p_kind));
  end if;
  if p_entity is not null
     and not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                      where t.typname = 'link_entity_t' and e.enumlabel = p_entity) then
    return ops_core.invalid('documents','attachment', null,'resolve_folder',
      'unknown_entity', format('"%s" is not a record a document can be filed against.', p_entity),
      jsonb_build_object('field','entity','given', p_entity));
  end if;

  select d.slug, df.label, df.drive_id, df.folder_id, df.parent_folder_id
    into f
    from ops_core.doc_kind_drive d
    join ops_core.drive_folders df on df.slug = d.slug
   where d.kind = v_kind;

  if not found then
    return ops_core.invalid('documents','attachment', null,'resolve_folder',
      'no_drive_for_kind',
      format('Nothing says which shared drive a %s belongs in.', v_kind),
      jsonb_build_object('field','kind','kind', v_kind));
  end if;

  if f.parent_folder_id is null and f.folder_id is null then
    return ops_core.invalid('documents','attachment', null,'resolve_folder',
      'drive_not_configured',
      format('The %s shared drive has no OPS folder recorded yet, so a %s cannot be filed. IT sets it in ops_core.drive_folders.',
             f.label, v_kind),
      jsonb_build_object('field','kind','slug', f.slug, 'label', f.label));
  end if;

  -- The same shape `ok()` returns, nulls stripped as it strips them, without
  -- its audit row (see above).
  return jsonb_strip_nulls(jsonb_build_object('outcome','ok','status',200,'data',
    jsonb_build_object('kind', v_kind, 'slug', f.slug, 'label', f.label,
                       'drive_id', f.drive_id,
                       'parent_folder_id', f.parent_folder_id,
                       'folder_id', f.folder_id,
                       'path', ops_core.drive_path_for(v_kind, p_entity))));
end $$;

-- ── 2. a failed upload, written down ──────────────────────────────────────
--
-- Called by the upload route, as the person uploading, when Drive refuses.
-- It writes one audit row and nothing else. The row is the person's own
-- account of their own failed upload, so being signed in is the only check.
-- There is nothing here to forge that the person could not already cause by
-- uploading a file Drive refuses.

create or replace function ops_core.record_upload_failure(
  p_filename text,
  p_kind text,
  p_stage text,
  p_code text,
  p_message text,
  p_detail jsonb default null)
returns jsonb
language plpgsql security definer set search_path = ops_core, pg_temp as $$
begin
  if auth.uid() is null then
    return ops_core.refused('documents','attachment', null,'upload',
      'not_signed_in','Sign in first.');
  end if;
  return ops_core.say('documents','attachment',
    left(coalesce(nullif(btrim(p_filename), ''), '(no name)'), 200), 'upload',
    'refused', 502,
    left(coalesce(nullif(btrim(p_code), ''), 'upload_failed'), 60),
    left(coalesce(nullif(btrim(p_message), ''), 'The upload failed.'), 2000),
    null,
    coalesce(p_detail, '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object('kind', p_kind, 'stage', p_stage)));
end $$;

revoke all on function ops_core.record_upload_failure(text, text, text, text, text, jsonb) from public;
grant execute on function ops_core.record_upload_failure(text, text, text, text, text, jsonb) to authenticated;

comment on function ops_core.record_upload_failure(text, text, text, text, text, jsonb) is
  'Writes an upload that Drive refused into the audit log, as `upload · refused`, with the plain '
  'explanation as its reason and Google''s answer in detail. Called by the upload route. (0177)';

-- ── 3. a filed document, in words ─────────────────────────────────────────

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
        v_kind ops_core.doc_kind_t; v_slug text; v_path text; v_link text; v_where text;
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

  v_max := ops_core.setting_num('upload.max_bytes');
  if v_max is not null and coalesce(p_bytes, 0) > v_max then
    return ops_core.invalid('documents','attachment', btrim(p_filename),'attach_file',
      'file_too_large',
      format('File is %s MB, over the %s MB limit.',
             round(p_bytes / 1048576.0, 1), round(v_max / 1048576.0)),
      jsonb_build_object('field','bytes','limit', v_max));
  end if;

  if p_kind is not null then
    v_kind := ops_core.doc_kind_of(p_kind);
    if v_kind is null then
      return ops_core.invalid('documents','attachment', btrim(p_filename),'attach_file',
        'unknown_kind', format('"%s" is not a kind of document this system files.', p_kind),
        jsonb_build_object('field','kind','given', p_kind));
    end if;
    select d.slug into v_slug from ops_core.doc_kind_drive d where d.kind = v_kind;
    if v_slug is null then
      return ops_core.invalid('documents','attachment', btrim(p_filename),'attach_file',
        'no_drive_for_kind', format('Nothing says which shared drive a %s belongs in.', v_kind),
        jsonb_build_object('field','kind','kind', v_kind));
    end if;
    v_path := ops_core.drive_path_for(v_kind, p_entity);
  end if;

  v_link := nullif(btrim(p_web_view_link), '');
  if v_link is not null and v_link !~ '^https://(drive|docs)\.google\.com/' then
    return ops_core.invalid('documents','attachment', btrim(p_filename),'attach_file',
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

  select concat_ws(' / ', df.label, 'OPS', v_path) into v_where
    from ops_core.drive_folders df where df.slug = v_slug;

  res := ops_core.say('documents','attachment', btrim(p_filename),'attach_file','ok',200,
    null,
    case when v_where is not null then format('%s → %s', btrim(p_filename), v_where) end,
    jsonb_build_object('attachment_id', v_id, 'web_view_link', v_link,
                       'drive', v_slug, 'path', v_path),
    jsonb_strip_nulls(jsonb_build_object('attachment_id', v_id, 'drive_file_id', btrim(p_storage_path),
                       'kind', v_kind, 'drive', v_slug, 'path', v_path,
                       'web_view_link', v_link, 'bytes', p_bytes)));
  return ops_core.idem_remember('documents','attach_file', p_key, res);
end $$;
