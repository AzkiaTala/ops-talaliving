import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import {
  APP_FOLDER, DriveError, driveConfigured, driveOf, findOrCreateAppFolder, probeDrive, serviceAccountEmail,
} from "@/lib/drive";
import { explainDriveFailure } from "@/lib/drive-errors";
import type { DriveCheck, DriveCheckReport, DriveSetUp, DriveVerdict } from "@/services/documents/contracts";

/** `GET  /api/documents/drive-check`: every shared drive, and whether the app
 *  can file into it. The drive is looked at as a member (read-only), and the
 *  app's `ops-talaliving` folder as uploads see it.
 *  `POST /api/documents/drive-check {slug?}`: make (or find) `ops-talaliving`
 *  at the root of one shared drive, or every one, and record it (D320).
 *
 *  Why (F173): uploads use `drive.file`, which sees only what the app made.
 *  The owner's hand-made OPS folders answered *File not found*. The owner kept
 *  the permission and asked for the app's own folder. This is where IT makes
 *  it for every drive at once and sees which drives the app cannot reach.
 *
 *  Server-side for the same reason as the upload route: the service account
 *  key never reaches a browser. The database decides who may ask: `it.read`
 *  to look, and `it.manage_drives` to make folders and record them.
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

type Sb = ReturnType<typeof supabaseServer>;

async function allowed(permission: string): Promise<Response | { sb: Sb; userId: string }> {
  if (!driveConfigured()) {
    return refuse(501, "drive_not_configured",
      "This deployment has no Drive service account. IT sets GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY on the Worker.");
  }
  const sb = supabaseServer(await cookies());
  const { data: auth } = await sb.auth.getSession();
  if (!auth.session) return refuse(401, "not_signed_in", "Please sign in first.");
  const { data: may } = await sb.schema("ops_core").rpc("has_permission", { code: permission });
  if (may !== true) {
    return refuse(403, "forbidden", `This needs ${permission}.`);
  }
  return { sb, userId: auth.session.user.id };
}

interface FolderRow {
  slug: string; label: string;
  drive_id: string | null; folder_id: string | null; parent_folder_id: string | null;
}
const COLUMNS = "slug, label, drive_id, folder_id, parent_folder_id";

function verdictOf(rec: FolderRow, p: Awaited<ReturnType<typeof probeDrive>>): DriveVerdict {
  if (!p.drive.ok) return "not_member_or_wrong_id";
  if (p.drive.canAddChildren === false) return "read_only_member";
  if (!rec.folder_id) return "not_set_up";
  if (!p.appFolder?.ok || p.appFolder.trashed) return "app_folder_missing";
  return "ready";
}

export async function GET(): Promise<Response> {
  const who = await allowed("it.read");
  if (who instanceof Response) return who;

  const { data, error } = await who.sb.schema("ops_core").from("drive_folders").select(COLUMNS).order("label");
  if (error) return refuse(500, "database_error", error.message);

  const drives = await Promise.all((data as FolderRow[]).map(async (f): Promise<DriveCheck> => {
    const base = {
      slug: f.slug, label: f.label,
      recorded_folder_id: f.parent_folder_id, drive_id: f.drive_id, folder_id: f.folder_id,
    };
    if (!f.drive_id && !f.parent_folder_id) {
      return { ...base, drive: null, app_folder: null, verdict: "not_configured", note: null };
    }
    try {
      const p = await probeDrive(f);
      return {
        ...base,
        drive_id: f.drive_id ?? p.drive.driveId,
        drive: {
          ok: p.drive.ok, status: p.drive.status, message: p.drive.message,
          name: p.drive.driveName, can_add: p.drive.canAddChildren,
        },
        app_folder: p.appFolder,
        verdict: verdictOf(f, p),
        note: null,
      };
    } catch (e) {
      return { ...base, drive: null, app_folder: null, verdict: "check_failed", note: String((e as Error).message) };
    }
  }));

  const report: DriveCheckReport = {
    service_account: serviceAccountEmail(),
    upload_scope: "drive.file",
    app_folder: APP_FOLDER,
    drives,
  };
  return ok(report);
}

/** One drive: find the drive, make or find `ops-talaliving`, record both.
 *  A recorded folder the app can still open is kept; one it cannot is
 *  replaced, which is the reason this is IT admin's and not an uploader's. */
async function setUp(sb: Sb, userId: string, f: FolderRow): Promise<DriveSetUp> {
  const base = { slug: f.slug, label: f.label };
  let stage: DriveError["stage"] = "drive";
  try {
    let driveId = f.drive_id;
    let driveName: string | null = null;
    if (!driveId) {
      if (!f.parent_folder_id) {
        return { ...base, ok: false, drive_id: null, drive_name: null, folder_id: null, created: false,
          code: "drive_not_configured", message: `Nothing records which shared drive is ${f.label}.` };
      }
      ({ driveId, driveName } = await driveOf(f.parent_folder_id));
    }

    let folderId = f.folder_id;
    let created = false;
    if (folderId) {
      const p = await probeDrive({ drive_id: driveId, parent_folder_id: null, folder_id: folderId });
      driveName = driveName ?? p.drive.driveName;
      if (!p.appFolder?.ok || p.appFolder.trashed) folderId = null;
    }
    if (!folderId) {
      stage = "app_folder";
      ({ id: folderId, created } = await findOrCreateAppFolder(driveId));
    }

    /* As IT admin, straight onto the row (`drive_folders_write`). Read back,
       because an update RLS hides touches nothing and says nothing (F163). */
    const { data, error } = await sb.schema("ops_core").from("drive_folders")
      .update({ drive_id: driveId, folder_id: folderId, updated_at: new Date().toISOString(), updated_by: userId })
      .eq("slug", f.slug).select("slug");
    if (error || !data?.length) {
      return { ...base, ok: false, drive_id: driveId, drive_name: driveName, folder_id: folderId, created,
        code: "not_recorded",
        message: `${APP_FOLDER} is in ${f.label}, but it could not be recorded: ${error?.message ?? "no row was updated"}.` };
    }
    return { ...base, ok: true, drive_id: driveId, drive_name: driveName, folder_id: folderId, created,
      code: null, message: null };
  } catch (e) {
    const x = explainDriveFailure(e, stage, { label: f.label, path: "", folderId: f.parent_folder_id });
    return { ...base, ok: false, drive_id: f.drive_id, drive_name: null, folder_id: null, created: false,
      code: x.code, message: x.message };
  }
}

export async function POST(request: Request): Promise<Response> {
  const who = await allowed("it.manage_drives");
  if (who instanceof Response) return who;

  let slug: string | null = null;
  try { slug = ((await request.json()) as { slug?: string | null }).slug ?? null; } catch { /* all */ }

  let q = who.sb.schema("ops_core").from("drive_folders").select(COLUMNS).order("label");
  if (slug) q = q.eq("slug", slug);
  const { data, error } = await q;
  if (error) return refuse(500, "database_error", error.message);
  const rows = data as FolderRow[];
  if (slug && !rows.length) return refuse(404, "not_found", `There is no shared drive "${slug}".`);

  /* One after another rather than all at once: eight folder creations are
     quick, and Google rate-limits a burst from one account. */
  const results: DriveSetUp[] = [];
  for (const f of rows) results.push(await setUp(who.sb, who.userId, f));
  return ok(results);
}
