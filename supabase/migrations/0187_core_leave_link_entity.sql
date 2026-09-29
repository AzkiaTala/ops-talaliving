-- 0187_core_leave_link_entity.sql — a leave request can carry its own papers.
--
-- On its own, like 0106 (`asset`), 0155 (`log_cost`) and 0167 (`item`):
-- Postgres will not let a transaction use an enum value it added (F161), and
-- `0187_hr_sick_note` uses this one straight away — its trigger, its view and
-- its folder all name 'leave_request'. Apply this file first, then that one.
--
-- Keyed by the request's public number (`izn-26-09-29_01`), the way every
-- other link names its parent (ADR-004). (D331)

alter type ops_core.link_entity_t add value if not exists 'leave_request';
