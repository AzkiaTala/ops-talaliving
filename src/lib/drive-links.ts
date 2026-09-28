/** Where an attachment opens in Google Drive, and its picture (F174).
 *
 *  Browser-safe: this only builds links, and the viewer's own Google session
 *  decides whether they open. A person who is a member of the shared drive
 *  sees the file. Anyone else gets Google's *request access*, which is the
 *  right answer for a KTP.
 *
 *  Three places hold a Drive id, depending on how the file arrived:
 *  - `web_view_link`: uploads since 0175;
 *  - `url`: captured evidence and pasted Drive links (`/file/d/<id>/…`);
 *  - `storage_path`: every upload, including those before 0175. It is the
 *    bare id, and a demo path (`demo/2026-09/x.jpg`) is not one.
 */

interface DriveRef {
  storage_path?: string | null;
  url?: string | null;
  web_view_link?: string | null;
  mime?: string | null;
  filename?: string | null;
}

const ID_IN_URL = /\/file\/d\/([A-Za-z0-9_-]{10,})|[?&]id=([A-Za-z0-9_-]{10,})/;
const BARE_ID = /^[A-Za-z0-9_-]{20,}$/;

export function driveFileId(a: DriveRef): string | null {
  for (const link of [a.web_view_link, a.url]) {
    const m = link ? ID_IN_URL.exec(link) : null;
    if (m) return m[1] ?? m[2];
  }
  const p = a.storage_path?.trim();
  return p && BARE_ID.test(p) ? p : null;
}

/** The page that opens the file, full size, in Drive. For a pasted link that
 *  is not Drive, the link itself. */
export function driveOpenUrl(a: DriveRef): string | null {
  if (a.web_view_link) return a.web_view_link;
  if (a.url) return a.url;
  const id = driveFileId(a);
  return id ? `https://drive.google.com/file/d/${id}/view` : null;
}

/** Drive's own thumbnail URL. The browser can only load it with a Google
 *  session that reaches the shared drive, so screens use `thumbProxyUrl`
 *  instead (F175). */
export function driveThumbUrl(a: DriveRef, width = 400): string | null {
  const id = driveFileId(a);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w${width}` : null;
}

/** The picture of an attachment, through this application: the server checks
 *  the person may read the attachment and fetches the thumbnail as the
 *  service account (`/api/documents/thumb/[id]`, F175). Null when the
 *  attachment has no Drive file behind it. */
export function thumbProxyUrl(a: DriveRef & { id: string }, width = 400): string | null {
  return driveFileId(a) ? `/api/documents/thumb/${encodeURIComponent(a.id)}?w=${width}` : null;
}

export function isImageFile(a: DriveRef): boolean {
  if (a.mime?.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(a.filename ?? "");
}
