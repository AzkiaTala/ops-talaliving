"use client";

import { useState } from "react";
import {
  MessageSquareOff, MessageSquare, ShieldCheck, KeyRound, HelpCircle,
  ListChecks, Lock, Search,
} from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { cn } from "@/lib/cn";
import { assistant } from "@/demo/api";
import { formatDate } from "@/lib/format";
import { useTr } from "@/lib/i18n";

/** What people asked John Lau that he did not understand.
 *
 *  ## Why this screen exists at all
 *
 *  Asked whether John Lau should have a language model behind him, the owner
 *  answered *kata kunci dulu, LLM nanti* — keywords first, decide after seeing
 *  what people actually type (D221). Every turn has been stored since, on the
 *  strength of that answer, including the ones that matched nothing.
 *
 *  A record nobody can open is a record nobody can act on, and the decision it
 *  was collected for cannot then be made. **This is the screen that makes the
 *  keeping worth something.**
 *
 *  ## What it deliberately does not show
 *
 *  Who asked. Not a name, not an email, not a count per person, not a filter.
 *  `ops_asst.turns` is own-rows-only under RLS and the two functions behind
 *  this page are `security definer` precisely so they can pick their columns —
 *  because what has to be withheld here is a column, and RLS withholds rows.
 *
 *  The reason is not squeamishness. `it.audit` is blocked from the prompt
 *  because reading a record of what colleagues did, through a conversation,
 *  turns it into a way to watch one of them with a sentence (D218, D190).
 *  Building the mirror image of that two migrations later — *here is everything
 *  Budi has ever typed* — would be an odd way to honour it.
 *
 *  ## Why grouped
 *
 *  By `normalise()`, the matcher's own function. Two sentences that share it
 *  are one question to the router, and F64 is the day *stoknya menipis* and
 *  *stok menipis* were not. Seventeen people asking one thing is a rule worth
 *  writing; seventeen different things asked once each is not, and an
 *  ungrouped log makes those look identical.
 *
 *  ## Why nothing here is editable
 *
 *  The rules are rows in a migration — reviewed, in the history, with the
 *  reason beside them. A router somebody can edit from a browser is a router
 *  that answers a different question tomorrow than it did today, with no diff
 *  and nobody to ask. So this screen reads, and says who can change it (A7).
 */
export default function JohnLauTuningPage() {
  const tr = useTr();
  const [q, setQ] = useState("");
  const [health, reloadHealth] = useLoad(() => assistant.routerHealth(), []);
  const [rows, reloadRows] = useLoad(() => assistant.unmatched(), []);
  const [rules, reloadRules] = useLoad(() => assistant.listRules(), []);

  return (
    <div>
      <PageHeader
        breadcrumb="IT"
        title={tr("John Lau — what he did not understand", "John Lau — yang tidak dimengerti")}
        description={tr(
          "Sentences people typed that the router did not understand, grouped the way the router itself compares them. No names — the question is what we failed to understand, not who asked.",
          "Kalimat yang orang ketik dan routernya tidak paham, dikelompokkan seperti routernya sendiri membandingkannya. Tanpa nama siapa pun — pertanyaannya adalah apa yang gagal kami mengerti, bukan siapa yang bertanya.",
        )}
        actions={<SourceBadge state={rows} />}
      />

      <Loaded state={health} onRetry={reloadHealth}>
        {(h) => (
          <>
            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={MessageSquare} tone="brand"
                label={tr("Questions received", "Pertanyaan masuk")}
                value={h.turns}
                hint={h.since ? tr(`since ${formatDate(new Date(h.since))}`, `sejak ${formatDate(new Date(h.since))}`) : tr("nobody has asked yet", "belum ada yang bertanya")}
              />
              <StatCard
                icon={ListChecks} tone="green"
                label={tr("Answered", "Terjawab")}
                value={h.answered + h.guided + h.drafted}
                hint={tr(`${h.answered} figures · ${h.guided} guides · ${h.drafted} drafts`, `${h.answered} angka · ${h.guided} panduan · ${h.drafted} rancangan`)}
              />
              <StatCard
                icon={MessageSquareOff}
                tone={h.turns > 0 && h.unknown > h.turns / 2 ? "red" : "amber"}
                label={tr("Not understood", "Tidak dimengerti")}
                value={h.unknown}
                hint={h.turns > 0 ? tr(`${Math.round((h.unknown / h.turns) * 100)}% of all questions`, `${Math.round((h.unknown / h.turns) * 100)}% dari semua pertanyaan`) : "—"}
              />
              <StatCard
                icon={ShieldCheck} tone="slate"
                label={tr("Refused", "Ditolak")}
                value={h.refused_closed + h.refused_permission}
                hint={tr(`${h.refused_closed} outside the prompt's reach · ${h.refused_permission} missing access rights`, `${h.refused_closed} di luar jangkauan prompt · ${h.refused_permission} kurang hak akses`)}
              />
            </div>

            {/* The one number on this page that is an IT job rather than a
                router one, so it does not sit quietly inside a stat card. A
                `closed` refusal is the boundary working; a `permission` one is
                somebody who needs a grant they have not got, and rendering the
                two alike is F64 in a dashboard. */}
            {h.refused_permission > 0 && (
              <div className="mb-6 flex flex-wrap items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {tr(`${h.refused_permission} question(s) refused because of`, `${h.refused_permission} pertanyaan ditolak karena`)}{" "}
                  <strong>{tr("access rights", "hak akses")}</strong>
                  {tr(
                    ", not because they were out of reach. That is not the router's job — it is IT's: somebody needs a module they have not been given. What was refused and for whom is in the",
                    ", bukan karena di luar jangkauan. Itu bukan pekerjaan router — itu pekerjaan IT: seseorang butuh modul yang belum diberikan. Yang ditolak apa dan oleh siapa ada di",
                  )}{" "}
                  <span className="font-medium">{tr("Audit log", "Log audit")}</span>
                  {tr(
                    ", because every tool call writes one row there.",
                    ", karena setiap panggilan alat menulis satu baris di sana.",
                  )}
                </span>
              </div>
            )}

            {/* And the one that is neither: a boundary holding is a good
                number to see, not a problem to fix. Said plainly so nobody
                reads the card above as an alarm. */}
            {h.refused_closed > 0 && (
              <div className="mb-6 flex flex-wrap items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] text-slate-700">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {tr(`${h.refused_closed} question(s) touched something that`, `${h.refused_closed} pertanyaan menyentuh sesuatu yang memang`)}{" "}
                  <strong>{tr("cannot go through a prompt for anyone", "tidak bisa lewat prompt oleh siapa pun")}</strong>{" "}
                  {tr(
                    "— 201 files, salaries, per-person attendance, the IT module, settings. This number is a boundary working, not a problem to fix. No access right lifts it, and raising somebody's access will not change it.",
                    "— berkas 201, gaji, absensi per orang, modul IT, pengaturan. Angka ini batas yang bekerja, bukan masalah yang perlu diperbaiki. Tidak ada hak akses yang mengangkatnya, dan menaikkan hak akses seseorang tidak akan mengubahnya.",
                  )}
                </span>
              </div>
            )}
          </>
        )}
      </Loaded>

      <Card className="mb-6">
        <CardHeader
          title={tr("Not understood", "Yang tidak dimengerti")}
          subtitle={tr(
            "Most asked first. What is repeated is worth a rule; what appears once usually is not.",
            "Paling sering ditanya di atas. Yang diulang-ulang itu yang layak dibuatkan aturan; yang muncul sekali biasanya bukan.",
          )}
          action={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={tr("Search sentences…", "Cari kalimat…")}
                className="h-9 w-56 rounded-lg border border-slate-200 pl-8 pr-2 text-[13px] focus:border-brand-400 focus:outline-none"
              />
            </div>
          }
        />
        <Loaded state={rows} onRetry={reloadRows}>
          {(all) => {
            const shown = q
              ? all.filter((r) => r.normalised.includes(q.toLowerCase()))
              : all;
            if (shown.length === 0) {
              return (
                <div className="p-4">
                  <EmptyState
                    icon={HelpCircle}
                    title={all.length === 0 ? tr("Every question understood", "Semua pertanyaan dimengerti") : tr("Nothing matches", "Tidak ada yang cocok")}
                    description={
                      all.length === 0
                        ? tr(
                          "No sentence has failed to match yet. If the number stays zero after people really use it, that answers whether an LLM is needed — it is not proof this screen is useless.",
                          "Belum ada kalimat yang gagal dicocokkan. Kalau angkanya tetap nol setelah orang benar-benar memakainya, itu jawaban atas pertanyaan apakah perlu LLM — bukan bukti bahwa layar ini tidak berguna.",
                        )
                        : tr("Try another word.", "Coba kata lain.")
                    }
                  />
                </div>
              );
            }
            return (
              <div className="divide-y divide-slate-100">
                {shown.map((r) => (
                  <div key={r.normalised} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                        r.times >= 5 ? "bg-rose-100 text-rose-700"
                          : r.times >= 2 ? "bg-amber-100 text-amber-700"
                          : "bg-slate-100 text-slate-500",
                      )}
                    >
                      {r.times}×
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-slate-800">{r.example}</span>
                      {/* What the matcher actually compared. Shown because the
                          difference between this and the line above is often
                          the whole reason no rule fired. */}
                      {r.normalised !== r.example.toLowerCase() && (
                        <span className="block font-mono text-[11px] text-slate-400">{r.normalised}</span>
                      )}
                    </span>
                    {r.langs.map((l) => (
                      <Badge key={l} tone="slate">{l === "id" ? "ID" : "EN"}</Badge>
                    ))}
                    <span className="text-[11px] tabular-nums text-slate-400">
                      {formatDate(new Date(r.last_at))}
                    </span>
                  </div>
                ))}
              </div>
            );
          }}
        </Loaded>
      </Card>

      <Card>
        <CardHeader
          title={tr("Rules in force now", "Aturan yang ada sekarang")}
          subtitle={tr(
            "Order decides: the first match wins, and the blocked ones sit on top on purpose. Read only — the rules are rows in a migration, so changing them is a reviewed code change, not this screen.",
            "Urutan menentukan: yang pertama cocok menang, dan yang diblokir sengaja di atas. Hanya bisa dibaca — aturannya baris di migrasi, jadi yang mengubahnya adalah perubahan kode yang ditinjau, bukan layar ini.",
          )}
        />
        <Loaded state={rules} onRetry={reloadRules}>
          {(all) => (
            <div className="divide-y divide-slate-100">
              {all.map((r) => (
                <div key={`${r.stage}-${r.seq}`} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-[11px] tabular-nums text-slate-400">{r.seq}</span>
                    <span className="font-mono text-[12px] text-slate-800">{r.tool}</span>
                    {r.stage === "how" && <Badge tone="violet">{tr("how …", "cara …")}</Badge>}
                    <span className="text-[12px] text-slate-500">{r.understood}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.all_words.map((w) => (
                      <span key={`a${w}`} className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-white">
                        +{w}
                      </span>
                    ))}
                    {r.any_words.map((w) => (
                      <span key={`y${w}`} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                        {w}
                      </span>
                    ))}
                    {r.not_words.map((w) => (
                      <span key={`n${w}`} className="rounded bg-rose-50 px-1.5 py-0.5 font-mono text-[10px] text-rose-600">
                        −{w}
                      </span>
                    ))}
                  </div>
                  {/* The guards are on the blocked rules, not the open ones,
                      and the reason is worth reading at the row it applies to. */}
                  {r.note && <p className="mt-1 text-[11px] italic text-slate-500">{r.note}</p>}
                </div>
              ))}
            </div>
          )}
        </Loaded>
      </Card>
    </div>
  );
}
