"use client";

import { Check, ShieldCheck, UserRound } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/drawer";
import { useSession } from "@/store/session";
import { useDemo } from "@/demo/provider";
import {
  MODULES, MODULE_LABEL, AUTHORITIES, AUTHORITY_LABEL, LEVELS, LEVEL_LABEL,
  describeGrant, type ModuleName, type ModuleLevel,
} from "@/lib/roles";
import { cn } from "@/lib/cn";
import { useTr } from "@/lib/i18n";

/** The demo access control.
 *
 *  The README says to delete the role dropdown, and for production that is
 *  right: a role comes from the session, not from something anyone can change.
 *  In a demo it is the opposite — this is how you *show* that permissions work,
 *  and a single-choice dropdown could not show it at all now that a user holds
 *  several module grants plus separate authorities (D23, D24).
 *
 *  Deleted in Phase 2 with the rest of the demo layer.
 */
export function GrantPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, actAs, setModules, setAuthorities } = useSession();
  const state = useDemo();
  const tr = useTr();
  if (!session) return null;

  const grants = session.modules;
  const levelOf = (m: ModuleName): ModuleLevel | null =>
    grants.find((g) => g.module === m)?.level ?? null;

  const setLevel = (m: ModuleName, level: ModuleLevel | null) => {
    const next = grants.filter((g) => g.module !== m);
    if (level) next.push({ module: m, level });
    void setModules(next);
  };

  const toggleAuthority = (a: (typeof AUTHORITIES)[number]) => {
    const has = session.authorities.includes(a);
    void setAuthorities(has ? session.authorities.filter((x) => x !== a) : [...session.authorities, a]);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={tr("Demo access", "Akses demo")}
      subtitle={tr("Change what this account may see and decide, and watch the app follow.", "Ubah apa yang boleh dilihat dan diputuskan akun ini, dan lihat aplikasinya mengikuti.")}
      width="max-w-md"
      footer={
        <p className="text-xs text-slate-500">
          {tr(
            "Access and authority are separate grants. Turning off a module hides its menu entirely; removing an authority leaves the screens but takes away the decision.",
            "Akses dan wewenang adalah izin yang terpisah. Mematikan modul menyembunyikan seluruh menunya; mencabut wewenang membiarkan layarnya tetap ada tetapi mengambil keputusannya.",
          )}
        </p>
      }
    >
      <div className="space-y-7">
        <section>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <UserRound className="h-3.5 w-3.5" /> {tr("Acting as", "Bertindak sebagai")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {state.users.map((u) => (
              <button
                key={u.id}
                onClick={() => void actAs(u.id)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                  u.id === session.user.id
                    ? "border-brand-300 bg-brand-50 text-brand-800"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50",
                )}
              >
                <span className="block font-semibold">{u.full_name}</span>
                <span className="block font-mono text-[10px] text-slate-400">{u.email}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {tr("Modules — what opens", "Modul — apa yang terbuka")}
          </p>
          <div className="space-y-1.5">
            {MODULES.map((m) => {
              const level = levelOf(m);
              return (
                <div
                  key={m}
                  className={cn(
                    "rounded-lg border px-3 py-2",
                    level ? "border-slate-200 bg-white" : "border-dashed border-slate-200 bg-slate-50/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("text-sm font-medium", level ? "text-slate-800" : "text-slate-400")}>
                      {MODULE_LABEL[m]}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setLevel(m, null)}
                        className={cn(
                          "rounded px-2 py-1 text-[11px] font-medium transition-colors",
                          level === null ? "bg-slate-200 text-slate-700" : "text-slate-400 hover:bg-slate-100",
                        )}
                      >
                        {tr("Off", "Mati")}
                      </button>
                      {LEVELS.map((l) => (
                        <button
                          key={l}
                          onClick={() => setLevel(m, l)}
                          className={cn(
                            "rounded px-2 py-1 text-[11px] font-medium transition-colors",
                            level === l ? "bg-brand-600 text-white" : "text-slate-500 hover:bg-slate-100",
                          )}
                        >
                          {LEVEL_LABEL[l]}
                        </button>
                      ))}
                    </div>
                  </div>
                  {level && (
                    <p className="mt-1 text-[11px] text-slate-500">{describeGrant(m, level)}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5" /> {tr("Authorities — what may be decided", "Wewenang — apa yang boleh diputuskan")}
          </p>
          <div className="space-y-1.5">
            {AUTHORITIES.map((a) => {
              const on = session.authorities.includes(a);
              return (
                <button
                  key={a}
                  onClick={() => toggleAuthority(a)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    on ? "border-brand-300 bg-brand-50" : "border-slate-200 hover:bg-slate-50",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300",
                    )}
                  >
                    {on && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block text-sm", on ? "font-medium text-brand-900" : "text-slate-600")}>
                      {AUTHORITY_LABEL[a]}
                    </span>
                    <span className="block font-mono text-[10px] text-slate-400">{a}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg bg-slate-50 px-3 py-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {tr("Resolved permissions", "Izin yang berlaku")}
          </p>
          <div className="flex flex-wrap gap-1">
            {session.permissions.length === 0 ? (
              <Badge tone="red">{tr("none — this account sees nothing", "tidak ada — akun ini tidak melihat apa pun")}</Badge>
            ) : (
              session.permissions.map((p) => (
                <span key={p} className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 ring-1 ring-slate-200">
                  {p}
                </span>
              ))
            )}
          </div>
        </section>
      </div>
    </Drawer>
  );
}

export function GrantPickerButton({ onOpen }: { onOpen: () => void }) {
  const { session } = useSession();
  const tr = useTr();
  return (
    /* Icon only on a phone: the topbar also carries *Saya* since D331, and at
       390px the word pushed the avatar off the edge. */
    <Button variant="outline" size="sm" icon={ShieldCheck} onClick={onOpen} title={tr("Demo access", "Akses demo")} aria-label={tr("Demo access", "Akses demo")}>
      <span className="hidden sm:inline">{session?.user.full_name ?? tr("Demo access", "Akses demo")}</span>
    </Button>
  );
}
