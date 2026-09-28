"use client";

import { useState } from "react";
import { Landmark, Plus, Pencil, Trash2, Lock } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/drawer";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { accounting } from "@/demo/api";
import type { AccountBalance, AccountCustody } from "@/services/accounting/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { useTr } from "@/lib/i18n";

/** The money accounts — bank accounts and petty cash (`0105`).
 *
 *  The code is what every ledger row is written against, so it is fixed at
 *  creation; the currency is fixed once a transaction is booked on the
 *  account. An opening balance moves every balance after it, so changing it
 *  needs a reason, which the audit log keeps with the old and new figures.
 *
 *  Leadership accounts (D87) never pay a vendor directly, and are changed
 *  only by someone who approves funds. An account in use is deactivated, not
 *  deleted: it leaves the pickers and keeps its history.
 */
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none";

type Form = {
  mode: "create" | "edit";
  code: string; name: string; custody: AccountCustody; is_paying: boolean;
  currency: string; opening_balance: number; opened_on: string; is_active: boolean;
  original_balance: number; reason: string;
};

type Row = AccountBalance & { balance_locked?: boolean };

export default function AccountsPage() {
  const tr = useTr();
  const { can, hasAuthority } = useSession();
  const { toast } = useToast();
  const [state, reload] = useLoad(() => accounting.listAccounts(), []);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  const mayEdit = can("accounting.update") && hasAuthority("post_ledger");
  const mayLeadership = hasAuthority("approve_funds");
  const mayTouch = (custody: AccountCustody) => mayEdit && (custody !== "leadership" || mayLeadership);

  async function save() {
    if (!form) return;
    setSaving(true);
    const res = form.mode === "create"
      ? await accounting.createAccount({
        code: form.code, name: form.name, custody: form.custody, is_paying: form.is_paying,
        currency: form.currency, opening_balance: form.opening_balance, opened_on: form.opened_on || undefined,
      })
      : await accounting.updateAccount(form.code, {
        name: form.name, custody: form.custody, is_paying: form.is_paying, currency: form.currency,
        opening_balance: form.opening_balance, opened_on: form.opened_on || undefined,
        is_active: form.is_active,
        ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
      });
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", form.mode === "create" ? tr("Account added", "Rekening ditambahkan") : tr("Account saved", "Rekening tersimpan"), `${res.data.code} — ${res.data.name}`);
    setForm(null);
    reload();
  }

  async function remove() {
    if (!form) return;
    setSaving(true);
    const res = await accounting.deleteAccount(form.code);
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not deleted", "Tidak terhapus"), res.error.message);
      return;
    }
    toast("success", tr("Account deleted", "Rekening dihapus"), tr(`${form.code} is gone. Nothing was booked on it.`, `${form.code} sudah dihapus. Tidak ada yang dibukukan di rekening ini.`));
    setForm(null);
    reload();
  }

  function openEdit(a: Row) {
    setForm({
      mode: "edit", code: a.code, name: a.name, custody: a.custody, is_paying: a.is_paying,
      currency: a.currency, opening_balance: Number(a.opening_balance), opened_on: a.opened_on ?? "",
      is_active: a.is_active !== false, original_balance: Number(a.opening_balance), reason: "",
    });
  }

  const columns: Column<Row>[] = [
    {
      key: "code",
      header: tr("Account", "Rekening"),
      render: (a) => (
        <div>
          <p className="font-medium text-slate-800">
            {a.code}
            {a.is_active === false && <Badge tone="slate" className="ml-2">{tr("Inactive", "Nonaktif")}</Badge>}
          </p>
          <p className="text-[11px] text-slate-500">{a.name}</p>
        </div>
      ),
    },
    {
      key: "custody",
      header: tr("Held by", "Dipegang oleh"),
      render: (a) => a.custody === "leadership"
        ? <Badge tone="violet">{tr("Leadership", "Pimpinan")}</Badge>
        : <Badge tone="slate">{tr("Accounting", "Accounting")}</Badge>,
    },
    {
      key: "paying",
      header: tr("Pays vendors", "Membayar vendor"),
      render: (a) => (a.is_paying ? <Badge tone="green" dot>{tr("Yes", "Ya")}</Badge> : <span className="text-slate-400">{tr("No", "Tidak")}</span>),
    },
    { key: "cur", header: tr("Currency", "Mata uang"), render: (a) => <span className="font-mono text-[12px] text-slate-600">{a.currency}</span> },
    {
      key: "open",
      header: tr("Opening balance", "Saldo awal"),
      align: "right",
      render: (a) => a.balance_locked
        ? <span className="text-slate-300">&mdash;</span>
        : <span className="tabular-nums text-slate-600">{formatIDR(Number(a.opening_balance))}</span>,
    },
    {
      key: "bal",
      header: tr("Balance now", "Saldo sekarang"),
      align: "right",
      render: (a) => a.balance_locked
        ? <span className="inline-flex items-center gap-1 text-slate-400"><Lock className="h-3 w-3" /> {tr("locked", "terkunci")}</span>
        : <span className="tabular-nums font-medium text-slate-800">{formatIDR(Number(a.balance))}</span>,
    },
    {
      key: "edit",
      header: "",
      render: (a) => mayTouch(a.custody) ? (
        <Button variant="ghost" size="sm" icon={Pencil} aria-label={tr(`Edit ${a.code}`, `Ubah ${a.code}`)} onClick={() => openEdit(a)}>
          <span className="sr-only">{tr("Edit", "Ubah")}</span>
        </Button>
      ) : null,
    },
  ];

  const balanceChanged = !!form && form.mode === "edit" && form.opening_balance !== form.original_balance;

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Master Data", "Data Master")}
        title={tr("Accounts", "Rekening")}
        description={tr("Bank accounts and petty cash. The code is fixed once created; an opening balance change needs a reason.", "Rekening bank dan kas kecil. Kode tidak bisa diubah setelah dibuat; perubahan saldo awal memerlukan alasan.")}
        actions={mayEdit && (
          <Button icon={Plus} onClick={() => setForm({
            mode: "create", code: "", name: "", custody: "accounting", is_paying: true, currency: "IDR",
            opening_balance: 0, opened_on: "", is_active: true, original_balance: 0, reason: "",
          })}>
            {tr("Add account", "Tambah rekening")}
          </Button>
        )}
      />

      <Card>
        <CardHeader
          title={tr("All accounts", "Semua rekening")}
          subtitle={tr("Leadership accounts never pay a vendor directly and are changed only by someone who approves funds.", "Rekening pimpinan tidak pernah membayar vendor secara langsung dan hanya diubah oleh orang yang menyetujui dana.")}
          icon={Landmark}
          action={<SourceBadge state={state} />}
        />
        <Loaded state={state} onRetry={reload}>
          {(rows) => (
            <DataTable columns={columns} rows={rows as Row[]} rowKey={(a) => a.account_id} dense empty={tr("No accounts.", "Belum ada rekening.")} />
          )}
        </Loaded>
        {!mayEdit && (
          <p className="border-t border-slate-100 px-4 py-3 text-[12px] text-slate-500">
            {tr("Editing accounts needs accounting write access and the post_ledger authority.", "Mengubah rekening memerlukan akses tulis accounting dan wewenang post_ledger.")}
          </p>
        )}
      </Card>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.mode === "create" ? tr("Add account", "Tambah rekening") : tr(`Edit ${form?.code ?? ""}`, `Ubah ${form?.code ?? ""}`)}>
        {form && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="acc-code" className="block text-sm text-slate-600">{tr("Code", "Kode")}</label>
                <input
                  id="acc-code"
                  value={form.code}
                  disabled={form.mode === "edit"}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder={tr("e.g. MANDIRI 123", "mis. MANDIRI 123")}
                  className={inputClass + " font-mono disabled:bg-slate-50 disabled:text-slate-500"}
                />
              </div>
              <div>
                <label htmlFor="acc-currency" className="block text-sm text-slate-600">{tr("Currency", "Mata uang")}</label>
                <input
                  id="acc-currency"
                  value={form.currency}
                  maxLength={3}
                  onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                  className={inputClass + " font-mono"}
                />
              </div>
            </div>
            <div>
              <label htmlFor="acc-name" className="block text-sm text-slate-600">{tr("Name", "Nama")}</label>
              <input
                id="acc-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={tr("e.g. Mandiri ...123 (operations)", "mis. Mandiri ...123 (operasional)")}
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="acc-custody" className="block text-sm text-slate-600">{tr("Held by", "Dipegang oleh")}</label>
                <select
                  id="acc-custody"
                  value={form.custody}
                  onChange={(e) => {
                    const custody = e.target.value as AccountCustody;
                    setForm({ ...form, custody, is_paying: custody === "leadership" ? false : form.is_paying });
                  }}
                  className={inputClass + " bg-white"}
                >
                  <option value="accounting">{tr("Accounting", "Accounting")}</option>
                  {(mayLeadership || form.custody === "leadership") && <option value="leadership">{tr("Leadership", "Pimpinan")}</option>}
                </select>
              </div>
              <label className="mt-6 flex items-center gap-2 text-sm text-slate-700">
                <input
                  id="acc-paying" type="checkbox"
                  checked={form.is_paying}
                  disabled={form.custody === "leadership"}
                  onChange={(e) => setForm({ ...form, is_paying: e.target.checked })}
                />
                {tr("Pays vendors", "Membayar vendor")}
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="acc-opening" className="block text-sm text-slate-600">{tr("Opening balance", "Saldo awal")}</label>
                <MoneyInput
                  id="acc-opening"
                  value={form.opening_balance}
                  onChange={(v) => setForm({ ...form, opening_balance: v })}
                  className="mt-1"
                />
              </div>
              <div>
                <label htmlFor="acc-opened" className="block text-sm text-slate-600">{tr("As of", "Per tanggal")}</label>
                <input
                  id="acc-opened" type="date"
                  value={form.opened_on}
                  onChange={(e) => setForm({ ...form, opened_on: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
            {balanceChanged && (
              <div>
                <label htmlFor="acc-reason" className="block text-sm text-slate-600">
                  {tr("Why the opening balance changes", "Alasan saldo awal berubah")} <span className="text-rose-700">{tr("— required", "— wajib")}</span>
                </label>
                <textarea
                  id="acc-reason"
                  rows={2}
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder={tr("e.g. balance per bank statement on 1 January", "mis. saldo sesuai rekening koran per 1 Januari")}
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-slate-500">
                  {tr(`Every balance after it moves by ${formatIDR(form.opening_balance - form.original_balance)}. The old and new figures go to the audit log.`, `Setiap saldo sesudahnya bergeser sebesar ${formatIDR(form.opening_balance - form.original_balance)}. Angka lama dan baru dicatat di log audit.`)}
                </p>
              </div>
            )}
            {form.mode === "edit" && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  id="acc-active" type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                {tr("Active — shown in the pickers", "Aktif — ditampilkan di pilihan")}
              </label>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              {form.mode === "edit" && (
                <Button variant="ghost" icon={Trash2} className="mr-auto text-rose-700" disabled={saving} onClick={remove}>
                  {tr("Delete", "Hapus")}
                </Button>
              )}
              <Button variant="outline" onClick={() => setForm(null)}>{tr("Cancel", "Batal")}</Button>
              <Button
                onClick={save}
                disabled={saving || !form.code.trim() || !form.name.trim() || (balanceChanged && !form.reason.trim())}
              >
                {saving ? tr("Saving…", "Menyimpan…") : tr("Save", "Simpan")}
              </Button>
            </div>
            {form.mode === "edit" && (
              <p className="text-[11px] text-slate-500">
                {tr("Delete works only for an account nothing is booked on. Otherwise untick Active.", "Hapus hanya berlaku untuk rekening yang belum dibukukan apa pun. Selain itu, hapus centang Aktif.")}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
