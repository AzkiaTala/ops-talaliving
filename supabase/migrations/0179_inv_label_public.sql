-- 0179_inv_label_public.sql — a label's QR opens without signing in (D322).
--
-- ── What the owner decided ────────────────────────────────────────────────
--
-- Asked whether the QR on an inventory label should need a sign-in, the
-- owner answered *tanpa login*. A phone that scans a label shows what the
-- thing is, whoever holds the phone.
--
-- ── What that must not become ─────────────────────────────────────────────
--
-- A public page per **code** would be a public inventory. Codes run in
-- order (`AST-0001`, `AST-0002`, `I-00001`…), so anybody could walk them and
-- read the whole list without holding a single label. So the QR carries a
-- **token**: 32 random hex characters per record, made the first time the
-- record is offered for a label, and printed on that label only. Holding the
-- label is the permission. There is no way to list tokens, and no way to
-- turn a code into its token without `inventory.read`.
--
-- And the card says less than the screen. It shows what the thing is and
-- where it belongs: code, name, category, location, registered date, and for
-- a rented asset its ownership and contract end. It leaves out cost, value,
-- quantities, holder (a person's name) and serial or plate numbers, all of
-- which the signed-in screens show.
--
-- ── How `anon` reaches it ─────────────────────────────────────────────────
--
-- `anon` had no usage on any `ops_*` schema, on purpose (0125). This grants
-- it usage on `ops_inv` and execute on **one** function, `label_card`.
-- Usage on a schema reaches nothing by itself: no table or view in `ops_inv`
-- is granted to `anon` or PUBLIC, and every definer function is revoked from
-- PUBLIC (`check_execute_grants.sh`). What PUBLIC can execute there are three
-- invoker helpers (`log_volume_m3`, `board_matches_its_log`,
-- `item_photo_rules`). They run as the caller, and `anon` can read no table.
-- The service role is not used: answering a request with it would make the
-- application, not the database, decide who sees what (ADR-002).
--
-- `label_card` writes nothing, not even an audit row for a miss. A token
-- that does not exist gets the same answer as a bad one, so nothing can be
-- learnt by guessing, and the audit log cannot be filled by somebody
-- hammering the URL.

-- ── 1. one token per record ───────────────────────────────────────────────

create table if not exists ops_inv.label_tokens (
  token      text primary key default replace(gen_random_uuid()::text, '-', '')
             check (token ~ '^[0-9a-f]{32}$'),
  kind       text not null check (kind in ('item','asset','product')),
  code       text not null,
  created_at timestamptz not null default now(),
  unique (kind, code)
);

-- Nobody reads this table directly: the two functions below do.
alter table ops_inv.label_tokens enable row level security;

comment on table ops_inv.label_tokens is
  'The random token a label''s QR carries, one per record: holding the label is what lets its '
  'public card open without signing in (D322). Never listed, never derived from the code. (0179)';

analyze ops_inv.label_tokens;

-- ── 2. the rows, once, for both callers ───────────────────────────────────
--
-- 0178's body of `label_sources`, moved here unchanged so the signed-in list
-- and the public card cannot drift apart. Invoker, and not granted to anyone:
-- it is reached only from the two definer functions below, which decide
-- first.

create or replace function ops_inv.label_rows(
  p_kind  text,
  p_since date   default null,
  p_codes text[] default null,
  p_q     text   default null)
returns jsonb
language plpgsql stable set search_path = ops_inv, ops_procure, ops_prod, ops_core, pg_temp as $$
declare v_rows jsonb; v_q text := nullif(btrim(p_q), '');
begin
  if p_kind = 'item' then
    select coalesce(jsonb_agg(r order by r.registered_at desc nulls last, r.code), '[]'::jsonb) into v_rows
      from (
        select 'item' as kind, i.code, i.name, i.name_local,
               c.name as category, i.base_uom as uom, i.created_at as registered_at,
               coalesce(
                 (select jsonb_agg(jsonb_build_object('code', b.location, 'name', b.location_name, 'qty', b.qty)
                                   order by b.qty desc, b.location)
                    from ops_inv.v_stock_by_location b
                   where b.item_code = i.code and b.qty > 0),
                 case when s.home_location is not null then
                   jsonb_build_array(jsonb_build_object('code', s.home_location,
                     'name', (select l.name from ops_inv.stock_locations l where l.code = s.home_location),
                     'qty', null)) end,
                 '[]'::jsonb) as locations,
               exists (select 1 from ops_inv.label_categories lc where lc.category_code = i.category_code) as labelled,
               jsonb_build_object('category_code', i.category_code) as extra
          from ops_procure.items i
          join ops_procure.item_categories c on c.code = i.category_code
          join ops_inv.stocked_categories sc on sc.category_code = i.category_code
          left join ops_inv.stock_settings s on s.item_code = i.code
         where i.merged_into is null and i.archived_at is null and i.kind = 'goods'
           and (p_since is null or i.created_at >= p_since)
           and (p_codes is null or i.code = any(p_codes))
           and (v_q is null or i.code ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%'
                or coalesce(i.name_local, '') ilike '%' || v_q || '%')
         order by i.created_at desc, i.code
         limit 500
      ) r;

  elsif p_kind = 'asset' then
    select coalesce(jsonb_agg(r order by r.registered_at desc nulls last, r.code), '[]'::jsonb) into v_rows
      from (
        select 'asset' as kind, a.asset_no as code, a.name, null::text as name_local,
               ac.name as category, null::text as uom, a.created_at as registered_at,
               case when a.location is not null
                 then jsonb_build_array(jsonb_build_object('code', a.location, 'name', a.location, 'qty', null))
                 else '[]'::jsonb end as locations,
               true as labelled,
               jsonb_strip_nulls(jsonb_build_object(
                 'ownership', a.ownership, 'holder', a.holder, 'identifier', a.identifier,
                 'brand', a.brand, 'model', a.model, 'status', a.status,
                 'acquired_on', a.acquired_on, 'contract_end', a.contract_end)) as extra
          from ops_inv.assets a
          join ops_inv.asset_categories ac on ac.code = a.category_code
         where a.status::text not in ('disposed','lost','returned')
           and (p_since is null or a.created_at >= p_since)
           and (p_codes is null or a.asset_no = any(p_codes))
           and (v_q is null or a.asset_no ilike '%' || v_q || '%' or a.name ilike '%' || v_q || '%'
                or coalesce(a.identifier, '') ilike '%' || v_q || '%')
         order by a.created_at desc, a.asset_no
         limit 500
      ) r;

  elsif p_kind = 'product' then
    with led as (
      select l.product_code, l.location, sum(l.qty) as q
        from ops_inv.product_ledger(null) l
       group by 1, 2 having sum(l.qty) > 0
    )
    select coalesce(jsonb_agg(r order by r.registered_at desc nulls last, r.code), '[]'::jsonb) into v_rows
      from (
        select 'product' as kind, p.product_code as code, p.name, null::text as name_local,
               p.category, p.uom, p.created_at as registered_at,
               coalesce(
                 (select jsonb_agg(jsonb_build_object('code', led.location, 'name', sl.name, 'qty', led.q)
                                   order by led.q desc, led.location)
                    from led left join ops_inv.stock_locations sl on sl.code = led.location
                   where led.product_code = p.product_code),
                 '[]'::jsonb) as locations,
               true as labelled,
               jsonb_strip_nulls(jsonb_build_object(
                 'length_mm', p.length_mm, 'width_mm', p.width_mm, 'height_mm', p.height_mm,
                 'dimension_note', p.dimension_note)) as extra
          from ops_prod.products p
         where p.active
           and (p_since is null or p.created_at >= p_since)
           and (p_codes is null or p.product_code = any(p_codes))
           and (v_q is null or p.product_code ilike '%' || v_q || '%' or p.name ilike '%' || v_q || '%')
         order by p.created_at desc, p.product_code
         limit 500
      ) r;
  end if;

  return v_rows;
end $$;

revoke all on function ops_inv.label_rows(text, date, text[], text) from public;

-- ── 3. the signed-in list, now carrying each row's token ──────────────────

create or replace function ops_inv.label_sources(
  p_kind  text,
  p_since date   default null,
  p_codes text[] default null,
  p_q     text   default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ops_inv, ops_procure, ops_prod, ops_core, pg_temp as $$
declare v_rows jsonb;
begin
  if not ops_core.has_permission('inventory.read') then
    return ops_core.refused('inventory','label', p_kind,'label_sources',
      'not_permitted','Mencetak label butuh akses baca inventory.');
  end if;
  if p_kind is null or p_kind not in ('item','asset','product') then
    return ops_core.invalid('inventory','label', p_kind,'label_sources',
      'unknown_kind', format('"%s" is not something this screen labels: item, asset or product.', p_kind),
      jsonb_build_object('field','kind','given', p_kind));
  end if;

  v_rows := ops_inv.label_rows(p_kind, p_since, p_codes, p_q);

  -- A token for every record offered, made once and kept: reprinting a label
  -- prints the same QR.
  insert into ops_inv.label_tokens (kind, code)
  select p_kind, e->>'code' from jsonb_array_elements(v_rows) e
  on conflict (kind, code) do nothing;

  select coalesce(jsonb_agg(e.v || jsonb_build_object('token', t.token) order by e.n), '[]'::jsonb)
    into v_rows
    from jsonb_array_elements(v_rows) with ordinality as e(v, n)
    join ops_inv.label_tokens t on t.kind = p_kind and t.code = e.v->>'code';

  -- A read: answered without an audit row, as `product_stock` is.
  return jsonb_build_object('outcome','ok','status',200,'data', v_rows);
end $$;

revoke all on function ops_inv.label_sources(text, date, text[], text) from public;
grant execute on function ops_inv.label_sources(text, date, text[], text) to authenticated;

-- ── 4. the public card ────────────────────────────────────────────────────

create or replace function ops_inv.label_card(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = ops_inv, ops_procure, ops_prod, ops_core, pg_temp as $$
declare t ops_inv.label_tokens; r jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('outcome','refused','status',404,
      'error', jsonb_build_object('code','not_found','message','Label ini tidak dikenal.','outcome','refused','status',404));
  end if;

  select * into t from ops_inv.label_tokens where token = p_token;
  if found then
    r := ops_inv.label_rows(t.kind, null, array[t.code], null) -> 0;
  end if;
  if r is null then
    -- No token, or the record has gone (archived, disposed): the same answer,
    -- so a guess learns nothing.
    return jsonb_build_object('outcome','refused','status',404,
      'error', jsonb_build_object('code','not_found','message','Label ini tidak dikenal.','outcome','refused','status',404));
  end if;

  return jsonb_build_object('outcome','ok','status',200,'data', jsonb_build_object(
    'kind', r->>'kind', 'code', r->>'code', 'name', r->>'name', 'name_local', r->>'name_local',
    'category', r->>'category', 'uom', r->>'uom', 'registered_at', r->>'registered_at',
    -- Where it belongs, not how many: names only.
    'locations', coalesce((select jsonb_agg(coalesce(l->>'name', l->>'code')) from jsonb_array_elements(r->'locations') l), '[]'::jsonb),
    -- Nothing personal, nothing priced: ownership and contract end for an
    -- asset, size for a product.
    'extra', jsonb_strip_nulls(jsonb_build_object(
      'ownership', r->'extra'->>'ownership', 'status', r->'extra'->>'status',
      'contract_end', r->'extra'->>'contract_end',
      'length_mm', r->'extra'->'length_mm', 'width_mm', r->'extra'->'width_mm',
      'height_mm', r->'extra'->'height_mm', 'dimension_note', r->'extra'->>'dimension_note'))));
end $$;

revoke all on function ops_inv.label_card(text) from public;
grant execute on function ops_inv.label_card(text) to anon, authenticated;
grant usage on schema ops_inv to anon;

comment on function ops_inv.label_card(text) is
  'The card a label''s QR opens without signing in (D322): code, name, category, location names, '
  'registered date, an asset''s ownership and contract end, a product''s size. By random token only; '
  'nothing priced, counted or personal. Writes nothing. (0179)';
