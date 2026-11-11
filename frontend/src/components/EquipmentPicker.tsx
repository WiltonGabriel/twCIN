import { Check, Search, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { CatalogEquipment, MovementItem } from "../types";
import { BLOCKED_CONDITIONS, CONDITION_LABELS, conditionStyle } from "../types/labels";

export interface EquipmentSelection {
  equipment_id: number | null;
  equipment_name: string;
  patrimony: string;
}

interface EquipmentPickerProps {
  id?: string;
  equipments: CatalogEquipment[];
  movements: MovementItem[];
  value: EquipmentSelection;
  onChange: (value: EquipmentSelection) => void;
  /** Movimentação sendo editada: o equipamento dela não conta como "já está fora". */
  editingMovementId?: number;
}

/**
 * Seleção de equipamento por item do catálogo (nome + patrimônio + situação), guardando o id.
 * Antes o vínculo era feito pelo nome digitado e escolhia o primeiro item com nome igual.
 */
export function EquipmentPicker({ id, equipments, movements, value, onChange, editingMovementId }: EquipmentPickerProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const openByEquipment = useMemo(() => {
    const map = new Map<number, MovementItem>();
    for (const m of movements) {
      if (m.equipment_id && (m.status === "ativo" || m.status === "fixo") && m.id !== editingMovementId) {
        map.set(m.equipment_id, m);
      }
    }
    return map;
  }, [movements, editingMovementId]);

  const selected = value.equipment_id ? equipments.find((e) => e.id === value.equipment_id) : undefined;

  const unavailableReason = (eq: CatalogEquipment): string | null => {
    const out = openByEquipment.get(eq.id);
    if (out) return `Fora em ${out.document_code} (${out.sector_name})`;
    if (BLOCKED_CONDITIONS.includes(eq.condition_status)) return CONDITION_LABELS[eq.condition_status];
    return null;
  };

  const q = query.trim().toLowerCase();
  const results = equipments
    .filter((e) => e.active === 1 || e.id === value.equipment_id)
    .filter(
      (e) =>
        !q ||
        e.name.toLowerCase().includes(q) ||
        (e.patrimony || "").toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q)
    )
    .sort((a, b) => Number(Boolean(unavailableReason(a))) - Number(Boolean(unavailableReason(b))) || a.name.localeCompare(b.name, "pt-BR"))
    .slice(0, 30);

  const choose = (eq: CatalogEquipment) => {
    onChange({ equipment_id: eq.id, equipment_name: eq.name, patrimony: eq.patrimony || "" });
    setQuery("");
    setOpen(false);
  };

  const useFreeText = () => {
    onChange({ equipment_id: null, equipment_name: query.trim(), patrimony: "" });
    setQuery("");
    setOpen(false);
  };

  const clear = () => onChange({ equipment_id: null, equipment_name: "", patrimony: "" });

  // Já escolhido: mostra o item e permite trocar.
  if (value.equipment_name && !open) {
    return (
      <div className="space-y-2">
        <div className="tw-card px-3 py-2 flex items-center justify-between gap-2" style={{ backgroundColor: "var(--bg)" }}>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{value.equipment_name}</div>
            <div className="text-xs flex flex-wrap items-center gap-2" style={{ color: "var(--text-muted)" }}>
              {selected ? (
                <>
                  {selected.patrimony && <span className="font-mono">{selected.patrimony}</span>}
                  <span className="tw-badge" style={conditionStyle(selected.condition_status)}>
                    {CONDITION_LABELS[selected.condition_status]}
                  </span>
                </>
              ) : (
                <span>Item fora do catálogo</span>
              )}
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button type="button" className="tw-btn tw-btn-sm" onClick={() => setOpen(true)}>
              Trocar
            </button>
            <button type="button" className="tw-btn tw-btn-sm" aria-label="Limpar equipamento" onClick={clear}>
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
        {!selected && (
          <div>
            <label htmlFor={`${inputId}-pat`} className="tw-label">
              Nº do patrimônio (opcional)
            </label>
            <input
              id={`${inputId}-pat`}
              value={value.patrimony}
              onChange={(e) => onChange({ ...value, patrimony: e.target.value })}
              className="tw-input font-mono"
              placeholder="PAT-0000"
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: "var(--text-muted)" }}
          aria-hidden="true"
        />
        <input
          id={inputId}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar por nome, patrimônio ou categoria"
          className="tw-input"
          style={{ paddingLeft: "2.25rem" }}
          aria-expanded={open}
          aria-controls={open ? `${inputId}-list` : undefined}
        />
      </div>
      {open && (
        <div className="tw-card max-h-64 overflow-auto divide-y" style={{ borderColor: "var(--border)" }}>
          <ul
            id={`${inputId}-list`}
            role="listbox"
            aria-label="Equipamentos disponíveis"
            className="divide-y"
            style={{ borderColor: "var(--border)" }}
          >
            {results.map((eq) => {
              const reason = unavailableReason(eq);
              return (
                <li key={eq.client_uuid} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={eq.id === value.equipment_id}
                    aria-disabled={Boolean(reason)}
                    disabled={Boolean(reason)}
                    onClick={() => choose(eq)}
                    className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 cursor-pointer disabled:cursor-not-allowed"
                    style={{ opacity: reason ? 0.55 : 1, borderColor: "var(--border)" }}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{eq.name}</span>
                      <span className="block text-xs truncate" style={{ color: "var(--text-muted)" }}>
                        {[eq.patrimony, eq.category].filter(Boolean).join(" · ") || "Sem patrimônio"}
                        {reason ? ` — ${reason}` : ""}
                      </span>
                    </span>
                    {eq.id === value.equipment_id ? (
                      <Check className="w-4 h-4 shrink-0" style={{ color: "var(--ok)" }} aria-hidden="true" />
                    ) : (
                      <span className="tw-badge shrink-0" style={conditionStyle(eq.condition_status)}>
                        {CONDITION_LABELS[eq.condition_status]}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {results.length === 0 && (
            <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
              Nenhum equipamento do catálogo corresponde à busca.
            </p>
          )}
          {query.trim() && (
            <button type="button" onClick={useFreeText} className="w-full text-left px-3 py-2 text-sm cursor-pointer" style={{ color: "var(--brand)" }}>
              Usar &ldquo;{query.trim()}&rdquo; como item fora do catálogo
            </button>
          )}
          {value.equipment_name && (
            <button type="button" onClick={() => setOpen(false)} className="w-full text-left px-3 py-2 text-xs cursor-pointer" style={{ color: "var(--text-muted)" }}>
              Manter {value.equipment_name}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
