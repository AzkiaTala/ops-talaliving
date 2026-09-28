/** Everything John Lau can be asked to do — and everything it cannot.
 *
 *  The blocked entries are **in this list on purpose** rather than absent from
 *  it. A capability that is missing produces *saya tidak mengerti*, which
 *  teaches the person to rephrase until something works. A capability that is
 *  present and refused produces *tidak bisa lewat prompt, dan ini alasannya* —
 *  which ends the conversation honestly and points at the screen where a human
 *  may look, with the look recorded (D218).
 *
 *  This file is the security boundary. Not a system prompt, not an instruction
 *  to a model: a list the executor reads. In Phase 2 a model chooses **from**
 *  this catalogue and still cannot reach past it, because the refusal is in the
 *  dispatcher rather than in the model's good intentions.
 */
import type { AssistantTool, ToolSeam } from "@/services/assistant/contracts";
import type { Message, Lang } from "@/lib/i18n";

/** The catalogue holds **both languages**; the dispatcher resolves one before
 *  the tool leaves the service (D224). Resolving at the edge rather than in the
 *  screen means a Phase-2 HTTP client gets a finished sentence, and the
 *  language of a refusal is decided in the same place the refusal is. */
export interface ToolDef extends Omit<AssistantTool, "label" | "blocked_reason"> {
  label: Message;
  blocked_reason: Message | null;
}

export function resolveTool(t: ToolDef, lang: Lang): AssistantTool {
  return {
    ...t,
    label: t.label[lang],
    blocked_reason: t.blocked_reason ? t.blocked_reason[lang] : null,
  };
}

export const TOOLS: ToolDef[] = [
  /* ── Reading ──────────────────────────────────────────────────────── */
  {
    name: "procurement.pending_approvals", module: "procurement", level: "read",
    effect: "read", reach: "open",
    label: { en: "Request lines waiting for approval", id: "Baris permintaan yang menunggu persetujuan" },
    blocked_reason: null, instead_at: "/procurement/meeting",
  },
  {
    name: "procurement.vendor_debt", module: "procurement", level: "read",
    effect: "read", reach: "open",
    label: { en: "What we still owe a vendor", id: "Berapa yang masih kita hutang ke sebuah vendor" },
    blocked_reason: null, instead_at: "/procurement/tracker",
  },
  {
    name: "accounting.balances", module: "accounting", level: "read",
    effect: "read", reach: "open",
    label: { en: "Balance of each account", id: "Saldo tiap rekening" },
    blocked_reason: null, instead_at: "/accounting/ledger",
  },
  {
    name: "inventory.low_stock", module: "inventory", level: "read",
    effect: "read", reach: "open",
    label: { en: "Items already below their minimum", id: "Barang yang sudah di bawah stok minimum" },
    blocked_reason: null, instead_at: "/inventory/material",
  },
  {
    name: "production.late_orders", module: "production", level: "read",
    effect: "read", reach: "open",
    label: { en: "Work orders past their promised date", id: "SPK yang lewat tanggal janji" },
    blocked_reason: null, instead_at: "/produksi/jadwal",
  },
  {
    name: "delivery.fulfilment", module: "project", level: "read",
    effect: "read", reach: "open",
    label: { en: "How much of a client order has arrived and been fitted", id: "Sudah berapa banyak pesanan klien yang sampai dan terpasang" },
    blocked_reason: null, instead_at: "/proyek/serah-terima",
  },

  /* ── Guidance ─────────────────────────────────────────────────────── */
  {
    name: "guide.create_po", module: null, level: "read",
    effect: "guide", reach: "open",
    label: { en: "How to create a purchase order", id: "Cara membuat purchase order" },
    blocked_reason: null, instead_at: "/procurement/po",
  },
  {
    name: "guide.receive_goods", module: null, level: "read",
    effect: "guide", reach: "open",
    label: { en: "How to record goods arriving", id: "Cara mencatat barang datang" },
    blocked_reason: null, instead_at: "/procurement/penerimaan",
  },
  {
    name: "guide.pay_line", module: null, level: "read",
    effect: "guide", reach: "open",
    label: { en: "How to pay a request line", id: "Cara membayar sebuah baris permintaan" },
    blocked_reason: null, instead_at: "/procurement/tracker",
  },

  /* ── Writing, and only ever as a draft ────────────────────────────── */
  {
    name: "procurement.draft_pr_line", module: "procurement", level: "write",
    effect: "write", reach: "open",
    label: { en: "Draft a new purchase request line", id: "Menyiapkan baris permintaan pembelian baru" },
    blocked_reason: null, instead_at: "/procurement/pr/new",
  },
  {
    name: "procurement.draft_po", module: "procurement", level: "write",
    effect: "write", reach: "open",
    label: { en: "Draft a new purchase order", id: "Menyiapkan purchase order baru" },
    blocked_reason: null, instead_at: "/procurement/po",
  },
  {
    name: "hr.draft_leave", module: "hrd", level: "write",
    effect: "write", reach: "open",
    label: { en: "Draft a leave, permit or sick-day request", id: "Menyiapkan pengajuan cuti, izin atau sakit" },
    blocked_reason: null, instead_at: "/hrd/cuti",
  },
  {
    name: "marketing.draft_market", module: "marketing", level: "write",
    effect: "write", reach: "open",
    label: { en: "Define a new market", id: "Menyiapkan pasar baru" },
    blocked_reason: null, instead_at: "/marketing/pipeline",
  },

  /* ── Never, at any grant ──────────────────────────────────────────── */
  {
    name: "hr.employee_files", module: "hrd", level: "read",
    effect: "read", reach: "blocked",
    label: { en: "Employee files — ID card, family card, contract, tax and insurance numbers", id: "Berkas 201 — KTP, kartu keluarga, kontrak, NPWP, BPJS" },
    blocked_reason: {
      en: "Employee files cannot be read through the prompt, at any level of access. Identity numbers are opened one at a time by a person, with an eye button, and every opening is recorded in the audit trail under that person's name. A conversation cannot carry that trail: it can copy, forward, and answer ten numbers at once.",
      id: "Berkas 201 tidak bisa dibaca lewat prompt, pada tingkat akses mana pun. Nomor identitas dibuka satu per satu oleh orang, dengan tombol mata, dan setiap pembukaan tercatat atas nama orang itu di audit. Percakapan tidak bisa memberikan jejak itu: ia bisa menyalin, meneruskan, dan menjawab sepuluh nomor sekaligus.",
    },
    instead_at: "/hrd/berkas-201",
  },
  {
    name: "hr.payroll", module: "payroll", level: "read",
    effect: "read", reach: "blocked",
    label: { en: "Salaries, payslips, pay adjustments", id: "Gaji, slip gaji, penyesuaian upah" },
    blocked_reason: {
      en: "Individual pay is not read through the prompt. Confirmed by the owner after it was proposed as a default: one person's salary is the same class of exposure as their ID number, and it is far easier to ask for everybody's at once.",
      id: "Gaji per orang tidak dibaca lewat prompt. Dikonfirmasi pemilik setelah diusulkan sebagai default: nominal gaji satu orang adalah paparan sejenis dengan nomor KTP, dan jauh lebih mudah dimintakan sekaligus untuk semua orang.",
    },
    instead_at: "/hrd/payroll",
  },
  {
    name: "hr.attendance", module: "hrd", level: "read",
    effect: "read", reach: "blocked",
    label: { en: "Attendance and lateness per person", id: "Absensi dan keterlambatan per orang" },
    blocked_reason: {
      en: "Attendance per person is not read through the prompt, for the same reason as pay: easy to ask for wholesale, and what comes out is a record about people rather than about the company. Confirmed by the owner.",
      id: "Kehadiran per orang tidak dibaca lewat prompt, alasan yang sama dengan gaji: mudah diminta sekaligus, dan yang keluar adalah catatan tentang orang, bukan tentang perusahaan. Dikonfirmasi pemilik.",
    },
    instead_at: "/hrd/absensi",
  },
  {
    name: "it.audit", module: "it", level: "read",
    effect: "read", reach: "blocked",
    label: { en: "Audit log, activity log, users, roles", id: "Audit log, log aktivitas, pengguna, peran" },
    blocked_reason: {
      en: "The IT module cannot be read through the prompt at all (owner). The audit trail is a record of what people did; reading it through a conversation turns it into a way to watch a colleague with one sentence. Only IT and leadership may open it, on its own screen.",
      id: "Modul IT tidak bisa dibaca lewat prompt sama sekali (pemilik). Jejak audit adalah catatan tentang apa yang dilakukan orang; membacanya lewat percakapan menjadikannya alat untuk mengawasi rekan kerja dengan satu kalimat. Yang boleh membukanya hanya IT dan pimpinan, di layarnya sendiri.",
    },
    instead_at: "/it/audit",
  },
  {
    name: "it.settings_write", module: "settings", level: "write",
    effect: "write", reach: "blocked",
    label: { en: "Change system settings", id: "Mengubah pengaturan sistem" },
    blocked_reason: {
      en: "Settings are not changed through the prompt. Five of the twelve rewrite figures that already exist, and the difference between the safe ones and the rest is exactly what a sentence loses — on the screen that difference is the first thing you read.",
      id: "Pengaturan tidak diubah lewat prompt. Lima dari dua belas pengaturan mengubah angka yang sudah ada, dan perbedaan antara yang aman dan yang tidak justru hilang dalam kalimat percakapan — di layarnya perbedaan itu yang pertama terbaca.",
    },
    instead_at: "/pengaturan",
  },
];

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** The write tools that declare their seam instead of being coded (D317) —
 *  the sandbox's copy of `ops_asst.v_tool_seams`, row for row.
 *
 *  Written out in the database's own shape (both languages, flat), because
 *  `scripts/check-john-lau.mjs` compares the two and refuses any difference:
 *  a card the demo shows with a field the database does not declare is a demo
 *  that promises a write the real one will not make. */
export const SEAMS: ToolSeam[] = [
  {
    tool: "procurement.draft_pr_line", kind: "api", seam: "procurement.quickAddLine",
    key_param: null, result_ref: "line_no_full",
    headline_en: "New purchase request line", headline_id: "Baris permintaan pembelian baru",
    note_en: "This goes in as a request, not as an approval. Approving it stays a person's act, on the meeting board.",
    note_id: "Baris ini masuk sebagai permintaan, bukan sebagai persetujuan. Yang menyetujui tetap orang, di papan rapat.",
    fields: [
      { key: "item", param: "description", type: "text", required: true, label_en: "Item", label_id: "Barang", choices: null, arg: "name", default_kind: "blank", default_en: null, default_id: null },
      { key: "qty", param: "qty", type: "number", required: true, label_en: "Quantity", label_id: "Jumlah", choices: null, arg: "qty", default_kind: "blank", default_en: null, default_id: null },
      { key: "uom", param: "uom", type: "text", required: true, label_en: "Unit", label_id: "Satuan", choices: null, arg: "uom", default_kind: "blank", default_en: null, default_id: null },
      { key: "purpose", param: "purpose", type: "text", required: false, label_en: "Purpose", label_id: "Keperluan", choices: null, arg: "purpose", default_kind: "text", default_en: "Requested through John Lau", default_id: "Diminta lewat John Lau" },
    ],
  },
  {
    tool: "marketing.draft_market", kind: "rpc", seam: "ops_mkt.create_market",
    key_param: "p_key", result_ref: "code",
    headline_en: "New market", headline_id: "Pasar baru",
    note_en: "The code is COUNTRY[-REGION]-CITY-AREA and every filter is a prefix of it. The database checks the code, the country, the currency and the time zone, and says which one is wrong.",
    note_id: "Kodenya NEGARA[-WILAYAH]-KOTA-AREA dan setiap filter adalah awalan dari kode itu. Database memeriksa kode, negara, mata uang dan zona waktunya, dan menyebut mana yang salah.",
    fields: [
      { key: "code", param: "p_code", type: "text", required: true, label_en: "Market code (e.g. AU-QLD-GOLDCOAST-SPNORTH)", label_id: "Kode pasar (mis. AU-QLD-GOLDCOAST-SPNORTH)", choices: null, arg: "code", default_kind: "blank", default_en: null, default_id: null },
      { key: "country_code", param: "p_country_code", type: "text", required: true, label_en: "Country code (ISO, 2 letters)", label_id: "Kode negara (ISO, 2 huruf)", choices: null, arg: "country_code", default_kind: "blank", default_en: null, default_id: null },
      { key: "country_name", param: "p_country_name", type: "text", required: true, label_en: "Country", label_id: "Negara", choices: null, arg: "country_name", default_kind: "blank", default_en: null, default_id: null },
      { key: "region", param: "p_region", type: "text", required: false, label_en: "Region / state", label_id: "Wilayah / provinsi", choices: null, arg: "region", default_kind: "blank", default_en: null, default_id: null },
      { key: "city", param: "p_city", type: "text", required: true, label_en: "City", label_id: "Kota", choices: null, arg: "city", default_kind: "blank", default_en: null, default_id: null },
      { key: "area_label", param: "p_area_label", type: "text", required: true, label_en: "Area, as it is called there", label_id: "Area, sebutan setempat", choices: null, arg: "area_label", default_kind: "blank", default_en: null, default_id: null },
      { key: "currency", param: "p_currency", type: "text", required: true, label_en: "Currency (ISO, 3 letters)", label_id: "Mata uang (ISO, 3 huruf)", choices: null, arg: "currency", default_kind: "blank", default_en: null, default_id: null },
      { key: "timezone", param: "p_timezone", type: "text", required: true, label_en: "Time zone (e.g. Australia/Brisbane)", label_id: "Zona waktu (mis. Australia/Brisbane)", choices: null, arg: "timezone", default_kind: "blank", default_en: null, default_id: null },
      { key: "language", param: "p_language", type: "text", required: false, label_en: "Outreach language", label_id: "Bahasa penjangkauan", choices: null, arg: "language", default_kind: "text", default_en: "en", default_id: "en" },
    ],
  },
];

export function findSeam(tool: string): ToolSeam | undefined {
  return SEAMS.find((s) => s.tool === tool);
}
