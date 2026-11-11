import { Check, ChevronDown, ListFilter, PenLine, Plus, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { CatalogNamedItem } from "../types";

export interface CatalogSelectorLabels {
  entitySingular: string;
  gender: "o" | "a";
  selectPlaceholder: string;
  searchPlaceholder: string;
  manualPlaceholder: string;
  listTitle: string;
  emptyListMessage: string;
}

interface CatalogSelectorProps<T extends CatalogNamedItem> {
  id: string;
  value: string;
  onChange: (name: string) => void;
  items: T[];
  suggestedNames?: string[];
  onCreateItem: (payload: { name: string; is_default?: boolean }) => Promise<T>;
  labels: CatalogSelectorLabels;
  required?: boolean;
  allowClear?: boolean;
}

export function findCatalogItem<T extends CatalogNamedItem>(items: T[], name: string): T | undefined {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return undefined;
  return items.find((item) => item.active === 1 && item.name.trim().toLowerCase() === trimmed);
}

export function CatalogSelector<T extends CatalogNamedItem>({
  id,
  value,
  onChange,
  items,
  suggestedNames = [],
  onCreateItem,
  labels,
  required = false,
  allowClear = false
}: CatalogSelectorProps<T>) {
  const activeItems = items.filter((item) => item.active === 1);
  const listboxId = useId();
  const titleId = useId();

  const [open, setOpen] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    const dialog = confirmDialogRef.current;
    if (!dialog) return;
    if (confirmName && !dialog.open) {
      dialog.showModal();
    } else if (!confirmName && dialog.open) {
      dialog.close();
    }
  }, [confirmName]);

  useEffect(() => {
    const dialog = confirmDialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      dialog.returnValue = "";
      setConfirmName(null);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);

  const filteredList = activeItems.filter((item) => {
    const q = searchQuery.trim().toLowerCase();
    return !q || item.name.toLowerCase().includes(q);
  });

  const knownAutocomplete = Array.from(
    new Map(
      [
        ...activeItems.map((item) => ({
          name: item.name,
          inCatalog: true
        })),
        ...suggestedNames.map((n) => ({
          name: n,
          inCatalog: false
        }))
      ].map((entry) => [entry.name.trim().toLowerCase(), entry])
    ).values()
  );

  const trimmedValue = value.trim();
  const exactCatalog = findCatalogItem(items, trimmedValue);
  const autocompleteMatches =
    manualMode && trimmedValue
      ? knownAutocomplete
          .filter(
            (item) =>
              item.name.toLowerCase().includes(trimmedValue.toLowerCase()) &&
              item.name.toLowerCase() !== trimmedValue.toLowerCase()
          )
          .slice(0, 5)
      : [];

  const art = labels.gender;
  const articleUpper = art === "a" ? "A" : "O";

  const handleOpenToggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        setSearchQuery("");
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      return next;
    });
  };

  const handleEnterManual = (prefill?: string) => {
    setManualMode(true);
    setOpen(false);
    setCreateError(null);
    if (prefill !== undefined) {
      onChange(prefill);
    }
    window.setTimeout(() => manualInputRef.current?.focus(), 0);
  };

  const handleConfirmCreate = async () => {
    if (!confirmName) return;
    setCreateError(null);
    setCreating(true);
    try {
      const created = await onCreateItem({ name: confirmName });
      onChange(created.name);
      setConfirmName(null);
      setManualMode(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : `Erro ao criar ${labels.entitySingular}.`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div ref={containerRef} className="relative space-y-1.5">
      {!manualMode ? (
        <>
          {required && (
            <input
              type="text"
              tabIndex={-1}
              required
              value={value}
              onChange={() => {}}
              onInvalid={(e) => {
                e.preventDefault();
                setOpen(true);
                window.setTimeout(() => searchInputRef.current?.focus(), 0);
              }}
              aria-hidden="true"
              className="sr-only"
            />
          )}

          <div className="flex gap-1.5">
            <button
              type="button"
              id={id}
              aria-expanded={open}
              aria-controls={open ? listboxId : undefined}
              aria-haspopup="listbox"
              onClick={handleOpenToggle}
              className="tw-input flex-1 flex items-center justify-between gap-2 text-left cursor-pointer"
            >
              <span className="truncate" style={!value ? { color: "var(--text-muted)" } : undefined}>
                {value || labels.selectPlaceholder}
              </span>
              <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
            </button>

            {allowClear && value && (
              <button
                type="button"
                aria-label={`Limpar ${labels.entitySingular}`}
                onClick={() => onChange("")}
                className="min-h-[44px] px-3 rounded-lg border text-xs cursor-pointer shrink-0 flex items-center justify-center"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--bg)" }}
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {open && (
            <div
              className="absolute left-0 right-0 z-30 mt-1 rounded-xl border shadow-lg p-2 space-y-2"
              style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
            >
              <div className="relative">
                <Search
                  className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: "var(--text-muted)" }}
                  aria-hidden="true"
                />
                <input
                  ref={searchInputRef}
                  type="search"
                  aria-label={labels.searchPlaceholder}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={labels.searchPlaceholder}
                  className="tw-input pl-9"
                />
              </div>

              <div id={listboxId} role="listbox" aria-label={labels.listTitle} className="max-h-56 overflow-auto space-y-1">
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => handleEnterManual()}
                  className="w-full min-h-[44px] px-3 py-2 rounded-lg text-left text-sm font-medium flex items-center gap-2 border cursor-pointer"
                  style={{
                    backgroundColor: "var(--brand-soft)",
                    borderColor: "var(--brand)",
                    color: "var(--brand)"
                  }}
                >
                  <PenLine className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Digitar manualmente...</span>
                </button>

                {filteredList.map((item) => {
                  const selected = value.trim().toLowerCase() === item.name.toLowerCase();
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onChange(item.name);
                        setOpen(false);
                      }}
                      className="w-full min-h-[44px] px-3 py-2 rounded-lg text-left text-sm flex items-center justify-between gap-2 cursor-pointer transition"
                      style={{
                        backgroundColor: selected ? "var(--surface-alt)" : "transparent"
                      }}
                    >
                      <span className="truncate font-medium">{item.name}</span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {item.is_default === 1 && (
                          <span
                            className="px-2 py-0.5 rounded text-[11px] font-semibold"
                            style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand)" }}
                          >
                            Padrão
                          </span>
                        )}
                        {selected && <Check className="w-4 h-4" style={{ color: "var(--brand)" }} aria-hidden="true" />}
                      </span>
                    </button>
                  );
                })}

                {filteredList.length === 0 && (
                  <div className="px-3 py-2 text-xs space-y-2" style={{ color: "var(--text-muted)" }}>
                    <p>{labels.emptyListMessage}</p>
                    {searchQuery.trim() && (
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => handleEnterManual(searchQuery.trim())}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
                        style={{ backgroundColor: "var(--brand)", color: "var(--brand-fg)" }}
                      >
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                        Usar &ldquo;{searchQuery.trim()}&rdquo; manualmente
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <input
              ref={manualInputRef}
              id={id}
              type="text"
              required={required}
              value={value}
              onChange={(e) => {
                setCreateError(null);
                onChange(e.target.value);
              }}
              onBlur={() => {
                if (exactCatalog && value !== exactCatalog.name) {
                  onChange(exactCatalog.name);
                }
              }}
              placeholder={labels.manualPlaceholder}
              className="tw-input flex-1"
            />
            <button
              type="button"
              onClick={() => {
                setManualMode(false);
                setOpen(true);
              }}
              title={labels.listTitle}
              className="inline-flex items-center gap-1 min-h-[44px] px-3 rounded-lg border text-xs font-medium cursor-pointer shrink-0"
              style={{ borderColor: "var(--border)" }}
            >
              <ListFilter className="w-3.5 h-3.5" aria-hidden="true" />
              Lista
            </button>
          </div>

          {exactCatalog && (
            <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ok)" }}>
              <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                {labels.entitySingular[0].toUpperCase() + labels.entitySingular.slice(1)} já cadastrad{art}: {exactCatalog.name}
              </span>
            </div>
          )}

          {!exactCatalog && autocompleteMatches.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span style={{ color: "var(--text-muted)" }}>Autocompletar:</span>
              {autocompleteMatches.map((match) => (
                <button
                  key={match.name}
                  type="button"
                  onClick={() => {
                    onChange(match.name);
                    if (match.inCatalog) {
                      setManualMode(false);
                    }
                  }}
                  className="px-2.5 py-1 rounded-full border font-medium cursor-pointer"
                  style={{
                    backgroundColor: match.inCatalog ? "var(--brand-soft)" : "var(--bg)",
                    borderColor: match.inCatalog ? "var(--brand)" : "var(--border)",
                    color: match.inCatalog ? "var(--brand)" : "var(--text)"
                  }}
                >
                  {match.name}
                </button>
              ))}
            </div>
          )}

          {trimmedValue && !exactCatalog && (
            <div
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs"
              style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}
            >
              <span style={{ color: "var(--text-muted)" }}>
                {labels.entitySingular[0].toUpperCase() + labels.entitySingular.slice(1)} não cadastrad{art} no catálogo.
              </span>
              <button
                type="button"
                onClick={() => setConfirmName(trimmedValue)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold cursor-pointer"
                style={{ backgroundColor: "var(--brand)", color: "var(--brand-fg)" }}
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                Criar {labels.entitySingular}
              </button>
            </div>
          )}
        </div>
      )}

      <dialog
        ref={confirmDialogRef}
        aria-labelledby={titleId}
        className="m-auto w-[min(94vw,420px)] rounded-xl p-5 shadow-xl"
      >
        {confirmName && (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: "var(--border)" }}>
              <h3 id={titleId} className="text-sm font-semibold">
                Confirmar criação de {labels.entitySingular}
              </h3>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setConfirmName(null)}
                className="p-1 rounded border cursor-pointer"
                style={{ borderColor: "var(--border)" }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm">
              {articleUpper} {labels.entitySingular} <strong>{confirmName}</strong> ainda não existe no catálogo. Deseja criá-l{art} agora?
            </p>

            {createError && (
              <div
                role="alert"
                className="px-3 py-2 rounded-lg text-xs border"
                style={{
                  backgroundColor: "var(--cin-red-soft)",
                  borderColor: "var(--cin-red)",
                  color: "var(--cin-red)"
                }}
              >
                {createError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmName(null)}
                className="px-3.5 py-2 rounded-lg text-xs border cursor-pointer"
                style={{ borderColor: "var(--border)" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={handleConfirmCreate}
                className="px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-60"
                style={{ backgroundColor: "var(--brand)", color: "var(--brand-fg)" }}
              >
                {creating ? "Criando..." : `Sim, criar ${labels.entitySingular}`}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
