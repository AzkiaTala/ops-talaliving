-- 0179_inv_stock_from_signed_receipt.sql — a receipt signed the moment it is
-- recorded puts stock on the rack too (F176, B19), and so does one against an
-- order line that names its request line but no item (F179, B22).
--
-- Found by the inventory walk (`99_sim_inventory`, step 3): `0169`'s trigger
-- was `after update of status`, so it saw a receipt that went REPORTED →
-- CONFIRMED through `confirm_receipt`. But the everyday receipt is recorded
-- with the goods photo **and** the vendor's delivery note together, and
-- `create_receipt` (0138) then inserts it already CONFIRMED — an INSERT, which
-- an update trigger never sees. Every receipt recorded that way since 0169
-- signed for goods and added nothing to the rack. `169_inv_stock_from_receipt`
-- missed it because it inserted REPORTED rows by hand and confirmed them.
--
-- The browser walk (`walk-inventory.mjs`) then found the second door: a
-- receipt against a **PO** line. `NewPo.tsx` fills a line from the approved
-- request line (`pr_line_no`, 0139) and never sends `item_id`, so every PO
-- line written from the screen has `item_id` null, and the trigger answered
-- *the line names no catalogue item* for all of them. The item is one hop
-- away — the request line the order line buys — so the trigger now reads it
-- there when the order line has none. An order line with neither (a PO typed
-- by hand, with no request line) still stocks nothing and says why.
--
-- The function now also fires on insert. It already asked the right
-- questions of `new`; only "was it confirmed before?" needs `old`, which an
-- insert does not have. Idempotent as before (`stock_receipt_once_idx`).
--
-- **No backfill** (Q58). Receipts signed at insert between 0169 and this
-- migration stay unstocked, the same rule 0169 wrote for everything before
-- it: the opname sets the baseline. `docs/plan/06-decisions.md` Q58 carries
-- the query that lists them, if the owner wants them replayed instead.

create or replace function ops_inv.stock_from_receipt()
returns trigger
language plpgsql security definer set search_path = ops_inv, ops_procure, ops_core, pg_temp as $$
declare
  v_item_id   uuid;
  v_line_uom  text;
  v_price     numeric;
  v_item      ops_procure.items;
  v_qty       numeric;
  v_cost      numeric;
  v_factor    numeric;
  v_location  text;
  v_why       text;
begin
  if new.status <> 'CONFIRMED' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'CONFIRMED' then
    return new;
  end if;

  if new.po_line_id is not null then
    -- The order line's own item, else the item of the request line it buys.
    select coalesce(pl.item_id, pr.item_id), pl.uom, pl.unit_price into v_item_id, v_line_uom, v_price
      from ops_procure.po_lines pl
      left join ops_procure.pr_lines pr on pr.id = pl.pr_line_id
     where pl.id = new.po_line_id;
  else
    select pr.item_id, pr.uom, pr.unit_price into v_item_id, v_line_uom, v_price
      from ops_procure.pr_lines pr where pr.id = new.line_id;
  end if;

  if v_item_id is null then
    v_why := 'the line names no catalogue item';
  else
    select * into v_item from ops_procure.items i where i.id = v_item_id;
    if v_item.merged_into is not null then
      select * into v_item from ops_procure.items i where i.id = v_item.merged_into;
    end if;
    if not exists (select 1 from ops_inv.stocked_categories s where s.category_code = v_item.category_code) then
      v_why := format('%s is not a counted category', v_item.category_code);
    elsif new.condition in ('WRONG ITEM', 'RETURN TO SENDER') then
      v_why := format('marked %s — not kept', new.condition);
    end if;
  end if;

  if v_why is null then
    v_line_uom := coalesce(v_line_uom, v_item.base_uom);
    if v_line_uom = v_item.base_uom then
      v_factor := 1;
    else
      select c.factor into v_factor from ops_procure.uom_conversions c
       where c.from_uom = v_line_uom and c.to_uom = v_item.base_uom;
      if v_factor is null then
        select 1 / c.factor into v_factor from ops_procure.uom_conversions c
         where c.from_uom = v_item.base_uom and c.to_uom = v_line_uom;
      end if;
      if v_factor is null then
        v_why := format('bought per %s, counted per %s, and no conversion between them', v_line_uom, v_item.base_uom);
      end if;
    end if;
  end if;

  if v_why is not null then
    perform ops_core.emit('inventory','inventory.receipt.not_stocked', new.receipt_no,
      jsonb_build_object('receipt_no', new.receipt_no, 'why', v_why));
    return new;
  end if;

  v_qty := new.qty_received * v_factor;
  v_cost := case when coalesce(v_price, 0) > 0 then v_price / v_factor end;
  select coalesce(s.home_location, 'GUDANG') into v_location
    from (select 1) one left join ops_inv.stock_settings s on s.item_code = v_item.code;

  insert into ops_inv.stock_moves (item_code, location, kind, qty, uom, unit_cost, ref_no, moved_by)
  values (v_item.code, v_location, 'receipt', v_qty, v_item.base_uom, v_cost, new.receipt_no,
          coalesce(new.confirmed_by, new.received_by, auth.uid()))
  on conflict do nothing;

  perform ops_core.emit('inventory','inventory.stock.received', new.receipt_no,
    jsonb_build_object('receipt_no', new.receipt_no, 'item_code', v_item.code,
                       'qty', v_qty, 'uom', v_item.base_uom, 'location', v_location));
  return new;
end $$;

revoke all on function ops_inv.stock_from_receipt() from public;
grant execute on function ops_inv.stock_from_receipt() to authenticated;

drop trigger if exists stock_from_receipt on ops_procure.receipts;
create trigger stock_from_receipt
  after insert or update of status on ops_procure.receipts
  for each row execute function ops_inv.stock_from_receipt();
