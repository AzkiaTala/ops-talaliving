"use client";

import { Construction } from "lucide-react";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { useTr } from "@/lib/i18n";

/** Isi sementara untuk halaman yang rutenya sudah ada tapi modulnya belum
 *  dibangun.
 *
 *  Sengaja jujur menyebut dirinya belum jadi, dan menyebutkan izin apa yang
 *  menjaganya. Halaman kosong yang tampak "hampir jadi" membuat orang mengira
 *  fiturnya rusak; halaman yang mengaku belum dibangun tidak menimbulkan
 *  laporan bug palsu.
 */
export function ModulePlaceholder({
  breadcrumb,
  title,
  description,
  permission,
}: {
  breadcrumb: string;
  title: string;
  description?: string;
  permission?: string;
}) {
  const tr = useTr();
  return (
    <div>
      <PageHeader breadcrumb={breadcrumb} title={title} description={description} />
      <Card>
        <CardHeader title={tr("Not built yet", "Belum dibangun")} subtitle={tr("The route and navigation exist; the module follows.", "Rute dan navigasinya sudah ada; modulnya menyusul.")} icon={Construction} />
        <div className="space-y-3 px-5 py-6 text-sm text-slate-600">
          <p>
            {tr(
              "This page is part of the shell. Structure, navigation, permissions and components are in place; the data model and the workflow are not.",
              "Halaman ini bagian dari kerangka aplikasi. Struktur, navigasi, izin dan komponennya sudah ada; model data dan alur kerjanya belum.",
            )}
          </p>
          {permission && (
            <p className="text-xs text-slate-500">
              {tr("Guarded by ", "Dijaga oleh ")}<code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">{permission}</code>.{" "}
              {tr(
                "A role without it does not see the menu entry at all — try switching role, top right.",
                "Peran tanpa izin itu sama sekali tidak melihat menunya — coba ganti peran, di kanan atas.",
              )}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
