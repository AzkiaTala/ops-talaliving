import "server-only";

/** Uploading to a Google shared drive, as the service account.
 *
 *  ## Why a service account rather than the person
 *
 *  The file goes to a shared drive the business already uses (owner,
 *  2026-09-21: *pakai folder ops di tiap module shared drive*), and the reason
 *  it goes there rather than somewhere of the application's own is that people
 *  open these files by hand, in Drive, beside the work. A per-user OAuth flow
 *  would put every upload behind a Google consent screen and make the app's
 *  ability to file depend on whether the person signing in happens to have a
 *  Workspace account — which B5 deliberately does not require.
 *
 *  So one identity writes: `capture-worker@…`, a Content manager on each drive.
 *  It has been doing exactly this for the legacy system since it began.
 *
 *  ## Why this is not in the browser
 *
 *  A service account key in a browser is a service account key in everybody's
 *  browser. This module is `server-only` and the route that uses it runs in the
 *  Worker; the key reaches it as a runtime secret and never as `NEXT_PUBLIC_`.
 *  `credentials()` refuses the prefixed form outright rather than reading it,
 *  the same way `serviceRoleKey()` does, because by the time somebody notices
 *  the name the value has already shipped.
 *
 *  ## No SDK
 *
 *  `googleapis` is a large dependency that assumes Node's crypto and HTTP.
 *  What is needed here is one signed JWT and two `fetch` calls, and WebCrypto
 *  does RS256 natively — so this is about eighty lines instead of a megabyte,
 *  and it runs on the Worker runtime without a shim.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files"
  + "?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink,parents,driveId";

/** The scope, and only this one. `drive.file` lets the service account touch
 *  files **it created** and nothing else — so a mistake here cannot reach the
 *  1.412 documents already in those drives. The broader `drive` scope would let
 *  it read and delete all of them, and nothing about filing an upload needs
 *  that.
 *
 *  **What this costs:** the account cannot *see* a folder a person made.
 *  When this was written, the plan was for the app to make its own folder.
 *  Then the owner made the OPS folders by hand (D313), and the recorded ids
 *  point at those. The first real upload (2026-09-28, F172) came back
 *  *File not found* for Procurement's OPS folder, which is exactly this cost.
 *  The search does not come back empty; the folder itself answers 404.
 *
 *  Whether that is this line or a missing drive membership is what IT →
 *  Google Drive (`/api/documents/drive-check`) tells apart, drive by drive.
 *  It also tries making a folder under both permissions. Changing this line
 *  to `drive` is the owner's decision (it can then read and delete everything
 *  in the drives the account belongs to), not a fix to slip in. */
const SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Read-only, and used by nothing but `probeFolder` (IT → Google Drive). It
 *  answers the question `drive.file` cannot — *is the folder there and is this
 *  account a member* — without granting a single write. */
const PROBE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

/** Full Drive access, used by nothing but `testCreateFolder`, which IT runs
 *  on purpose (IT → Google Drive → *Test creating a folder*). It exists to
 *  answer one question before anybody changes `SCOPE`: *would uploads work
 *  with it?* Uploads never use it. */
const FULL_SCOPE = "https://www.googleapis.com/auth/drive";

/** A refusal from Google, kept whole rather than flattened into a string.
 *
 *  The route turns it into a sentence a person can act on, and keeps
 *  Google's own answer in the audit row's detail. Before this, both were one
 *  string, so the toast showed a JSON blob and the log showed nothing (F172). */
export class DriveError extends Error {
  constructor(
    /** Which step: `token`, `ops_folder`, `folder`, `upload`. */
    readonly stage: "token" | "ops_folder" | "folder" | "upload",
    /** Google's HTTP status. */
    readonly status: number,
    /** Google's message, e.g. *File not found: 16btMm…*. */
    readonly googleMessage: string,
    /** Google's reason, e.g. `notFound`, `insufficientFilePermissions`,
     *  `invalid_grant`. */
    readonly googleReason: string | null,
  ) {
    super(`${stage}: ${status} ${googleMessage}`);
  }
}

async function driveError(stage: DriveError["stage"], res: Response): Promise<DriveError> {
  const text = await res.text();
  let message = text;
  let reason: string | null = null;
  try {
    const body = JSON.parse(text) as {
      error?: string | { message?: string; errors?: { reason?: string }[] };
      error_description?: string;
    };
    if (typeof body.error === "string") {
      /* The token endpoint's shape: `{ error: "invalid_grant", error_description }`. */
      reason = body.error;
      message = body.error_description ?? body.error;
    } else if (body.error) {
      message = body.error.message ?? text;
      reason = body.error.errors?.[0]?.reason ?? null;
    }
  } catch { /* not JSON — keep the text */ }
  return new DriveError(stage, res.status, message, reason);
}

/** The service account's address, for sentences that tell IT who to add. */
export function serviceAccountEmail(): string {
  return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "(not set)";
}

export interface DriveFile {
  id: string;
  name: string;
  webViewLink: string | null;
  /** The folder(s) Drive says the file is in — checked by the upload route
   *  against the folder it asked for (0175). */
  parents: string[];
  /** The shared drive Drive says the file is in. */
  driveId: string | null;
}

function credentials(): { email: string; privateKey: string } {
  if (typeof window !== "undefined") {
    throw new Error("The Drive service account is server-only and was read in a browser.");
  }
  /* The guard that earns this function. `NEXT_PUBLIC_` is not a naming
     convention in Next.js — it is an instruction to inline the value into the
     client bundle at build time. */
  if (process.env.NEXT_PUBLIC_GOOGLE_PRIVATE_KEY) {
    throw new Error(
      "NEXT_PUBLIC_GOOGLE_PRIVATE_KEY is set. A service account key must never carry the "
      + "NEXT_PUBLIC_ prefix — that prefix ships the value to every browser. Rename it to "
      + "GOOGLE_PRIVATE_KEY and rotate the key in Google Cloud, because it has been in a "
      + "client bundle.",
    );
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !privateKey) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY must be set for uploads to reach "
      + "Drive. They are runtime secrets on the Worker — Settings → Variables and Secrets, "
      + "not Build variables. See docs/plan/phase-2/05-storage.md.",
    );
  }
  return { email, privateKey };
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PEM to a WebCrypto key. The private key arrives as one line with `\n`
 *  written out, because that is what a secret store does to a multi-line
 *  value — so the escape is undone here rather than in whoever pastes it. */
async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8", der.buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );
}

/** An access token, minted from a self-signed JWT.
 *
 *  Not cached. A token lasts an hour and an upload takes a second, so caching
 *  it would trade a round trip for a class of bug — a stale token on one
 *  isolate, a clock skew on another — in exchange for latency nobody is
 *  waiting on. If uploads ever become frequent enough to matter, cache it
 *  somewhere with an expiry rather than in a module variable.
 */
async function accessToken(scope: string = SCOPE): Promise<string> {
  const { email, privateKey } = credentials();
  const now = Math.floor(Date.now() / 1000);

  const claim = {
    iss: email,
    scope,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const body = b64url(new TextEncoder().encode(JSON.stringify(claim)));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await importKey(privateKey),
    new TextEncoder().encode(`${head}.${body}`),
  );
  const jwt = `${head}.${body}.${b64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    /* Google's own words. A rewritten message here would hide the one thing
       worth knowing — `invalid_grant` means the clock or the key, and
       `unauthorized_client` means domain-wide delegation, and they need
       different fixes. */
    throw await driveError("token", res);
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Put a file in one folder of one shared drive.
 *
 *  `supportsAllDrives` is not optional: without it the Drive API pretends
 *  shared drives do not exist and answers *file not found* for a folder that is
 *  plainly there — which is a long afternoon if you have not met it before.
 */
export async function uploadToDrive(
  file: { name: string; type: string; bytes: ArrayBuffer },
  folderId: string,
): Promise<DriveFile> {
  const token = await accessToken();
  const boundary = `b${crypto.randomUUID().replace(/-/g, "")}`;

  const metadata = JSON.stringify({
    name: file.name,
    parents: [folderId],
    mimeType: file.type || "application/octet-stream",
  });

  const head = new TextEncoder().encode(
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`
    + `--${boundary}\r\ncontent-type: ${file.type || "application/octet-stream"}\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const payload = new Uint8Array(head.length + file.bytes.byteLength + tail.length);
  payload.set(head, 0);
  payload.set(new Uint8Array(file.bytes), head.length);
  payload.set(tail, head.length + file.bytes.byteLength);

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": `multipart/related; boundary=${boundary}`,
    },
    body: payload,
  });
  if (!res.ok) {
    throw await driveError("upload", res);
  }
  const out = (await res.json()) as {
    id: string; name: string; webViewLink?: string; parents?: string[]; driveId?: string;
  };
  return {
    id: out.id, name: out.name,
    /* Asked for in `fields`, but a field Drive omits is simply absent; the id
       makes the same link, and a row with no way to open its file is the
       thing to avoid. */
    webViewLink: out.webViewLink ?? `https://drive.google.com/file/d/${out.id}/view`,
    parents: out.parents ?? [],
    driveId: out.driveId ?? null,
  };
}

/** The `OPS` folder of a module — the recorded folder itself, or one inside it.
 *
 *  `0036` read the ids the owner handed over (2026-09-21) as the **module
 *  folders** and made this function create an `ops` folder inside each. The
 *  ids are the `OPS` folders themselves: DRAFTING's is a folder named `OPS`,
 *  and the owner confirmed it for procurement (2026-09-25, *harusnya di folder
 *  OPS shared drive Procurement*). Nesting would have filed everything in
 *  `OPS/ops`. Nothing was uploaded before this was caught — every
 *  `drive_folders.folder_id` was still null in production.
 *
 *  So the recorded folder is asked its own name first: **named OPS (any case)
 *  → it is the target**. Only a folder named anything else gets an `OPS`
 *  folder found or made inside it, the case `0036` was written for. Resolved
 *  by name, once, and written back to `ops_core.drive_folders` — a name is
 *  checkable; an id is not.
 *
 *  `trashed = false` matters: a folder somebody deleted last month still
 *  answers a search, and uploading into the bin loses the file quietly.
 */
export async function findOrCreateOpsFolder(parentFolderId: string): Promise<string> {
  const token = await accessToken();

  const self = await fetch(
    `${FILES_URL}/${encodeURIComponent(parentFolderId)}?supportsAllDrives=true&fields=id,name,trashed`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!self.ok) {
    throw await driveError("ops_folder", self);
  }
  const me = (await self.json()) as { id: string; name: string; trashed?: boolean };
  if (me.trashed) {
    throw new DriveError("ops_folder", 410,
      `The recorded folder "${me.name}" is in the bin.`, "trashed");
  }
  if (isOpsName(me.name)) return me.id;
  return findOrCreateFolder(parentFolderId, "OPS", token);
}

/** A folder by name inside another — found (ignoring case, because people
 *  make these by hand), or made. */
export async function findOrCreateFolder(parentFolderId: string, name: string, token?: string): Promise<string> {
  const bearer = token ?? await accessToken();
  const wanted = name.trim();
  const q = [
    /* `contains` on a name is a case-insensitive prefix match; the exact
       comparison is done below, so `Inventory` made by hand is reused rather
       than duplicated as `INVENTORY`. */
    `name contains '${wanted.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    `'${parentFolderId}' in parents`,
    "trashed = false",
  ].join(" and ");

  const search = new URL(FILES_URL);
  search.searchParams.set("q", q);
  search.searchParams.set("fields", "files(id,name)");
  search.searchParams.set("supportsAllDrives", "true");
  search.searchParams.set("includeItemsFromAllDrives", "true");
  /* Without this the search is scoped to My Drive and answers nothing for a
     folder that is plainly there — the same trap as `supportsAllDrives` on the
     upload, one call earlier. */
  search.searchParams.set("corpora", "allDrives");

  const found = await fetch(search, { headers: { authorization: `Bearer ${bearer}` } });
  if (!found.ok) {
    throw await driveError("folder", found);
  }
  const hits = ((await found.json()) as { files?: { id: string; name: string }[] }).files ?? [];
  const hit = hits.find((f) => f.name.trim().toLowerCase() === wanted.toLowerCase());
  if (hit) return hit.id;

  const made = await fetch(`${FILES_URL}?supportsAllDrives=true&fields=id`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: wanted,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    }),
  });
  if (!made.ok) {
    throw await driveError("folder", made);
  }
  return ((await made.json()) as { id: string }).id;
}

/** The task folder under OPS (`ops_core.drive_paths`, 0172): each segment of
 *  `INVENTORY/FINISHED GOODS` found or made in turn. Two uploads racing on a
 *  brand-new folder can each make one; the next upload reuses the first found,
 *  and IT merges the pair by hand — rare, visible, and harmless to the files. */
export async function findOrCreatePath(opsFolderId: string, path: string): Promise<string> {
  const token = await accessToken();
  let at = opsFolderId;
  for (const segment of path.split("/").map((x) => x.trim()).filter(Boolean)) {
    at = await findOrCreateFolder(at, segment, token);
  }
  return at;
}

/** `OPS`, `ops`, ` Ops ` — the owner's folders are typed by hand. */
export function isOpsName(name: string): boolean {
  return name.trim().toLowerCase() === "ops";
}

/** Is this deployment able to reach Drive at all?
 *
 *  Asked by the route before it reads a file, so an unconfigured deployment
 *  answers in a sentence rather than after somebody has waited for a 12 MB
 *  upload to finish.
 */
export function driveConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

/** What IT → Google Drive shows for one recorded folder.
 *
 *  Two looks at the same id. `asUploader` uses the scope uploads use
 *  (`drive.file`); `asMember` uses `drive.readonly`, which sees whatever a
 *  member of the shared drive sees. Their difference is the answer to the
 *  owner's question, *can the app use a folder a person made?*:
 *
 *  - member sees it, uploader does not → the account is in the drive, and
 *    `drive.file` is what hides a hand-made OPS folder;
 *  - neither sees it → not a member of that shared drive, or a wrong id;
 *  - both see it → uploads can use it as it is.
 *
 *  Read-only: nothing is created, moved or changed.
 */
export interface FolderProbe {
  asUploader: { ok: boolean; status: number; message: string | null };
  asMember: {
    ok: boolean;
    status: number;
    message: string | null;
    name: string | null;
    isFolder: boolean;
    trashed: boolean;
    driveId: string | null;
    driveName: string | null;
    /** Whether this account may add files and folders in it (Contributor or
     *  above). False means Viewer or Commenter. */
    canAddChildren: boolean | null;
  };
}

export async function probeFolder(folderId: string): Promise<FolderProbe> {
  const fields = "id,name,mimeType,trashed,driveId,capabilities(canAddChildren)";
  const url = `${FILES_URL}/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=${fields}`;

  const look = async (scope: string) => {
    const token = await accessToken(scope);
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const e = await driveError("ops_folder", res);
      return { res: null, status: e.status, message: e.googleMessage, token };
    }
    return { res: await res.json() as {
      name?: string; mimeType?: string; trashed?: boolean; driveId?: string;
      capabilities?: { canAddChildren?: boolean };
    }, status: res.status, message: null, token };
  };

  const up = await look(SCOPE);
  const mem = await look(PROBE_SCOPE);

  let driveName: string | null = null;
  if (mem.res?.driveId) {
    const d = await fetch(
      `https://www.googleapis.com/drive/v3/drives/${encodeURIComponent(mem.res.driveId)}?fields=name`,
      { headers: { authorization: `Bearer ${mem.token}` } },
    );
    if (d.ok) driveName = ((await d.json()) as { name?: string }).name ?? null;
  }

  return {
    asUploader: { ok: up.res != null, status: up.status, message: up.message },
    asMember: {
      ok: mem.res != null,
      status: mem.status,
      message: mem.message,
      name: mem.res?.name ?? null,
      isFolder: mem.res?.mimeType === "application/vnd.google-apps.folder",
      trashed: mem.res?.trashed ?? false,
      driveId: mem.res?.driveId ?? null,
      driveName,
      canAddChildren: mem.res?.capabilities?.canAddChildren ?? null,
    },
  };
}

/** Can the app make a folder inside this one, and under which permission?
 *
 *  The owner's question (2026-09-28): *can the app create the folders
 *  itself, or must a person?* It is answered by trying, not by reading
 *  documentation. A folder named `_ops_app_test_<time>` is created inside
 *  `parentId`, once as uploads work today (`drive.file`) and once with full
 *  Drive access, and each one made is moved straight to the bin. The bin, not
 *  a delete, because a Content manager may bin in a shared drive but only a
 *  Manager may delete. */
export interface CreateTry {
  created: boolean;
  status: number;
  message: string | null;
  /** Moved to the bin again after the test. */
  binned: boolean;
}

export async function testCreateFolder(parentId: string): Promise<{ asUploader: CreateTry; withFullAccess: CreateTry }> {
  const attempt = async (scope: string): Promise<CreateTry> => {
    const token = await accessToken(scope);
    const made = await fetch(`${FILES_URL}?supportsAllDrives=true&fields=id`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: `_ops_app_test_${new Date().toISOString().replace(/[:.]/g, "-")}`,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    });
    if (!made.ok) {
      const e = await driveError("folder", made);
      return { created: false, status: e.status, message: e.googleMessage, binned: false };
    }
    const { id } = (await made.json()) as { id: string };
    const bin = await fetch(`${FILES_URL}/${encodeURIComponent(id)}?supportsAllDrives=true`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
    return { created: true, status: made.status, message: null, binned: bin.ok };
  };
  return { asUploader: await attempt(SCOPE), withFullAccess: await attempt(FULL_SCOPE) };
}
