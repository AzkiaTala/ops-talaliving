"use client";

import { useState } from "react";
import { ExternalLink, ImageOff } from "lucide-react";
import { driveOpenUrl, thumbProxyUrl } from "@/lib/drive-links";
import { useTr } from "@/lib/i18n";

/** The pictures on a record as tiles, each one opening in Google Drive (F174).
 *
 *  The owner: the photos should be seen without opening them one by one, as
 *  a tile per picture, and a click on the picture should go to Drive. Before
 *  this, the documents list was text, and an uploaded file could not be
 *  clicked at all.
 *
 *  The picture comes through this application (`/api/documents/thumb`,
 *  F175): the server checks the person may read the attachment, then fetches
 *  Drive's thumbnail as the service account. It no longer depends on which
 *  Google account the browser is signed into, which is what broke the first
 *  tiles. A sandbox file with no Drive id at all, or one Drive refuses, gets
 *  a plain tile with the name instead of a broken-image icon. Where there is
 *  a link, that tile still opens it.
 */
export interface TileFile {
  id: string;
  filename: string;
  mime?: string | null;
  storage_path?: string | null;
  url?: string | null;
  web_view_link?: string | null;
  /** Under the picture: the kind it was filed as (*Foto*, *Nota*). */
  caption?: string | null;
}

export function ImageTiles({ files, className }: { files: TileFile[]; className?: string }) {
  if (files.length === 0) return null;
  return (
    <ul className={className ?? "mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4"}>
      {files.map((f) => <li key={f.id}><Tile f={f} /></li>)}
    </ul>
  );
}

function Tile({ f }: { f: TileFile }) {
  const tr = useTr();
  const [failed, setFailed] = useState(false);
  const open = driveOpenUrl(f);
  const thumb = thumbProxyUrl(f);

  const picture = thumb && !failed ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumb} alt={f.filename} loading="lazy" onError={() => setFailed(true)}
      className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
    />
  ) : (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center">
      <ImageOff className="h-5 w-5 text-slate-300" />
      <span className="line-clamp-2 break-all text-[10px] text-slate-500">{f.filename}</span>
    </span>
  );

  const face = (
    <span className="relative block aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      {picture}
      {(f.caption || open) && (
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4 text-[10px] text-white">
          <span className="truncate">{f.caption}</span>
          {open && <ExternalLink className="h-3 w-3 shrink-0 opacity-80" />}
        </span>
      )}
    </span>
  );

  return open ? (
    <a
      href={open} target="_blank" rel="noreferrer noopener"
      title={tr(`${f.filename} — open in Google Drive`, `${f.filename} — buka di Google Drive`)}
      className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded-lg"
    >
      {face}
    </a>
  ) : (
    <span className="group block" title={f.filename}>{face}</span>
  );
}
