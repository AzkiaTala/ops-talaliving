"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, Check, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTr } from "@/lib/i18n";

export interface ComboboxOption {
  value: string;
  label: string;
  sublabel?: string;
}

const MAX_VISIBLE = 50;

/** Type-to-filter picker for large option lists (e.g. 200+ member names) —
 * a plain <select> forces scrolling through every option, this filters
 * client-side as you type instead. */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  emptyOptionLabel,
  onCreate,
  createLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  emptyOptionLabel?: string;
  /** When given, a name the list does not contain can still be entered.
   *  Some fields are a closed list — an account code, a unit — and passing
   *  nothing here keeps them closed. Others are not: a vendor somebody typed
   *  is always accepted, and refusing it would make the form lie about what
   *  the business does. */
  onCreate?: (name: string) => void | Promise<void>;
  createLabel?: (query: string) => string;
}) {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = !q ? options : options.filter((o) => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q));
    return base.slice(0, MAX_VISIBLE);
  }, [options, query]);

  useEffect(() => {
    setHighlighted(0);
  }, [query, open]);

  function selectOption(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[highlighted];
      if (opt) selectOption(opt.value);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          value={open ? query : (selected?.label ?? "")}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onKeyDown={handleKeyDown}
          placeholder={selected ? selected.label : (placeholder ?? tr("Search…", "Cari…"))}
          className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-7 text-sm focus:border-brand-400 focus:outline-none"
        />
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {emptyOptionLabel && (
            <button
              type="button"
              onClick={() => selectOption("")}
              className={cn("flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-brand-50", value === "" && "bg-brand-50/60")}
            >
              {emptyOptionLabel}
              {value === "" && <Check className="h-3.5 w-3.5 text-brand-600" />}
            </button>
          )}
          {filtered.length === 0 && !(onCreate && query.trim()) && (
            <p className="px-3 py-2 text-sm text-slate-400">{tr("No match.", "Tidak ada yang cocok.")}</p>
          )}
          {onCreate && query.trim().length > 0 &&
            !filtered.some((o) => o.label.toLowerCase() === query.trim().toLowerCase()) && (
            <button
              type="button"
              onClick={async () => {
                const name = query.trim();
                setOpen(false);
                setQuery("");
                await onCreate(name);
              }}
              className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm text-brand-700 hover:bg-brand-50"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">{createLabel ? createLabel(query.trim()) : tr(`Add “${query.trim()}”`, `Tambah “${query.trim()}”`)}</span>
            </button>
          )}
          {filtered.map((o, i) => (
            <button
              key={o.value}
              type="button"
              onClick={() => selectOption(o.value)}
              onMouseEnter={() => setHighlighted(i)}
              className={cn(
                "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-brand-50",
                i === highlighted && "bg-brand-50",
                value === o.value && "font-medium text-brand-700",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate">{o.label}</span>
                {o.sublabel && <span className="block truncate text-xs text-slate-400">{o.sublabel}</span>}
              </span>
              {value === o.value && <Check className="h-3.5 w-3.5 shrink-0 text-brand-600" />}
            </button>
          ))}
          {options.length > MAX_VISIBLE && filtered.length === MAX_VISIBLE && (
            <p className="px-3 py-1.5 text-[11px] text-slate-400">{tr(`Showing the first ${MAX_VISIBLE} — type to narrow.`, `Menampilkan ${MAX_VISIBLE} pertama — ketik untuk mempersempit.`)}</p>
          )}
        </div>
      )}
    </div>
  );
}
