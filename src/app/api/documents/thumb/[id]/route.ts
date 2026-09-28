import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { driveConfigured, fetchThumbnail } from "@/lib/drive";
import { driveFileId } from "@/lib/drive-links";

/** `GET /api/documents/thumb/<attachment id>?w=400`: the picture of an
 *  attached file, for tiles and previews (F175).
 *
 *  The person asks for an **attachment**, not a Drive id. Whether they may
 *  see it is the database's answer: the row is read as them, under the same
 *  policies as every other read. A row they cannot read is a 404, the same
 *  answer as a row that does not exist. Only then does the service account
 *  fetch the picture from Drive. The browser never talks to Google, so the
 *  tile works whatever Google account the browser is signed into, or none.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!driveConfigured()) return new Response(null, { status: 501 });
  const { id } = await params;
  const w = Math.min(1600, Math.max(64, Number(new URL(request.url).searchParams.get("w")) || 400));

  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getSession();
  if (!auth.session) return new Response(null, { status: 401 });

  const { data: row } = await sb.schema("ops_core").from("v_attachment")
    .select("storage_path, url, web_view_link").eq("id", id).maybeSingle();
  const fileId = row ? driveFileId(row as { storage_path: string; url: string | null; web_view_link: string | null }) : null;
  if (!fileId) return new Response(null, { status: 404 });

  const img = await fetchThumbnail(fileId, w);
  if (!img) return new Response(null, { status: 404 });

  return new Response(img.body, {
    headers: {
      "content-type": img.headers.get("content-type") ?? "image/jpeg",
      /* Private: the picture is somebody's document, not a public asset. */
      "cache-control": "private, max-age=3600",
    },
  });
}
