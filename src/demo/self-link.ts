import type { DemoState } from "./state";

/** The demo's account ↔ employee link — what `ops_hr.employees.user_id` and
 *  `my_employee_id()` are in the database (0152).
 *
 *  Kept beside the fixture rather than on the shared `Employee` contract,
 *  because widening `Employee` with a `user_id` would touch every screen that
 *  already destructures one. Wulan (HRD) and the shared IT account map to
 *  nothing — an office account with no employee row, the ordinary case.
 *
 *  **Karjo** is the one account here that holds no module at all: a daily
 *  worker in the workshop whose whole app is `/saya` (D331). He is how the
 *  sandbox shows the employee-only shell.
 */
export const SELF_EMPLOYEE_NO: Record<string, string> = {
  usr_evin: "K-001", usr_putri: "K-004", usr_anggun: "K-007",
  usr_andi: "K-011", usr_made: "K-014",
  usr_karjo: "B-009",
};

export function selfEmployeeId(state: DemoState, userId: string): string | null {
  const no = SELF_EMPLOYEE_NO[userId];
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
