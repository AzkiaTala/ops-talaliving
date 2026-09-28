import "server-only";
import { DriveError, serviceAccountEmail } from "./drive";

/** A Drive refusal, turned into a sentence that says what happened and who
 *  fixes it (F172).
 *
 *  Before this, the upload toast was Google's JSON, e.g. *File not found:
 *  16btMm…*. That is true, but it does not say whose problem it is. Every
 *  case below names the shared drive, the account Google is answering, and
 *  the one thing to change. Google's own words go to the audit log's detail.
 */
export interface DriveFailure {
  status: number;
  code: string;
  stage: DriveError["stage"];
  message: string;
}

export function explainDriveFailure(
  e: unknown,
  stage: DriveError["stage"],
  at: { label: string; path: string; folderId: string | null },
): DriveFailure {
  const who = serviceAccountEmail();
  const where = `${at.label} / OPS / ${at.path}`;

  if (!(e instanceof DriveError)) {
    return {
      status: 502, code: "drive_failed", stage,
      message: `The file did not reach ${where}: ${String((e as Error)?.message ?? e)}`,
    };
  }

  if (e.stage === "token") {
    return {
      status: 502, code: "drive_key_refused", stage: e.stage,
      message: `Google refused the app's Drive account (${who}): ${e.googleMessage}. `
        + "IT checks GOOGLE_PRIVATE_KEY on the Worker. It must be the key of that same account.",
    };
  }

  if (e.status === 404 && e.stage === "ops_folder") {
    return {
      status: 502, code: "drive_folder_unreachable", stage: e.stage,
      message: `The app cannot open the OPS folder recorded for ${at.label} `
        + `(id ${at.folderId ?? "?"}). Google says "not found" to ${who}. There are two possible reasons. `
        + `Either that account is not a member of the ${at.label} shared drive, or the OPS folder `
        + "was made by a person and the app's Drive permission (drive.file) only lets it see folders it made itself. "
        + "IT → Google Drive checks which one.",
    };
  }

  if (e.status === 404) {
    return {
      status: 502, code: "drive_folder_unreachable", stage: e.stage,
      message: `The app cannot open a folder inside ${at.label} / OPS to file this in ${where}. `
        + `Google says "not found" to ${who}. IT → Google Drive checks why.`,
    };
  }

  if (e.status === 403) {
    return {
      status: 502, code: "drive_no_permission", stage: e.stage,
      message: `${who} can see the ${at.label} shared drive, but it may not add files there `
        + `(${e.googleReason ?? "forbidden"}). Make it a Content manager of the ${at.label} shared drive.`,
    };
  }

  if (e.status === 410 || e.googleReason === "trashed") {
    return {
      status: 502, code: "drive_folder_trashed", stage: e.stage,
      message: `The OPS folder recorded for ${at.label} is in the Drive bin. Restore it, `
        + "or IT records the right folder.",
    };
  }

  return {
    status: 502, code: e.stage === "upload" ? "drive_upload_failed" : "drive_folder_failed", stage: e.stage,
    message: `The file did not reach ${where}. Google answered ${e.status}: ${e.googleMessage}`,
  };
}
