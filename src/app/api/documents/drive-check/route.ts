import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { driveConfigured, probeFolder, testCreateFolder, serviceAccountEmail, isOpsName } from "@/lib/drive";
import type { DriveCheck, DriveCheckReport, DriveFolderTest, DriveVerdict } from "@/services/documents/contracts";

/** `GET  /api/documents/drive-check`: every shared drive's recorded OPS
 *  folder, looked at as a member and as uploads look (read-only).
 *  `POST /api/documents/drive-check {slug}`: try making a folder in one of
 *  them, as uploads do today and with full Drive access. Each test folder is
 *  binned straight away.
 *
 *  Why it exists (F172): the first real upload came back *File not found* for
 *  the Procurement OPS folder. That sentence has two different causes with two
 *  different fixes. One is an account that is not in the shared drive. The
 *  other is a folder a person made, which `drive.file` cannot see. Nobody
 *  could tell which from the app. This route tells them apart by asking Google
 *  both ways.
 *
 *  Server-side for the same reason as the upload route: the service account
 *  key never reaches a browser. Who may ask is decided by the database:
 *  `it.read` to look, `it.manage_drives` to try a write.
 */

function answer(status: number, body: unknown): Response {
  return Response.json(body, { status });
}
function refuse(status: number, code: string, message: string): Response {
  return answer(status, {
    error: { code, message, outcome: "refused", status },
    meta: { request_id: "", service: "documents", version: "1", outcome: "refused" },
  });
}
function ok(data: unknown): Response {
  return answer(200, { data, meta: { request_id: "", service: "documents", version: "1", outcome: "ok" } });
}

async function allowed(permission: string): Promise<Response | ReturnType<typeof supabaseServer>> {
  if (!driveConfigured()) {
    return refuse(501, "drive_not_configured",
      "This deployment has no Drive service account. IT sets GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY on the Worker.");
  }
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getSession();
  if (!auth.session) return refuse(401, "not_signed_in", "Please sign in first.");
  const { data: may } = await sb.schema("ops_core").rpc("has_permission", { code: permission });
  if (may !== true) {
    return refuse(403, "forbidden", `Checking the shared drives needs ${permission}.`);
  }
  return sb;
}

interface FolderRow { slug: string; label: string; folder_id: string | null; parent_folder_id: string | null }

function verdictOf(p: Awaited<ReturnType<typeof probeFolder>>): DriveVerdict {
  if (!p.asMember.ok) return p.asUploader.ok ? "ready" : "not_member_or_wrong_id";
  if (!p.asMember.isFolder) return "not_a_folder";
  if (p.asMember.trashed) return "trashed";
  if (p.asMember.canAddChildren === false) return "read_only_member";
  if (!p.asUploader.ok) return "hidden_by_drive_file";
  if (!isOpsName(p.asMember.name ?? "")) return "not_named_ops";
  return "ready";
}

export async function GET(): Promise<Response> {
  const sb = await allowed("it.read");
  if (sb instanceof Response) return sb;

  const { data, error } = await sb.schema("ops_core").from("drive_folders")
    .select("slug, label, folder_id, parent_folder_id").order("label");
  if (error) return refuse(500, "database_error", error.message);

  const drives = await Promise.all((data as FolderRow[]).map(async (f): Promise<DriveCheck> => {
    const id = f.folder_id ?? f.parent_folder_id;
    const base = { slug: f.slug, label: f.label, folder_id: id };
    if (!id) return { ...base, member: null, uploader: null, verdict: "not_configured", note: null };
    try {
      const p = await probeFolder(id);
      return {
        ...base,
        member: {
          ok: p.asMember.ok, status: p.asMember.status, message: p.asMember.message,
          name: p.asMember.name, is_folder: p.asMember.isFolder, trashed: p.asMember.trashed,
          drive_name: p.asMember.driveName, can_add: p.asMember.canAddChildren,
        },
        uploader: p.asUploader,
        verdict: verdictOf(p),
        note: null,
      };
    } catch (e) {
      return { ...base, member: null, uploader: null, verdict: "check_failed", note: String((e as Error).message) };
    }
  }));

  const report: DriveCheckReport = {
    service_account: serviceAccountEmail(),
    upload_scope: "drive.file",
    drives,
  };
  return ok(report);
}

export async function POST(request: Request): Promise<Response> {
  const sb = await allowed("it.manage_drives");
  if (sb instanceof Response) return sb;

  let slug = "";
  try { slug = String(((await request.json()) as { slug?: string }).slug ?? ""); } catch { /* empty */ }
  const { data, error } = await sb.schema("ops_core").from("drive_folders")
    .select("slug, label, folder_id, parent_folder_id").eq("slug", slug).maybeSingle();
  if (error) return refuse(500, "database_error", error.message);
  const f = data as FolderRow | null;
  if (!f) return refuse(404, "not_found", `There is no shared drive "${slug}".`);
  const id = f.folder_id ?? f.parent_folder_id;
  if (!id) return refuse(422, "drive_not_configured", `${f.label} has no OPS folder recorded.`);

  try {
    const t = await testCreateFolder(id);
    const result: DriveFolderTest = {
      slug: f.slug, label: f.label, folder_id: id,
      as_uploader: t.asUploader, with_full_access: t.withFullAccess,
    };
    return ok(result);
  } catch (e) {
    return refuse(502, "drive_check_failed", String((e as Error).message));
  }
}
