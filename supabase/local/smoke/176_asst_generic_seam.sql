-- asst — a declared write: the catalogue names a seam, the person says yes,
-- the seam decides (0176, D317).
--
-- What has to hold, and is measured here on row counts rather than on the
-- absence of an error (F163):
--
--   * every declared rpc seam exists, is security definer, is executable by
--     `authenticated`, and takes the parameters its fields feed;
--   * the catalogue refuses a seam in `ops_core`/`ops_asst`, a seam on a read
--     tool, and any write to itself through the API;
--   * **Confirm writes**: a marketing writer's draft of `marketing.draft_market`,
--     confirmed, is one market — and a second tap with the draft's key is still
--     one market;
--   * **Cancel writes nothing**: an abandoned draft leaves the market table as
--     it was, and cannot be confirmed afterwards;
--   * **a person without the grant is refused at the yes**: a writer who drafts
--     and is then turned into a reader is refused by `may_run` *and* by the
--     seam itself, and nothing is written — the gate is a sentence, the seam is
--     the boundary (0039).

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a5570000-0000-0000-0000-000000001751','mkt-write@talaliving.com','{"full_name":"Marketing writer"}'),
  ('a5570000-0000-0000-0000-000000001752','mkt-read@talaliving.com', '{"full_name":"Marketing reader"}');
insert into ops_core.user_modules (user_id, module, level) values
  ('a5570000-0000-0000-0000-000000001751','marketing','write'),
  ('a5570000-0000-0000-0000-000000001752','marketing','read');

/* ── the catalogue is sound, and holds its own line ────────────────────── */

do $$
declare n int; msg text;
begin
  select count(*) into n from ops_asst.seam_problems();
  assert n = 0, format('declared seams have problems: %s',
    (select string_agg(tool || ': ' || problem, '; ') from ops_asst.seam_problems()));

  assert (select kind from ops_asst.tool_seams where tool = 'procurement.draft_pr_line') = 'api',
    'draft_pr_line is on the declared road';
  assert (select count(*) from ops_asst.tool_fields where tool = 'marketing.draft_market' and required) = 7,
    'a market card has seven required fields';

  begin
    insert into ops_asst.tool_seams (tool, kind, seam, headline_en, headline_id)
    values ('marketing.draft_market', 'rpc', 'ops_core.grant_module', 'x', 'x');
    assert false, 'a seam in ops_core must be refused';
  exception when unique_violation or check_violation then null;
  end;
  begin
    update ops_asst.tool_seams set seam = 'ops_core.set_module' where tool = 'marketing.draft_market';
    assert false, 'moving a seam into ops_core must be refused';
  exception when check_violation then null;
  end;
  begin
    insert into ops_asst.tool_seams (tool, kind, seam, headline_en, headline_id)
    values ('accounting.balances', 'rpc', 'ops_acct.anything', 'x', 'x');
    assert false, 'a read tool cannot carry a seam';
  exception when foreign_key_violation then null;
  end;
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'a5570000-0000-0000-0000-000000001751';

-- Nobody writes the catalogue through the API — not even somebody who may use it.
do $$
begin
  begin
    update ops_asst.tool_fields set required = false where tool = 'marketing.draft_market';
    assert false, 'authenticated must not update tool_fields';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into ops_asst.tool_seams (tool, kind, seam, headline_en, headline_id)
    values ('hr.draft_leave', 'rpc', 'ops_hr.request_leave', 'x', 'x');
    assert false, 'authenticated must not insert tool_seams';
  exception when insufficient_privilege then null;
  end;
  assert (select jsonb_array_length(fields) from ops_asst.v_tool_seams
           where tool = 'marketing.draft_market') = 9, 'the card is readable, all nine fields';
end $$;

/* ── Confirm writes, once ──────────────────────────────────────────────── */

do $$
declare r jsonb; v_turn uuid; v_draft uuid; n0 int; n1 int;
begin
  select count(*) into n0 from ops_mkt.markets;
  r := ops_asst.may_run('marketing.draft_market', 'id');
  assert ops_core.said_ok(r), format('the writer may draft a market, got %s', r);

  r := ops_asst.record_turn('buat pasar baru Gold Coast', 'draft', 'id', 'menyiapkan pasar baru',
        '', '[]'::jsonb, '[]'::jsonb, array['marketing.draft_market'], null, '/marketing/pipeline', 63);
  v_turn := (r -> 'data' ->> 'id')::uuid;
  r := ops_asst.open_draft(v_turn, 'marketing.draft_market', '{"language":"en"}'::jsonb, 'idem-mkt-1');
  assert ops_core.said_ok(r), format('got %s', r);
  v_draft := (r -> 'data' ->> 'id')::uuid;
  assert (select count(*) from ops_mkt.markets) = n0, 'a draft is not a market';

  -- What the client does on "Ya, tulis": the seam, as the person, with the
  -- draft's key in `key_param` — twice, as a double tap would.
  r := ops_mkt.create_market('AU-QLD-GOLDCOAST-SPNORTH', 'AU', 'Australia', 'Gold Coast',
        'SP NORTH', 'AUD', 'Australia/Brisbane', 'Queensland', 'en', 'idem-mkt-1');
  assert ops_core.said_ok(r), format('the seam writes, got %s', r);
  r := ops_mkt.create_market('AU-QLD-GOLDCOAST-SPNORTH', 'AU', 'Australia', 'Gold Coast',
        'SP NORTH', 'AUD', 'Australia/Brisbane', 'Queensland', 'en', 'idem-mkt-1');
  assert r ->> 'outcome' = 'duplicate', format('the second tap is a replay, got %s', r);
  select count(*) into n1 from ops_mkt.markets;
  assert n1 = n0 + 1, format('one market, not two: %s → %s', n0, n1);

  r := ops_asst.settle_draft(v_draft, 'confirmed',
        '{"code":"AU-QLD-GOLDCOAST-SPNORTH","country_code":"AU"}'::jsonb, 'AU-QLD-GOLDCOAST-SPNORTH');
  assert ops_core.said_ok(r), format('got %s', r);

  -- The seam's own no comes back as an envelope the card can read out: the
  -- field it names is a field on the card.
  r := ops_mkt.create_market('GOLDCOAST-SPNORTH', 'AUS', 'Australia', 'Gold Coast',
        'SP NORTH', 'AUD', 'Australia/Brisbane', null, 'en', null);
  assert r -> 'error' ->> 'code' = 'bad_country_code', format('got %s', r);
  assert exists (select 1 from ops_asst.tool_fields
                  where tool = 'marketing.draft_market' and key = r -> 'error' -> 'detail' ->> 'field'),
    format('the seam names a field the card has, got %s', r -> 'error' -> 'detail');
  r := ops_mkt.create_market('AU-QLD-GOLDCOAST-SPNORTH', 'AU', 'Australia', 'Gold Coast',
        'SP NORTH', 'AUD', 'Australia/Brisbane', null, 'en', null);
  assert r ->> 'outcome' = 'duplicate' and r -> 'error' ->> 'code' = 'market_exists',
    format('a second market with the same code is a conflict, got %s', r);
end $$;

/* ── Cancel writes nothing ─────────────────────────────────────────────── */

do $$
declare r jsonb; v_turn uuid; v_draft uuid; n0 int;
begin
  select count(*) into n0 from ops_mkt.markets;
  r := ops_asst.record_turn('tambah pasar Seminyak', 'draft', 'id', 'menyiapkan pasar baru',
        '', '[]'::jsonb, '[]'::jsonb, array['marketing.draft_market'], null, '/marketing/pipeline', 63);
  v_turn := (r -> 'data' ->> 'id')::uuid;
  r := ops_asst.open_draft(v_turn, 'marketing.draft_market', '{}'::jsonb, 'idem-mkt-2');
  v_draft := (r -> 'data' ->> 'id')::uuid;

  r := ops_asst.settle_draft(v_draft, 'abandoned', null, null);
  assert ops_core.said_ok(r), format('got %s', r);
  assert (select count(*) from ops_mkt.markets) = n0, 'cancelling wrote nothing';
  r := ops_asst.settle_draft(v_draft, 'confirmed', '{"code":"ID-BALI-SEMINYAK"}'::jsonb, 'x');
  assert r -> 'error' ->> 'code' = 'already_settled', format('an abandoned draft stays abandoned, got %s', r);
end $$;

/* ── the grant is asked again at the yes ───────────────────────────────── */

do $$
declare r jsonb; v_turn uuid; n0 int;
begin
  r := ops_asst.record_turn('buat pasar baru Bali', 'draft', 'id', 'menyiapkan pasar baru',
        '', '[]'::jsonb, '[]'::jsonb, array['marketing.draft_market'], null, '/marketing/pipeline', 63);
  v_turn := (r -> 'data' ->> 'id')::uuid;
  r := ops_asst.open_draft(v_turn, 'marketing.draft_market', '{}'::jsonb, 'idem-mkt-3');
  assert ops_core.said_ok(r), format('drafted while still a writer, got %s', r);
end $$;

reset role;
update ops_core.user_modules set level = 'read'
 where user_id = 'a5570000-0000-0000-0000-000000001751' and module = 'marketing';
set local role authenticated;
set local request.jwt.claim.sub = 'a5570000-0000-0000-0000-000000001751';

do $$
declare r jsonb; n0 int;
begin
  select count(*) into n0 from ops_mkt.markets;
  r := ops_asst.may_run('marketing.draft_market', 'id');
  assert r -> 'error' -> 'detail' ->> 'refused_because' = 'permission',
    format('the gate refuses the yes once the grant is gone, got %s', r);
  -- And a client that skipped the gate meets the seam's own refusal.
  r := ops_mkt.create_market('ID-BALI-BADUNG-SEMINYAK', 'ID', 'Indonesia', 'Badung',
        'Seminyak', 'IDR', 'Asia/Makassar', 'Bali', 'en', 'idem-mkt-3');
  assert r -> 'error' ->> 'code' = 'not_permitted', format('the seam refuses too, got %s', r);
  assert (select count(*) from ops_mkt.markets) = n0, 'and nothing was written';
end $$;

-- A reader never gets as far as a draft.
set local request.jwt.claim.sub = 'a5570000-0000-0000-0000-000000001752';
do $$
declare r jsonb; v_turn uuid;
begin
  r := ops_asst.record_turn('buat pasar baru Dubai', 'draft', 'id', 'menyiapkan pasar baru',
        '', '[]'::jsonb, '[]'::jsonb, array['marketing.draft_market'], null, '/marketing/pipeline', 63);
  v_turn := (r -> 'data' ->> 'id')::uuid;
  r := ops_asst.open_draft(v_turn, 'marketing.draft_market', '{}'::jsonb, 'idem-mkt-4');
  assert r -> 'error' ->> 'code' = 'permission_required', format('got %s', r);
end $$;

rollback;
