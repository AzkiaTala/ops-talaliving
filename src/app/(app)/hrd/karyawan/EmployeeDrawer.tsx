"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR } from "@/lib/format";
import { hr } from "@/demo/api";
import { useLoad } from "@/components/ui/loaded";
import type { Employee, PayBasis } from "@/services/hr/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Somebody's name, and what their time costs.
 *
 *  Changing a rate is the most consequential edit in the system after posting
 *  to the ledger, so the audit row carries the figure before and after: *when
 *  did his rate go up, and who said so* is the question a payroll dispute
 *  turns on, and it is never asked on the day it happens.
 */
export function EmployeeDrawer({
  employee, onClose, onSaved,
}: {
  employee: Employee | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [no, setNo] = useState(employee?.employee_no ?? "");
  const [name, setName] = useState(employee?.full_name ?? "");
  const [position, setPosition] = useState(employee?.position ?? "");
  const [unit, setUnit] = useState(employee?.unit ?? "Workshop");
  const [basis, setBasis] = useState<PayBasis>(employee?.pay_basis ?? "daily");
  const [rate, setRate] = useState(employee?.base_rate ?? 0);
  const [allowance, setAllowance] = useState(employee?.allowance_rate ?? 0);
  const [hours, setHours] = useState(employee?.daily_hours ?? 8);
  const [leave, setLeave] = useState(employee?.paid_leave_days ?? 12);
  const [schedule, setSchedule] = useState(employee?.schedule_code ?? "");
  /* The day they started, not the day they were typed in. Everybody entered at
     go-live would otherwise have joined that morning (F154). Blank on a new
     person means today, which is what the seam does with no date. */
  const [joined, setJoined] = useState(employee?.joined_on ?? "");
  const [busy, setBusy] = useState(false);

  const [sched] = useLoad(() => hr.listSchedules(), []);
  const schedules = sched.status === "ready" ? sched.data.schedules : [];
  /* What this person's unit falls back to, named rather than implied: *ikut
     bawaan unit* is only a usable option if the screen says what that is. */
  const unitDefault = sched.status === "ready"
    ? schedules.find((sc) => sc.units.includes(unit)) ?? null
    : null;

  const changed = employee && rate !== employee.base_rate;
  const allowanceChanged = employee && allowance !== employee.allowance_rate;

  async function save() {
    setBusy(true);
    const res = await hr.saveEmployee({
      employee_no: no, full_name: name, position, unit,
      pay_basis: basis, base_rate: rate, allowance_rate: allowance,
      daily_hours: hours, paid_leave_days: leave,
      ...(joined ? { joined_on: joined } : {}),
      /* Empty means *follow the unit*, which is a real answer here and not an
         omission — so it is sent as an explicit null rather than left out
         (absent means unchanged on this endpoint). */
      schedule_code: schedule || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", employee ? tr("Updated", "Diperbarui") : tr("Added", "Ditambahkan"), `${name} · ${formatIDR(rate)} ${basis === "monthly" ? tr("per month", "per bulan") : basis === "daily" ? tr("per day", "per hari") : tr("per hour", "per jam")}`);
    onSaved();
  }

  return (
    <Drawer
      open onClose={onClose} width="max-w-lg"
      title={employee ? employee.full_name : tr("New employee", "Karyawan baru")}
      subtitle={employee
        ? tr(`${employee.employee_no} · joined ${employee.joined_on}`, `${employee.employee_no} · masuk ${employee.joined_on}`)
        : tr("The number has to match the fingerprint machine.", "Nomornya harus sama dengan mesin sidik jari.")}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
          <Button icon={Save} onClick={save} disabled={busy || !name.trim() || !no.trim() || rate <= 0}>
            {busy ? tr("Saving…", "Menyimpan…") : tr("Save", "Simpan")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="e-no" className="block text-xs text-slate-500">{tr("Number on the machine", "Nomor di mesin")}</label>
            <input
              id="e-no" value={no} onChange={(e) => setNo(e.target.value)}
              disabled={!!employee}
              placeholder="T-034"
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
            />
            {employee && <p className="mt-1 text-[11px] text-slate-500">{tr("Fixed — attendance is filed against it.", "Tetap — absensi dicatat atas nomor ini.")}</p>}
          </div>
          <div>
            <label htmlFor="e-name" className="block text-xs text-slate-500">{tr("Full name", "Nama lengkap")}</label>
            <input
              id="e-name" value={name} onChange={(e) => setName(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="e-pos" className="block text-xs text-slate-500">{tr("Position", "Jabatan")}</label>
            <input
              id="e-pos" value={position} onChange={(e) => setPosition(e.target.value)}
              placeholder={tr("Carpenter", "Tukang Kayu")}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="e-unit" className="block text-xs text-slate-500">{tr("Unit", "Unit")}</label>
            <input
              id="e-unit" value={unit} onChange={(e) => setUnit(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
        </div>

        {/* Which working pattern this person is on (Q53, D281).
            
            The unit's default **is** the decision — the owner ruled that after
            M58 offered to confirm 39 of them one by one — so the first option
            says what that default is rather than reading as *unset*. Choosing
            a named pattern here overrides it for this person, which is what
            the guard on a twelve-hour shift and the house assistant need: a
            fact about them, not about their unit. */}
        <div>
          <label htmlFor="e-sched" className="block text-xs text-slate-500">{tr("Work schedule", "Jadwal kerja")}</label>
          <select
            id="e-sched" value={schedule} onChange={(e) => setSchedule(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
          >
            <option value="">
              {tr("Follow unit default", "Ikut bawaan unit")}{unitDefault ? ` — ${unitDefault.name}` : tr(" (the unit has no default yet)", " (unitnya belum punya bawaan)")}
            </option>
            {schedules.map((sc) => (
              <option key={sc.code} value={sc.code}>
                {sc.name}
                {sc.hours.weekly_hours != null ? tr(` · ${sc.hours.weekly_hours} h/week`, ` · ${sc.hours.weekly_hours} jam/minggu`) : tr(" · hours not set yet", " · jam belum ditetapkan")}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-500">
            {schedule
              ? tr("Assigned to this person. Moving units does not change it.", "Dipasang ke orang ini. Pindah unit tidak mengubahnya.")
              : unitDefault
                ? tr("Follows the unit. Move units and the hours move too.", "Mengikuti unitnya. Pindah unit, jamnya ikut pindah.")
                : tr(
                  "This unit has no default schedule yet, so there are no hours to judge punctuality against.",
                  "Unit ini belum punya jadwal bawaan, jadi tidak ada jam yang bisa dipakai menilai ketepatan waktunya.",
                )}
          </p>
        </div>

        <div>
          <span className="block text-xs text-slate-500">{tr("How they are paid", "Cara dibayar")}</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {([["monthly", tr("Monthly salary", "Gaji bulanan")], ["daily", tr("Per day", "Per hari")], ["hourly", tr("Per hour", "Per jam")]] as [PayBasis, string][]).map(([b, label]) => (
              <Button key={b} size="sm" variant={basis === b ? "primary" : "outline"} onClick={() => setBasis(b)}>
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="e-rate" className="block text-xs text-slate-500">
              {basis === "monthly" ? tr("Salary, per month", "Gaji, per bulan") : basis === "daily" ? tr("Rate, per day", "Tarif, per hari") : tr("Rate, per hour", "Tarif, per jam")}
            </label>
            <MoneyInput id="e-rate" value={rate} onChange={setRate} className="mt-1" />
            {changed && (
              <p className="mt-1 text-[11px] text-amber-700">
                {formatIDR(employee!.base_rate)} → {formatIDR(rate)} · {tr("both figures go on the audit row.", "kedua angka dicatat di baris audit.")}
              </p>
            )}
          </div>
          <div>
            {/* Per day for everybody, whatever the pokok is quoted in — that is
                how the owner described it, and how it is paid (D250). */}
            <label htmlFor="e-allowance" className="block text-xs text-slate-500">
              {tr("Allowance, per day present", "Tunjangan, per hari hadir")}
            </label>
            <MoneyInput id="e-allowance" value={allowance} onChange={setAllowance} className="mt-1" />
            {allowanceChanged ? (
              <p className="mt-1 text-[11px] text-amber-700">
                {formatIDR(employee!.allowance_rate)} → {formatIDR(allowance)} · {tr("recorded on the audit row.", "dicatat di baris audit.")}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-slate-500">
                {tr(
                  "Paid per day the person is present. Zero means the pay has not been split yet — and while it is zero, none of this person's figures change.",
                  "Dibayar per hari orangnya hadir. Nol berarti gajinya memang belum dipisah — dan selama nol, tidak ada angka orang ini yang berubah.",
                )}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="e-hours" className="block text-xs text-slate-500">{tr("Hours in a standard day", "Jam dalam sehari standar")}</label>
            <NumberInput id="e-hours" value={hours} min={1} max={24} onChange={setHours} className="mt-1" />
            <p className="mt-1 text-[11px] text-slate-500">{tr("Anything past this is overtime — claimed, then approved twice.", "Lewat dari ini adalah lembur — diajukan, lalu disetujui dua kali.")}</p>
          </div>
          <div>
            <label htmlFor="e-joined" className="block text-xs text-slate-500">{tr("Start date", "Tanggal masuk")}</label>
            <input
              id="e-joined" type="date" value={joined} onChange={(e) => setJoined(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-slate-500">{tr("First working day. Empty means today.", "Hari pertama kerja. Kosong berarti hari ini.")}</p>
          </div>
          <div>
            <label htmlFor="e-leave" className="block text-xs text-slate-500">{tr("Paid leave entitlement, per year", "Hak cuti berbayar, per tahun")}</label>
            <NumberInput id="e-leave" value={leave} min={0} max={60} onChange={setLeave} className="mt-1" />
            {/* Per person, because the owner said so: length of service and
                what was agreed at hiring both move it (D144). */}
            <p className="mt-1 text-[11px] text-slate-500">
              {tr(
                "Different for everybody. Leave within this number is paid; days past it are recorded and not paid.",
                "Berbeda untuk setiap orang. Cuti dalam jumlah ini dibayar; hari yang melebihinya tercatat dan tidak dibayar.",
              )}
            </p>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
