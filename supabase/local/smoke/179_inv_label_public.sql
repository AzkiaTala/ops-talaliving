-- inv — a label's QR opens without signing in, by token only (0179, D322).
--
-- DERIVATIONS  listing records for labels gives each a random token, the same
--              one every time; anon opens the card by that token and sees
--              code, name, location names, registered date, and a rented
--              asset's ownership and contract end
-- REFUSALS     anon cannot list, cannot open by code, cannot read the token
--              table or any inventory table; an unknown or malformed token
--              and an archived record all answer the same 404; the card
--              leaves out holder, serial and quantities; a miss writes no
--              audit row

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('ffffffff-0000-0000-0000-000000017901','label-pub@talaliving.com','{"full_name":"Gudang"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('ffffffff-0000-0000-0000-000000017901','inventory','read');

insert into ops_procure.item_categories (code, name) values ('kayu-pub','Kayu (uji)') on conflict (code) do nothing;
insert into ops_inv.stocked_categories (category_code) values ('kayu-pub') on conflict do nothing;
insert into ops_procure.items (code, name, category_code, base_uom, kind) values
  ('I-PUB01', 'Teak board', 'kayu-pub', 'pcs', 'goods'),
  ('I-PUB02', 'Old board',  'kayu-pub', 'pcs', 'goods');
insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, reason, moved_by)
values ('I-PUB01', 'GUDANG', 'adjust', 7, 'pcs', 'opname (uji)', 'ffffffff-0000-0000-0000-000000017901');
insert into ops_inv.assets (asset_no, name, category_code, location, holder, identifier, ownership, contract_end)
select 'AST-PUB1', 'Forklift sewa', ac.code, 'GUDANG', 'Budi Santoso', 'B 1234 XY', 'rented', '2027-03-31'
  from ops_inv.asset_categories ac order by ac.code limit 1;

-- ── the signed-in list makes the tokens ───────────────────────────────────
set local role authenticated;
set local request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000017901';

create temp table tok (kind text, code text, token text) on commit drop;
grant all on tok to authenticated, anon;

do $$
declare r jsonb; r2 jsonb;
begin
  r := ops_inv.label_sources('item', null, array['I-PUB01','I-PUB02']);
  assert ops_core.said_ok(r), 'list: ' || r::text;
  assert (select bool_and(e->>'token' ~ '^[0-9a-f]{32}$') from jsonb_array_elements(r->'data') e),
    'every row carries a token, got ' || (r->'data')::text;
  r2 := ops_inv.label_sources('item', null, array['I-PUB01']);
  assert r2->'data'->0->>'token' = (select e->>'token' from jsonb_array_elements(r->'data') e where e->>'code' = 'I-PUB01'),
    'the same record keeps its token: a reprint prints the same QR';
  insert into tok select 'item', e->>'code', e->>'token' from jsonb_array_elements(r->'data') e;

  r := ops_inv.label_sources('asset', null, array['AST-PUB1']);
  insert into tok values ('asset', 'AST-PUB1', r->'data'->0->>'token');
end $$;

-- An item archived after its label was printed.
reset role;
update ops_procure.items set archived_at = now(), archived_by = 'ffffffff-0000-0000-0000-000000017901' where code = 'I-PUB02';

-- ── anon: the card, and nothing else ──────────────────────────────────────
set local role anon;
set local request.jwt.claim.sub = '';

do $$
declare r jsonb; n0 bigint;
begin
  r := ops_inv.label_card((select token from tok where code = 'I-PUB01'));
  assert r->>'outcome' = 'ok', 'anon opens the card: ' || r::text;
  assert r->'data'->>'code' = 'I-PUB01' and r->'data'->>'name' = 'Teak board', 'what it is';
  assert r->'data'->'locations' = '["Gudang utama"]'::jsonb or jsonb_array_length(r->'data'->'locations') = 1,
    'where it is, by name, got ' || (r->'data'->'locations')::text;
  assert (r->'data')::text not like '%"qty"%', 'no quantities on the public card';

  r := ops_inv.label_card((select token from tok where code = 'AST-PUB1'));
  assert r->'data'->'extra'->>'ownership' = 'rented' and r->'data'->'extra'->>'contract_end' = '2027-03-31',
    'a rented asset says so, got ' || r::text;
  assert (r::text) not like '%Budi%' and (r::text) not like '%B 1234%', 'no holder, no plate: ' || r::text;

  r := ops_inv.label_card((select token from tok where code = 'I-PUB02'));
  assert r->'error'->>'code' = 'not_found', 'an archived record is gone: ' || r::text;
  r := ops_inv.label_card('0123456789abcdef0123456789abcdef');
  assert r->'error'->>'code' = 'not_found', 'an unknown token: ' || r::text;
  r := ops_inv.label_card('I-PUB01');
  assert r->'error'->>'code' = 'not_found', 'a code is not a token: ' || r::text;

  begin
    perform ops_inv.label_sources('item');
    raise exception 'anon must not list';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from ops_inv.label_tokens;
    raise exception 'anon must not read the tokens';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from ops_inv.v_stock_item;
    raise exception 'anon must not read the rack';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from ops_inv.assets;
    raise exception 'anon must not read the assets';
  exception when insufficient_privilege then null;
  end;
  begin
    perform ops_inv.label_rows('item');
    raise exception 'anon must not reach the rows directly';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

do $$
begin
  assert not exists (select 1 from ops_core.audit_log where entity = 'label' and action = 'label_card'),
    'a card, found or not, writes nothing';
end $$;

rollback;
