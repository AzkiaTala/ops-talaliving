/** The declared write: one engine for every tool that names its seam (D317).
 *
 *  `draftShape` and the confirm branches in `@/lib/john-lau` are a card and a
 *  write written by hand per tool. This file is the same two things written
 *  once, driven by a row of `ops_asst.v_tool_seams`: the fields the card shows
 *  and the call the Confirm makes. Both implementations use it — the demo
 *  with its catalogue copy and its own functions, the live client with the
 *  database's rows and PostgREST — so a declared tool behaves the same in the
 *  sandbox and on the real thing by construction.
 *
 *  ## What it will not do
 *
 *  - **Fill in a blank** (D217). A required field left empty is refused with
 *    the field named, before the seam is called; a number that does not read
 *    as a number is refused, not rounded into one.
 *  - **Write anything but the card** (D220). The payload is built from the
 *    fields as the person left them, by key. The sentence's arguments only
 *    chose what the card showed first.
 *  - **Decide.** The seam decides, as the person, and its envelope comes back
 *    as it is — a refusal, an invalid field or a conflict is the answer, and
 *    the dock reads it out.
 */
import type { AssistantDraft, SeamField, ToolSeam } from "@/services/assistant/contracts";
import { invalid, isOk, ok, refused, type Result } from "@/services/_shared/envelope";
import type { Lang } from "@/lib/i18n";

/** John Lau stamps his envelopes `procurement`, in both layers. */
const SERVICE = "procurement" as const;

/** The same words `draftShape` uses for a blank, so both kinds of card read
 *  alike — and the dock, which treats a leading `—` as *empty*, clears it. */
export const BLANK: Record<Lang, string> = { id: "— belum diisi —", en: "— not filled in —" };

const label = (f: SeamField, lang: Lang) => (lang === "id" ? f.label_id : f.label_en);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The only arguments a declared tool accepts from a sentence or a model:
 *  the `arg` of each of its fields (D300). Everything else is dropped here,
 *  whichever reader produced it. */
export function allowedArgs(spec: ToolSeam): string[] {
  return spec.fields.map((f) => f.arg).filter((a): a is string => !!a);
}

/** What each field shows first, **keyed by field key**, resolved once when the
 *  draft is opened and stored as the draft's `args`.
 *
 *  Resolved then rather than on every read so a card opened on Monday and
 *  read on Tuesday still shows Monday's date — the draft is a record of what
 *  was proposed, and a proposal that changes when you look at it again is not
 *  one. A sentence argument wins; then the field's default; then nothing. */
export function seamInitial(
  spec: ToolSeam, args: Record<string, string>, lang: Lang, today: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of spec.fields) {
    const said = f.arg ? String(args[f.arg] ?? "").trim() : "";
    const v = said
      || (f.default_kind === "today" ? today : "")
      || (f.default_kind === "text" ? (lang === "id" ? f.default_id : f.default_en) ?? "" : "");
    if (v) out[f.key] = v.slice(0, 200);
  }
  return out;
}

/** The card: every field, in order, with what it shows first. */
export function seamDraftShape(
  spec: ToolSeam, initial: Record<string, string>, lang: Lang,
): Pick<AssistantDraft, "headline" | "fields" | "warnings"> {
  const id = lang === "id";
  const note = id ? spec.note_id : spec.note_en;
  const blanks = spec.fields.filter((f) => f.required && !initial[f.key]);
  return {
    headline: id ? spec.headline_id : spec.headline_en,
    fields: spec.fields.map((f) => ({
      key: f.key,
      param: f.param,
      label: `${label(f, lang)}${f.required ? " *" : ""}`,
      value: initial[f.key] ?? BLANK[lang],
    })),
    warnings: [
      ...(blanks.length ? [id
        ? `Belum diisi: ${blanks.map((f) => label(f, lang)).join(", ")}. Saya tidak mengisinya untuk Anda.`
        : `Not filled in yet: ${blanks.map((f) => label(f, lang)).join(", ")}. I do not fill these in for you.`] : []),
      ...(note ? [note] : []),
    ],
  };
}

/** The fields as the person left them → the seam's parameters.
 *
 *  A blank optional field is **left out** rather than sent empty, so an rpc
 *  parameter keeps its own default (`p_region default null`) and an api input
 *  simply lacks the key. The refusals name the field by key, the same way a
 *  seam's own `detail.field` does, so the dock marks the right input either
 *  way. */
export function seamPayload(
  spec: ToolSeam, fields: Record<string, string>, lang: Lang,
): Result<Record<string, unknown>> {
  const id = lang === "id";
  const out: Record<string, unknown> = {};
  for (const f of spec.fields) {
    let raw = String(fields[f.key] ?? "").trim();
    if (raw.startsWith("—")) raw = "";
    if (!raw) {
      if (f.required) {
        return invalid(SERVICE, "field_required",
          id ? `Isi "${label(f, lang)}" dulu.` : `Fill in "${label(f, lang)}" first.`, { field: f.key });
      }
      continue;
    }
    switch (f.type) {
      case "number": {
        /* `2,5` is how half is written here; a thousands separator is not
           guessed at. `1.000` is refused rather than read as one or as a
           thousand — the person types the figure they mean. */
        if (!/^-?\d+([.,]\d+)?$/.test(raw) || /^\d{1,3}\.\d{3}$/.test(raw)) {
          return invalid(SERVICE, "not_a_number",
            id ? `"${label(f, lang)}" harus angka, misalnya 5 atau 2,5.` : `"${label(f, lang)}" must be a number, e.g. 5 or 2.5.`,
            { field: f.key });
        }
        out[f.param] = Number(raw.replace(",", "."));
        break;
      }
      case "date":
        if (!ISO.test(raw)) {
          return invalid(SERVICE, "not_a_date",
            id ? `"${label(f, lang)}" ditulis TTTT-BB-HH, misalnya 2026-10-02.` : `Write "${label(f, lang)}" as YYYY-MM-DD, e.g. 2026-10-02.`,
            { field: f.key });
        }
        out[f.param] = raw;
        break;
      case "choice": {
        const hit = (f.choices ?? []).find((c) => c.toLowerCase() === raw.toLowerCase());
        if (!hit) {
          return invalid(SERVICE, "not_a_choice",
            id ? `"${label(f, lang)}" salah satu dari: ${(f.choices ?? []).join(", ")}.` : `"${label(f, lang)}" is one of: ${(f.choices ?? []).join(", ")}.`,
            { field: f.key });
        }
        out[f.param] = hit;
        break;
      }
      default:
        out[f.param] = raw;
    }
  }
  return ok(SERVICE, out);
}

/** How a layer calls a seam: its own functions, or PostgREST. */
export type SeamCall = (
  spec: ToolSeam, params: Record<string, unknown>, idempotencyKey: string,
) => Promise<Result<unknown>>;

/** "Ya, tulis" on a declared draft: the payload, the call, and the name of
 *  what it produced. The seam's envelope is returned untouched when it is not
 *  `ok` — the draft stays open, and the person fixes the field it named. */
export async function confirmSeam(
  spec: ToolSeam, fields: Record<string, string>, idempotencyKey: string, lang: Lang, call: SeamCall,
): Promise<Result<string | null>> {
  const payload = seamPayload(spec, fields, lang);
  if (!isOk(payload)) return payload;
  const res = await call(spec, payload.data, idempotencyKey);
  if (!isOk(res)) return res;
  const data = res.data as Record<string, unknown> | null;
  const ref = spec.result_ref && data && data[spec.result_ref] != null ? String(data[spec.result_ref]) : null;
  return ok(SERVICE, ref);
}

/** An api seam, found by name in a layer's own modules. A name that is not a
 *  function there is refused by name — a catalogue row pointing at nothing is
 *  a bug to see, not a write to pretend happened. */
export function apiSeamCall(modules: Record<string, Record<string, unknown>>): SeamCall {
  return async (spec, params, key) => {
    const [svc, fn] = spec.seam.split(".");
    const f = modules[svc]?.[fn];
    if (typeof f !== "function") {
      return refused(SERVICE, "seam_missing", `${spec.seam} is not a function this layer has.`, { seam: spec.seam });
    }
    return (f as (input: unknown, key?: string) => Promise<Result<unknown>>)(params, key);
  };
}
