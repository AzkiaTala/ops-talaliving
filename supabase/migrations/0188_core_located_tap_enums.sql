-- 0188_core_located_tap_enums.sql — a tap made away from the warehouse can
-- carry a photo, filed like any other document (D332).
--
-- On its own, like 0100, 0106, 0167 and 0187_core_leave_link_entity:
-- Postgres will not let a transaction use an enum value it added (F161), and
-- `0188_hr_located_tap` names both straight away — the label, the drive, the
-- folder, and the link `tap_self` writes. Apply this file first, then that one
-- (they sort in that order).
--
--   `foto_presensi`    its own kind, not `foto`: `foto` is filed in the
--                      PROCUREMENT drive (item photos, 0172), and a selfie at a
--                      clock-in is personal data, which belongs in HRD's (0035).
--                      The drive is chosen by kind alone, so the kind has to
--                      say so.
--   `attendance_scan`  the record the photo is filed against — one tap.

alter type ops_core.doc_kind_t add value if not exists 'foto_presensi';
alter type ops_core.link_entity_t add value if not exists 'attendance_scan';
