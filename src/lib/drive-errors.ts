import "server-only";
import { APP_FOLDER, DriveError, serviceAccountEmail } from "./drive";

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
  const where = `${at.label} / ${APP_FOLDER} / ${at.path}`;

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

  if (e.stage === "drive" && e.status === 404) {
    return {
      status: 502, code: "drive_not_member", stage: e.stage,
      message: `The app cannot reach the ${at.label} shared drive. Google says the recorded folder `
        + `(id ${at.folderId ?? "?"}) does not exist for ${who}, so that account is not a member of `
        + `the ${at.label} shared drive, or the id is wrong. Add ${who} to the ${at.label} shared drive `
        + "as Content manager. IT → Google Drive shows every drive's state.",
    };
  }

  if (e.stage === "drive") {
    return {
      status: 502, code: "drive_not_shared", stage: e.stage,
      message: `The app cannot find which shared drive ${at.label} is: ${e.googleMessage}`,
    };
  }

  if (e.status === 403) {
    return {
      status: 502, code: "drive_no_permission", stage: e.stage,
      message: `${who} can see the ${at.label} shared drive, but it may not add files there `
        + `(${e.googleReason ?? "forbidden"}). Make it a Content manager of the ${at.label} shared drive.`,
    };
  }

  if (e.status === 404) {
    return {
      status: 502, code: "drive_app_folder_missing", stage: e.stage,
      message: `The app's ${APP_FOLDER} folder in ${at.label} can no longer be opened. It may have been `
        + `moved or deleted. IT → Google Drive → "Create ${APP_FOLDER}" makes a new one.`,
    };
  }

  return {
    status: 502, code: e.stage === "upload" ? "drive_upload_failed" : "drive_folder_failed", stage: e.stage,
    message: `The file did not reach ${where}. Google answered ${e.status}: ${e.googleMessage}`,
  };
}
