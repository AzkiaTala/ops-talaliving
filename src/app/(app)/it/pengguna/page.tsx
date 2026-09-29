"use client";

import { useMemo, useState } from "react";
import {
  UserCog, KeyRound, Check, UserPlus, Search, Mail, Power, PowerOff, Pencil, ShieldAlert, X,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader, type Tone } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime } from "@/lib/format";
import { isLiveMode } from "@/lib/live";
import { identity } from "@/demo/api";
import {
  MODULES, MODULE_LABEL, LEVELS, LEVEL_LABEL, AUTHORITIES, AUTHORITY_LABEL,
  describeGrant, IT_ACCESS_RULE, type ModuleName, type ModuleLevel, type Authority,
} from "@/lib/roles";
import {
  ACCOUNT_STATUS_LABEL, type AccountStatus, type UserDirectoryRow,
} from "@/services/identity/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Who works here, what they may open, and what they may decide — one screen.
 *
 *  Two halves (D325). **The account**: adding a person, correcting a name,
 *  switching an account off when somebody leaves, sending a link to set a
 *  password. **The access**: module grants and authorities, split on purpose
 *  (D24) — a module grant opens screens; an authority is a named decision,
 *  granted on its own and never implied by a level. The failure that split
 *  prevents is the one `john-lau` had: a confirm button that showed for anyone
 *  with `finance` and a backend that then refused it.
 *
 *  Every write here is decided by the database, as the person pressing the
 *  button; the screen only hides what it already knows will be refused.
 */

const STATUS_TONE: Record<AccountStatus, Tone> = { active: "green", pending: "amber", inactive: "slate" };
type Filter = "all" | AccountStatus;

const INPUT =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export default function UsersPage() {
  const { can, session } = useSession();
  const tr = useTr();
  const [users, reload] = useLoad(() => identity.listUsers(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const mayManage = can("it.manage_users");

  return (
    <div>
      <PageHeader
        breadcrumb="IT"
        title={tr("Users & access", "Pengguna & akses")}
        description={tr(
          "Add people, switch accounts off when somebody leaves, and decide what each person may open and decide. A module grant opens screens; an authority gives a decision — the second is never implied by the first.",
          "Tambah orang, nonaktifkan akun saat seseorang keluar, dan tentukan apa yang boleh dibuka dan diputuskan tiap orang. Grant modul membuka layar; wewenang memberi keputusan — yang kedua tidak pernah tersirat dari yang pertama.",
        )}
        actions={
          <div className="flex items-center gap-2">
            <SourceBadge state={users} />
            {mayManage && !adding && (
              <Button icon={UserPlus} className="whitespace-nowrap" onClick={() => setAdding(true)}>{tr("Add user", "Tambah pengguna")}</Button>
            )}
          </div>
        }
      />

      {adding && (
        <InviteForm
          onClose={() => setAdding(false)}
          /* Found by its address rather than left wherever the sort puts it —
             page three of the list is not where somebody who just added a
             person looks for them. */
          onAdded={(userId, email) => { setAdding(false); setFilter("all"); setQuery(email); setOpen(userId); reload(); }}
          onOpenExisting={(userId, email) => { setAdding(false); setFilter("all"); setQuery(email); setOpen(userId); }}
        />
      )}

      <Loaded state={users} onRetry={reload}>
        {(all) => {
          const counts: Record<Filter, number> = {
            all: all.length,
            active: all.filter((u) => u.status === "active").length,
            pending: all.filter((u) => u.status === "pending").length,
            inactive: all.filter((u) => u.status === "inactive").length,
          };
          const q = query.trim().toLowerCase();
          const shown = all.filter((u) =>
            (filter === "all" || u.status === filter)
            && (!q || u.user.full_name.toLowerCase().includes(q) || u.user.email.toLowerCase().includes(q)));

          return (
            <>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[12px] text-slate-600 shadow-card">
                {AUTHORITIES.map((a) => {
                  /* Only accounts that are on: a switched-off holder decides
                     nothing, and naming them here would say otherwise. */
                  const holders = all.filter((u) => u.user.is_active && u.authorities.includes(a));
                  return (
                    <p key={a} className="py-0.5">
                      <span className="font-medium text-slate-800">{AUTHORITY_LABEL[a]}</span>
                      {" — "}
                      {holders.length === 0
                        ? <span className="text-rose-700">{tr("nobody holds it", "tidak ada yang memegang")}</span>
                        : holders.map((u) => u.user.full_name).join(", ")}
                    </p>
                  );
                })}
              </div>

              <Card>
                <CardHeader
                  title={tr(`${all.length} users`, `${all.length} pengguna`)}
                  subtitle={tr("Click a person to manage their account and access. Every change is recorded in the audit log.", "Klik satu orang untuk mengelola akun dan aksesnya. Setiap perubahan tercatat di audit log.")}
                  icon={UserCog}
                />
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 pb-3">
                  <label className="relative min-w-[200px] flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      value={query} onChange={(e) => setQuery(e.target.value)}
                      placeholder={tr("Search name or email", "Cari nama atau email")}
                      className={cn(INPUT, "pl-8")}
                    />
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {(["all", "active", "pending", "inactive"] as Filter[]).map((f) => (
                      <Button
                        key={f} size="sm" variant={filter === f ? "primary" : "outline"}
                        onClick={() => setFilter(f)}
                      >
                        {f === "all" ? tr("All", "Semua") : ACCOUNT_STATUS_LABEL[f]} · {counts[f]}
                      </Button>
                    ))}
                  </div>
                </div>

                {shown.length === 0 ? (
                  <p className="px-5 py-6 text-center text-[13px] text-slate-500">
                    {tr("Nobody matches.", "Tidak ada yang cocok.")}
                  </p>
                ) : (
                  <Paged rows={shown} pageSize={12} unit={tr("users", "pengguna")}>
                    {(page) => (
                      <ul className="divide-y divide-slate-100">
                        {page.map((u) => (
                          <UserRow
                            key={u.user.id} u={u}
                            expanded={open === u.user.id}
                            isSelf={session?.user.id === u.user.id}
                            onToggle={() => setOpen(open === u.user.id ? null : u.user.id)}
                            reload={reload}
                          />
                        ))}
                      </ul>
                    )}
                  </Paged>
                )}
              </Card>
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

/* ── one person ─────────────────────────────────────────────────────────── */

function UserRow({ u, expanded, isSelf, onToggle, reload }: {
  u: UserDirectoryRow; expanded: boolean; isSelf: boolean; onToggle: () => void; reload: () => void;
}) {
  const tr = useTr();
  return (
    <li className="px-5 py-3">
      <button onClick={onToggle} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left">
        <span className="min-w-[170px] flex-1">
          <span className={cn("block text-[13px] font-medium", u.user.is_active ? "text-slate-800" : "text-slate-400 line-through decoration-slate-300")}>
            {u.user.full_name}
            {isSelf && <span className="ml-1.5 text-[11px] font-normal text-slate-400">({tr("you", "Anda")})</span>}
          </span>
          <span className="block font-mono text-[10px] text-slate-400">{u.user.email}</span>
        </span>
        <span className="text-[12px] text-slate-500">
          {tr(`${u.modules.length} modules · ${u.permissions.length} permissions`, `${u.modules.length} modul · ${u.permissions.length} izin`)}
        </span>
        {u.authorities.map((a) => (
          <Badge key={a} tone={u.user.is_active ? "brand" : "slate"}>{AUTHORITY_LABEL[a]}</Badge>
        ))}
        {u.status !== "active" && <Badge tone={STATUS_TONE[u.status]} dot>{ACCOUNT_STATUS_LABEL[u.status]}</Badge>}
      </button>

      {expanded && (
        <div className="mt-3 space-y-4">
          <AccountPanel u={u} isSelf={isSelf} reload={reload} />
          <AccessPanel u={u} reload={reload} />
        </div>
      )}
    </li>
  );
}

/* ── the account: name, status, link, on/off ───────────────────────────── */

function AccountPanel({ u, isSelf, reload }: { u: UserDirectoryRow; isSelf: boolean; reload: () => void }) {
  const { can } = useSession();
  const { toast } = useToast();
  const tr = useTr();
  const live = isLiveMode();
  const mayManage = can("it.manage_users");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(u.user.full_name);
  const [confirmOff, setConfirmOff] = useState(false);
  const [reason, setReason] = useState("");

  async function saveName() {
    setBusy(true);
    const res = await identity.updateUser(u.user.id, { full_name: name });
    setBusy(false);
    if (res.error) { toast("critical", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    setEditing(false);
    if (res.meta.outcome === "noop") return;
    toast("success", tr("Name changed", "Nama diubah"), res.data.user.full_name);
    reload();
  }

  async function sendLink() {
    setBusy(true);
    const res = await identity.sendUserLink(u.user.id);
    setBusy(false);
    if (res.error) { toast("critical", tr("Not sent", "Tidak terkirim"), res.error.message); return; }
    const what = res.data.kind === "invite"
      ? tr("Invitation sent again", "Undangan dikirim ulang")
      : tr("Password link sent", "Tautan kata sandi terkirim");
    toast("success", what, live
      ? tr(`To ${res.data.email}. The link works once, for one hour.`, `Ke ${res.data.email}. Tautannya sekali pakai, berlaku satu jam.`)
      : tr("Demo: no email is sent.", "Demo: tidak ada email yang dikirim."));
  }

  async function setActive(active: boolean) {
    setBusy(true);
    const res = await identity.setUserActive(u.user.id, { active, reason: active ? null : reason });
    setBusy(false);
    if (res.error) { toast("critical", tr("Not changed", "Tidak diubah"), res.error.message); return; }
    setConfirmOff(false);
    setReason("");
    const s = res.data.sign_in;
    const title = active
      ? tr("Account switched back on", "Akun diaktifkan kembali")
      : tr("Account switched off", "Akun dinonaktifkan");
    if (s === "blocked" || s === "allowed") {
      toast("success", title, active
        ? tr("Everything it held applies again.", "Semua yang dipegangnya berlaku lagi.")
        : tr("It holds nothing now, and can no longer sign in.", "Akun tidak memegang apa pun lagi, dan tidak bisa masuk."));
    } else {
      /* The part that matters happened; the sign-in half did not. Said, not
         hidden: a lock the screen implies and GoTrue does not have is the
         failure this row exists to avoid. */
      toast("warning", title, s === "not_configured"
        ? tr("Access is removed. The sign-in itself is not blocked yet: the server has no service key.", "Akses sudah dicabut. Masuknya sendiri belum diblokir: server belum punya service key.")
        : tr(`Access is removed. Blocking the sign-in failed: ${res.data.sign_in_detail ?? ""}`, `Akses sudah dicabut. Blokir masuk gagal: ${res.data.sign_in_detail ?? ""}`));
    }
    reload();
  }

  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">{tr("Account", "Akun")}</p>
      <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5 text-[12px]">
        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120}
              aria-label={tr("Full name", "Nama lengkap")}
              className={cn(INPUT, "max-w-sm py-1.5")}
              onKeyDown={(e) => { if (e.key === "Enter") void saveName(); if (e.key === "Escape") setEditing(false); }}
            />
            <Button size="sm" icon={Check} disabled={busy || !name.trim()} onClick={saveName}>{tr("Save", "Simpan")}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setName(u.user.full_name); }}>{tr("Cancel", "Batal")}</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-700">{u.user.full_name}</span>
            {mayManage && (
              <Button size="sm" variant="ghost" icon={Pencil} onClick={() => { setName(u.user.full_name); setEditing(true); }}>
                {tr("Rename", "Ubah nama")}
              </Button>
            )}
          </div>
        )}

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500">
          <Badge tone={STATUS_TONE[u.status]} dot>{ACCOUNT_STATUS_LABEL[u.status]}</Badge>
          {u.invited_at && <span>{tr("Invited", "Diundang")} {formatDate(new Date(u.invited_at))}</span>}
          {/* *Never signed in* only where the status says so. The demo's own
              people carry no sign-in time and are not pending; live, an active
              account always has one. */}
          {u.last_sign_in_at
            ? <span>{tr("Last signed in", "Terakhir masuk")} {formatDateTime(new Date(u.last_sign_in_at))}</span>
            : u.status === "pending" && <span>{tr("Has never signed in", "Belum pernah masuk")}</span>}
        </p>

        {!u.user.is_active && (
          <p className="flex items-start gap-1.5 text-slate-600">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            {u.sign_in_blocked
              ? tr("Switched off: holds nothing and cannot sign in. The grants below are kept and apply again if the account is switched back on.", "Nonaktif: tidak memegang apa pun dan tidak bisa masuk. Grant di bawah disimpan dan berlaku lagi jika akun diaktifkan kembali.")
              : tr("Switched off: holds nothing. The sign-in page still accepts the password — the block was not applied (no service key at the time).", "Nonaktif: tidak memegang apa pun. Halaman masuk masih menerima kata sandinya — blokir belum diterapkan (saat itu belum ada service key).")}
          </p>
        )}

        {mayManage && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {u.user.is_active && (
              <Button size="sm" variant="outline" icon={Mail} disabled={busy} onClick={sendLink}>
                {u.status === "pending"
                  ? tr("Send the invitation again", "Kirim ulang undangan")
                  : tr("Send a password link", "Kirim tautan atur kata sandi")}
              </Button>
            )}
            {u.user.is_active && !confirmOff && (
              <Button
                size="sm" variant="outline" icon={PowerOff} disabled={busy || isSelf}
                title={isSelf ? tr("Another IT administrator has to do this.", "Harus dilakukan administrator IT lain.") : undefined}
                onClick={() => setConfirmOff(true)}
              >
                {tr("Switch off", "Nonaktifkan")}
              </Button>
            )}
            {!u.user.is_active && (
              <Button size="sm" variant="outline" icon={Power} disabled={busy} onClick={() => setActive(true)}>
                {tr("Switch back on", "Aktifkan kembali")}
              </Button>
            )}
            {!u.user.is_active && !u.sign_in_blocked && live && (
              <Button size="sm" variant="outline" icon={PowerOff} disabled={busy} onClick={() => setActive(false)}>
                {tr("Block the sign-in now", "Blokir masuk sekarang")}
              </Button>
            )}
            {isSelf && u.user.is_active && (
              <span className="text-[11px] text-slate-400">
                {tr("Your own account is switched off by another IT administrator.", "Akun Anda sendiri dinonaktifkan oleh administrator IT lain.")}
              </span>
            )}
          </div>
        )}

        {confirmOff && (
          <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2.5">
            <p className="text-rose-900">
              {tr(
                `Switch off ${u.user.full_name}? They lose every module and authority at once and can no longer sign in. Nothing is deleted — their name stays on everything they did, and switching the account back on restores what it held.`,
                `Nonaktifkan ${u.user.full_name}? Semua modul dan wewenangnya langsung tidak berlaku dan ia tidak bisa masuk lagi. Tidak ada yang dihapus — namanya tetap pada semua yang pernah ia kerjakan, dan mengaktifkan kembali akunnya memulihkan apa yang dipegangnya.`,
              )}
            </p>
            <input
              value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200}
              placeholder={tr("Reason, for the audit log (e.g. resigned, contract ended)", "Alasan, untuk audit log (mis. resign, kontrak selesai)")}
              className={cn(INPUT, "py-1.5")}
            />
            <div className="flex gap-2">
              <Button size="sm" variant="danger" icon={PowerOff} disabled={busy} onClick={() => setActive(false)}>
                {tr("Switch off", "Nonaktifkan")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setConfirmOff(false); setReason(""); }}>{tr("Cancel", "Batal")}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── the access: modules and authorities ───────────────────────────────── */

function AccessPanel({ u, reload }: { u: UserDirectoryRow; reload: () => void }) {
  const { can } = useSession();
  const { toast } = useToast();
  const tr = useTr();
  const [busy, setBusy] = useState(false);
  const mayManage = can("it.manage_users");
  const mayRoles = can("it.manage_roles");

  async function setLevel(module: ModuleName, level: ModuleLevel | null) {
    const next = u.modules.filter((g) => g.module !== module);
    if (level) next.push({ module, level });
    setBusy(true);
    const res = await identity.setModules(u.user.id, next);
    setBusy(false);
    if (res.error) { toast("critical", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr("Access changed", "Akses diubah"), `${MODULE_LABEL[module]} — ${level ? LEVEL_LABEL[level] : tr("revoked", "dicabut")}`);
    reload();
  }

  async function toggleAuthority(authority: Authority) {
    const held = u.authorities;
    const next = held.includes(authority) ? held.filter((a) => a !== authority) : [...held, authority];
    setBusy(true);
    const res = await identity.setAuthorities(u.user.id, next);
    setBusy(false);
    if (res.error) { toast("critical", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", held.includes(authority) ? tr("Authority revoked", "Wewenang dicabut") : tr("Authority granted", "Wewenang diberikan"), AUTHORITY_LABEL[authority]);
    reload();
  }

  return (
    <div className={cn("space-y-3", !u.user.is_active && "opacity-60")}>
      {u.status === "pending" && u.modules.length === 0 && (
        <p className="text-[11px] text-amber-700">
          {tr(
            "A new account holds nothing until you grant it. Grant the modules now; they apply the moment the person first signs in.",
            "Akun baru tidak memegang apa pun sampai diberi grant. Beri modulnya sekarang; berlaku begitu orangnya pertama kali masuk.",
          )}
        </p>
      )}
      <div>
        <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">{tr("Module access", "Akses modul")}</p>
        <ul className="space-y-1">
          {MODULES.map((m) => {
            const grant = u.modules.find((g) => g.module === m);
            return (
              <li key={m} className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="w-[110px] text-slate-700">{MODULE_LABEL[m]}</span>
                {LEVELS.map((l) => (
                  <Button
                    key={l} size="sm"
                    variant={grant?.level === l ? "primary" : "outline"}
                    disabled={busy || !mayManage}
                    onClick={() => setLevel(m, grant?.level === l ? null : l)}
                  >
                    {LEVEL_LABEL[l]}
                  </Button>
                ))}
                <span className="text-[11px] text-slate-400">
                  {grant ? describeGrant(m, grant.level) : tr("no access", "tidak punya akses")}
                </span>
                {m === "it" && (
                  <span className="basis-full pl-[118px] text-[11px] text-amber-700">
                    {tr(IT_ACCESS_RULE.en, IT_ACCESS_RULE.id)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-400">
          <KeyRound className="h-3 w-3" /> {tr("Authorities", "Wewenang")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {AUTHORITIES.map((a) => (
            <Button
              key={a} size="sm"
              variant={u.authorities.includes(a) ? "primary" : "outline"}
              icon={u.authorities.includes(a) ? Check : undefined}
              disabled={busy || !mayRoles}
              onClick={() => toggleAuthority(a)}
            >
              {AUTHORITY_LABEL[a]}
            </Button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          {tr("Authorities are granted one by one. The", "Wewenang diberikan sendiri-sendiri. Level")} <em>Full</em>{" "}
          {tr(
            "level on a module never lets somebody approve money.",
            "pada sebuah modul tidak pernah membuat orang bisa menyetujui uang.",
          )}
        </p>
      </div>
    </div>
  );
}

/* ── adding a person ────────────────────────────────────────────────────── */

function InviteForm({ onClose, onAdded, onOpenExisting }: {
  onClose: () => void;
  onAdded: (userId: string, email: string) => void;
  onOpenExisting: (userId: string, email: string) => void;
}) {
  const { toast } = useToast();
  const tr = useTr();
  const live = isLiveMode();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ field: string | null; message: string; existing: string | null } | null>(null);
  const ready = useMemo(() => name.trim().length > 0 && email.includes("@"), [name, email]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    const res = await identity.inviteUser({ email, full_name: name });
    setBusy(false);
    if (res.error) {
      const d = res.error.detail ?? {};
      setProblem({
        field: typeof d.field === "string" ? d.field : null,
        message: res.error.message,
        existing: typeof d.user_id === "string" ? d.user_id : null,
      });
      return;
    }
    toast("success", tr("User added", "Pengguna ditambahkan"), live
      ? tr(`An invitation went to ${res.data.email}. Grant their modules now.`, `Undangan terkirim ke ${res.data.email}. Beri modulnya sekarang.`)
      : tr("Demo: no email is sent. Grant their modules now.", "Demo: tidak ada email yang dikirim. Beri modulnya sekarang."));
    onAdded(res.data.user_id, res.data.email);
  }

  return (
    <Card className="mb-4">
      <form onSubmit={submit} className="space-y-3 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <UserPlus className="h-4 w-4 text-brand-600" /> {tr("Add a user", "Tambah pengguna")}
            </h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {tr(
                "They get an email with a link to create their password. The account starts with no access at all — you grant modules on the next step.",
                "Mereka menerima email berisi tautan untuk membuat kata sandi. Akunnya mulai tanpa akses sama sekali — modul diberikan di langkah berikutnya.",
              )}
            </p>
          </div>
          <Button type="button" size="sm" variant="ghost" icon={X} onClick={onClose} aria-label={tr("Close", "Tutup")} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="block text-[13px] font-medium text-slate-700">{tr("Full name", "Nama lengkap")}</span>
            <input
              value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120}
              className={cn(INPUT, "mt-1.5", problem?.field === "full_name" && "border-rose-300")}
            />
          </label>
          <label className="block">
            <span className="block text-[13px] font-medium text-slate-700">Email</span>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off"
              placeholder="nama@talaliving.com"
              className={cn(INPUT, "mt-1.5", problem?.field === "email" && "border-rose-300")}
            />
          </label>
        </div>

        {problem && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2 text-[13px] text-rose-900">
            <span>{problem.message}</span>
            {problem.existing && (
              <Button type="button" size="sm" variant="outline" onClick={() => onOpenExisting(problem.existing as string, email.trim().toLowerCase())}>
                {tr("Open that account", "Buka akun itu")}
              </Button>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button type="submit" icon={Mail} disabled={busy || !ready}>
            {busy ? tr("Sending…", "Mengirim…") : tr("Add and send the invitation", "Tambah dan kirim undangan")}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>{tr("Cancel", "Batal")}</Button>
        </div>
      </form>
    </Card>
  );
}
