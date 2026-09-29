import type { DemoState } from "./state";

/** The demo's account ↔ employee link — `ops_hr.employees.user_id` and
 *  `my_employee_id()` in the database (0152). Read from
 *  `state.employee_accounts`, which IT writes from `/it/pengguna` (D329), so
 *  `/saya`'s door and the documents guard follow the same link `hr.myProfile`
 *  does. Karjo (`usr_karjo`) is the one linked account with no module (D331). */
export function selfEmployeeId(state: DemoState, userId: string): string | null {
  const no = state.employee_accounts?.find((l) => l.user_id === userId)?.employee_no;
  if (!no) return null;
  return state.employees.find((e) => e.employee_no === no)?.id ?? null;
}

/** 0187's `carry_sick_note`: every surat dokter on an approved sick request,
 *  onto every sick mark of that person inside its dates. The demo links a
 *  day's letter by the mark's id (`attachSuratDokter`), so that is what this
 *  writes. Returns how many links it added. */
export function carrySickNote(draft: DemoState, requestNo: string, now: string): number {
  const req = draft.leave_requests.find((r) => r.request_no === requestNo);
  if (!req || req.kind !== "sakit" || req.status !== "APPROVED") return 0;
  const letters = draft.attachment_links.filter(
    (l) => l.entity === "leave_request" && l.entity_no === requestNo && l.kind === "Surat Dokter",
  );
  const marks = draft.day_marks.filter(
    (m) => m.employee_id === req.employee_id && m.kind === "sick"
      && m.work_date >= req.from_date && m.work_date <= req.to_date,
  );
  let n = 0;
  for (const l of letters) {
    for (const m of marks) {
      const there = draft.attachment_links.some(
        (x) => x.attachment_id === l.attachment_id && x.entity === "day_mark"
          && x.entity_no === m.id && x.kind === "Surat Dokter",
      );
      if (there) continue;
      draft.attachment_links.push({
        id: `lnk_${requestNo}_${m.id}_${l.attachment_id}`,
        attachment_id: l.attachment_id, entity: "day_mark", entity_no: m.id,
        kind: "Surat Dokter", linked_by: l.linked_by, linked_at: now,
      });
      n += 1;
    }
  }
  return n;
}
