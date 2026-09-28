"use client";

import { useState } from "react";
import { CalendarDays, Save } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { useLoad } from "@/components/ui/loaded";
import { formatIDR } from "@/lib/format";
import { accounting } from "@/demo/api";
import type { CashAmountKind, CashComponent, CashFrequency, Direction, TransactionTypeCode } from "@/services/accounting/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** One line on the calendar: what it is, how much, and the day it is due.
 *
 *  The category is not decoration — it is how the plan finds what actually
 *  happened, so a line with no category can only ever be a projection. Two
 *  lines may not claim the same category (D110); the refusal names the one
 *  that already has it.
 */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

export function ComponentDrawer({
  component, onClose, onSaved,
}: {
  component: CashComponent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [types] = useLoad(() => accounting.listTypeRows(), []);
  const [accounts] = useLoad(() => accounting.listAccountRows(), []);
  const [name, setName] = useState(component?.name ?? "");
  const [direction, setDirection] = useState<Direction>(component?.direction ?? "OUT");
  const [amount, setAmount] = useState(component?.amount ?? 0);
  /* Fixed must be met; an estimate is settled by whatever the payment came
     to (`0114`). Rent and instalments are fixed; electricity is not. */
  const [amountKind, setAmountKind] = useState<CashAmountKind>(component?.amount_kind ?? "fixed");
  const [frequency, setFrequency] = useState<CashFrequency>(component?.frequency ?? "monthly");
  const [dueDay, setDueDay] = useState(component?.due_day ?? 25);
  const [weekday, setWeekday] = useState(component?.due_weekday ?? 5);
  const [onceDate, setOnceDate] = useState(component?.due_date ?? "");
  const [typeCode, setTypeCode] = useState<string>(component?.type_code ?? "");
  const [accountId, setAccountId] = useState<string>(component?.account_id ?? "");
  const [note, setNote] = useState(component?.note ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = component
      ? await accounting.updateComponent(component.id, {
        name, amount, due_day: dueDay, note: note || null, amount_kind: amountKind,
      })
      : await accounting.addComponent({
        name, direction, amount, frequency, amount_kind: amountKind,
        due_day: dueDay,
        due_weekday: frequency === "weekly" ? weekday : null,
        due_date: frequency === "once" ? onceDate : null,
        type_code: (typeCode || null) as TransactionTypeCode | null,
        account_id: accountId || null,
        note: note || null,
      });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", component ? tr("Updated", "Diperbarui") : tr("Added to the calendar", "Ditambahkan ke kalender"),
      `${name} · ${formatIDR(amount)} ${frequency === "weekly"
        ? tr(`every ${WEEKDAYS[weekday]}`, `setiap ${WEEKDAYS_ID[weekday]}`)
        : frequency === "once" ? tr(`on ${onceDate}`, `pada ${onceDate}`) : tr(`on day ${dueDay} of each month`, `setiap tanggal ${dueDay}`)}`);
    onSaved();
  }

  async function stop() {
    if (!component) return;
    setBusy(true);
    const res = await accounting.updateComponent(component.id, { active: false });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not changed", "Tidak diubah"), res.error.message); return; }
    toast("success", tr("Off the calendar", "Dikeluarkan dari kalender"), tr(`${component.name} will not be planned for from now on.`, `${component.name} tidak akan direncanakan lagi mulai sekarang.`));
    onSaved();
  }

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-lg"
      title={component ? component.name : tr("New calendar line", "Baris kalender baru")}
      subtitle={component ? tr("Change the estimate, the day, or take it off the calendar.", "Ubah perkiraan, harinya, atau keluarkan dari kalender.") : tr("Something that repeats every month.", "Sesuatu yang berulang setiap bulan.")}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {component && (
            <Button variant="ghost" size="sm" onClick={stop} disabled={busy}>
              {tr("Take it off the calendar", "Keluarkan dari kalender")}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button
              icon={Save}
              onClick={save}
              disabled={busy || !name.trim() || amount <= 0 || (frequency === "once" && !onceDate)}
            >
              {busy ? tr("Saving…", "Menyimpan…") : component ? tr("Save", "Simpan") : tr("Add it", "Tambahkan")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="cc-name" className="block text-xs text-slate-500">{tr("What it is", "Apa ini")}</label>
          <input
            id="cc-name" value={name} onChange={(e) => setName(e.target.value)}
            placeholder={tr("e.g. Workshop electricity", "mis. Listrik workshop")}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
          />
        </div>

        {!component && (
          <div>
            <span className="block text-xs text-slate-500">{tr("Which way the money goes", "Arah uangnya")}</span>
            <div className="mt-1 flex gap-2">
              {(["OUT", "IN"] as Direction[]).map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={direction === d ? "primary" : "outline"}
                  onClick={() => setDirection(d)}
                >
                  {d === "OUT" ? tr("We pay it", "Kita membayar") : tr("Money comes in", "Uang masuk")}
                </Button>
              ))}
            </div>
          </div>
        )}

        {!component && (
          <div>
            <span className="block text-xs text-slate-500">{tr("How often", "Seberapa sering")}</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {([
                ["monthly", tr("Every month", "Setiap bulan")],
                ["weekly", tr("Every week", "Setiap minggu")],
                ["once", tr("Once only", "Sekali saja")],
              ] as [CashFrequency, string][]).map(([f, label]) => (
                <Button
                  key={f}
                  size="sm"
                  variant={frequency === f ? "primary" : "outline"}
                  onClick={() => setFrequency(f)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {frequency === "weekly"
                ? tr("Four runs in most months, five in some — the plan counts them rather than assuming four.", "Empat kali di kebanyakan bulan, lima kali di sebagian — rencana menghitungnya, bukan menganggap selalu empat.")
                : frequency === "once"
                  ? tr("Certain, but only that once: settling a vendor, paying the card off rather than carrying it. It appears in that month and no other.", "Pasti, tetapi hanya sekali itu: melunasi vendor, melunasi kartu alih-alih membawanya. Muncul di bulan itu saja.")
                  : tr("The same day every month.", "Hari yang sama setiap bulan.")}
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-2 inline-flex rounded-lg border border-slate-200 p-0.5 text-[12px]" role="radiogroup" aria-label={tr("Amount kind", "Jenis jumlah")}>
              {([["fixed", tr("Fixed amount", "Jumlah tetap")], ["estimate", tr("Estimate", "Perkiraan")]] as [CashAmountKind, string][]).map(([k, label]) => (
                <button
                  key={k} type="button" role="radio" aria-checked={amountKind === k}
                  id={`cc-kind-${k}`}
                  onClick={() => setAmountKind(k)}
                  className={amountKind === k
                    ? "rounded-md bg-brand-600 px-2.5 py-1 font-medium text-white"
                    : "rounded-md px-2.5 py-1 text-slate-600 hover:bg-slate-50"}
                >
                  {label}
                </button>
              ))}
            </div>
            <label htmlFor="cc-amount" className="block text-xs text-slate-500">
              {amountKind === "fixed"
                ? (frequency === "weekly" ? tr("Amount, each run", "Jumlah, setiap kali") : frequency === "once" ? tr("Amount", "Jumlah") : tr("Amount, every month", "Jumlah, setiap bulan"))
                : (frequency === "weekly" ? tr("Estimate, each run", "Perkiraan, setiap kali") : frequency === "once" ? tr("Estimate", "Perkiraan") : tr("Estimate, every month", "Perkiraan, setiap bulan"))}
            </label>
            <MoneyInput id="cc-amount" value={amount} onChange={setAmount} className="mt-1" />
            <p className="mt-1 text-[11px] text-slate-500">
              {amountKind === "fixed"
                ? tr("Rent, instalments, base pay: a payment below this shows as part-paid.", "Sewa, cicilan, gaji pokok: pembayaran di bawah jumlah ini tampil sebagai terbayar sebagian.")
                : frequency === "weekly"
                  ? tr(`Per run — about ${formatIDR(amount * 4)} in a four-week month, ${formatIDR(amount * 5)} in a five-week one. Any matching payment settles it.`,
                    `Per kali — sekitar ${formatIDR(amount * 4)} di bulan empat minggu, ${formatIDR(amount * 5)} di bulan lima minggu. Pembayaran apa pun yang cocok melunasinya.`)
                  : tr("Electricity, water, fuel: roughly is fine. Any matching payment settles it, and the difference is shown.", "Listrik, air, bahan bakar: kira-kira saja cukup. Pembayaran apa pun yang cocok melunasinya, dan selisihnya ditampilkan.")}
            </p>
          </div>

          {frequency === "monthly" && (
            <div>
              <label htmlFor="cc-day" className="block text-xs text-slate-500">{tr("Day of the month it is due", "Tanggal jatuh tempo setiap bulan")}</label>
              <NumberInput id="cc-day" value={dueDay} min={1} max={31} onChange={setDueDay} className="mt-1" />
              <p className="mt-1 text-[11px] text-slate-500">
                {tr("31 in a 30-day month becomes the 30th — a reminder needs a date that exists.", "Tanggal 31 di bulan 30 hari menjadi tanggal 30 — pengingat perlu tanggal yang ada.")}
              </p>
            </div>
          )}

          {frequency === "weekly" && (
            <div>
              <label htmlFor="cc-weekday" className="block text-xs text-slate-500">{tr("Which day of the week", "Hari apa dalam seminggu")}</label>
              <select
                id="cc-weekday" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
              >
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{tr(d, WEEKDAYS_ID[i])}</option>)}
              </select>
            </div>
          )}

          {frequency === "once" && (
            <div>
              <label htmlFor="cc-date" className="block text-xs text-slate-500">{tr("The date", "Tanggalnya")}</label>
              <input
                id="cc-date" type="date" value={onceDate} onChange={(e) => setOnceDate(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                {tr("It lands in that month only — no other month is planned for it.", "Hanya jatuh di bulan itu — tidak ada bulan lain yang direncanakan untuknya.")}
              </p>
            </div>
          )}
        </div>

        {!component && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="cc-type" className="block text-xs text-slate-500">{tr("Category in the ledger", "Kategori di buku besar")}</label>
              <select
                id="cc-type" value={typeCode} onChange={(e) => setTypeCode(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
              >
                <option value="">{tr("none — projection only", "tidak ada — proyeksi saja")}</option>
                {types.status === "ready" && types.data.map((t) => (
                  <option key={t.code} value={t.code}>{t.code}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                {tr("How the plan finds what actually happened. Without one, this line can never be compared to the ledger.",
                  "Cara rencana menemukan apa yang benar-benar terjadi. Tanpa kategori, baris ini tidak pernah bisa dibandingkan dengan buku besar.")}
                {frequency === "once" && tr(" A one-off may share a category with a standing line — being dated, it claims its own payment first.",
                  " Baris sekali boleh berbagi kategori dengan baris tetap — karena bertanggal, ia mengambil pembayarannya sendiri lebih dulu.")}
              </p>
            </div>
            <div>
              <label htmlFor="cc-account" className="block text-xs text-slate-500">{tr("Usually paid from", "Biasanya dibayar dari")}</label>
              <select
                id="cc-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
              >
                <option value="">{tr("not fixed", "tidak tetap")}</option>
                {accounts.status === "ready" && accounts.data.filter((a) => a.is_active || a.id === accountId).map((a) => (
                  <option key={a.id} value={a.id}>{a.code}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="cc-note" className="block text-xs text-slate-500">{tr("Note (optional)", "Catatan (opsional)")}</label>
          <input
            id="cc-note" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={tr("e.g. four weekly runs; the date is the last one", "mis. empat kali mingguan; tanggalnya yang terakhir")}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
          />
        </div>

        {component && (
          <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-[12px] text-slate-600">
            <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            {tr("Changing the estimate changes every month ahead. A single month that differs — a bigger December payroll, a month a bill does not arrive — is an exception with a reason, not a new estimate.",
              "Mengubah perkiraan mengubah setiap bulan ke depan. Satu bulan yang berbeda — penggajian Desember yang lebih besar, bulan saat tagihan tidak datang — adalah pengecualian dengan alasan, bukan perkiraan baru.")}
          </p>
        )}
      </div>
    </Drawer>
  );
}
