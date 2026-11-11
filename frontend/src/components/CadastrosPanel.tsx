import { Pencil, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest } from "../services/api";
import type { CatalogLocation, CatalogSector, SuggestionsPayload } from "../types";
import { OnlineOnlyNotice } from "./OnlineOnlyNotice";

interface CadastrosPanelProps {
  sectors: CatalogSector[];
  locations: CatalogLocation[];
  suggestions: SuggestionsPayload;
  online: boolean;
  onCreateSector: (payload: { name: string; is_default?: boolean }) => Promise<CatalogSector>;
  onRefresh: () => Promise<void>;
}

function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const handler = () => onClose();
    d.addEventListener("close", handler);
    return () => d.removeEventListener("close", handler);
  }, [onClose]);
  return ref;
}

/** Setores e locais de destino (antes ficavam dentro de Movimentações). */
export function CadastrosPanel({ sectors, locations, suggestions, online, onCreateSector, onRefresh }: CadastrosPanelProps) {
  const [newSectorName, setNewSectorName] = useState("");
  const [newSectorDefault, setNewSectorDefault] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationSectorId, setNewLocationSectorId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingSec, setEditingSec] = useState<CatalogSector | null>(null);
  const [editingLoc, setEditingLoc] = useState<CatalogLocation | null>(null);

  const secDialogRef = useDialog(Boolean(editingSec), () => setEditingSec(null));
  const locDialogRef = useDialog(Boolean(editingLoc), () => setEditingLoc(null));

  const run = async (action: () => Promise<void>, fallback: string) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    }
  };

  const handleAddSector = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await onCreateSector({ name: newSectorName, is_default: newSectorDefault });
      setNewSectorName("");
      setNewSectorDefault(false);
    }, "Erro ao cadastrar setor.");
  };

  const handleAddLocation = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await apiRequest("/api/catalogs/locations", {
        method: "POST",
        body: JSON.stringify({
          name: newLocationName,
          sector_id: newLocationSectorId ? Number(newLocationSectorId) : null
        })
      });
      setNewLocationName("");
      setNewLocationSectorId("");
      await onRefresh();
    }, "Erro ao cadastrar local.");
  };

  const saveSector = (e: FormEvent) => {
    e.preventDefault();
    if (!editingSec) return;
    void run(async () => {
      await apiRequest(`/api/catalogs/sectors/${editingSec.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editingSec.name,
          is_default: editingSec.is_default === 1,
          active: editingSec.active === 1
        })
      });
      setEditingSec(null);
      await onRefresh();
    }, "Erro ao editar setor.");
  };

  const saveLocation = (e: FormEvent) => {
    e.preventDefault();
    if (!editingLoc) return;
    void run(async () => {
      await apiRequest(`/api/catalogs/locations/${editingLoc.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editingLoc.name,
          sector_id: editingLoc.sector_id,
          active: editingLoc.active === 1
        })
      });
      setEditingLoc(null);
      await onRefresh();
    }, "Erro ao editar local.");
  };

  const uncatalogued = suggestions.sectors.filter((s) => s.id === null);

  return (
    <div className="space-y-5">
      {!online && (
        <OnlineOnlyNotice text="Você está offline. Novos setores vão para a fila de envio; locais e edições exigem conexão." />
      )}
      {error && (
        <div role="alert" className="px-3 py-2 rounded-lg border text-sm" style={{ backgroundColor: "var(--cin-red-soft)", borderColor: "var(--cin-red)", color: "var(--cin-red)" }}>
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className="space-y-3" aria-labelledby="cad-setores">
          <h3 id="cad-setores" className="text-sm font-semibold">Setores de destino</h3>
          <form onSubmit={handleAddSector} className="space-y-2">
            <div className="flex gap-2">
              <input aria-label="Nome do setor" required value={newSectorName} onChange={(e) => setNewSectorName(e.target.value)} placeholder="Nome do setor" className="tw-input flex-1" />
              <button type="submit" className="tw-btn tw-btn-primary shrink-0">
                <Plus className="w-4 h-4" aria-hidden="true" /> Adicionar
              </button>
            </div>
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={newSectorDefault} onChange={(e) => setNewSectorDefault(e.target.checked)} />
              <span>Usar como setor padrão nas movimentações</span>
            </label>
          </form>

          <ul className="space-y-1.5">
            {sectors.map((sec) => (
              <li key={sec.id} className="tw-card px-3 py-2 flex items-center justify-between gap-2" style={{ backgroundColor: "var(--bg)" }}>
                <div className="flex items-center gap-2 text-sm">
                  <strong>{sec.name}</strong>
                  {sec.is_default === 1 && sec.active === 1 && <span className="tw-badge" style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand)" }}>Padrão</span>}
                  {sec.active === 0 && <span className="tw-badge" style={{ backgroundColor: "var(--cin-red-soft)", color: "var(--cin-red)" }}>Inativo</span>}
                </div>
                <button type="button" className="tw-btn tw-btn-sm" disabled={!online} onClick={() => setEditingSec({ ...sec })}>
                  <Pencil className="w-3 h-3" aria-hidden="true" /> Editar
                </button>
              </li>
            ))}
            {sectors.length === 0 && <li className="text-xs" style={{ color: "var(--text-muted)" }}>Nenhum setor cadastrado.</li>}
          </ul>

          {uncatalogued.length > 0 && (
            <div className="pt-3 border-t space-y-2" style={{ borderColor: "var(--border)" }}>
              <div className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                Setores usados em movimentações e ainda fora do catálogo
              </div>
              <div className="flex flex-wrap gap-2">
                {uncatalogued.map((sec) => (
                  <button key={sec.name} type="button" className="tw-btn tw-btn-sm" onClick={() => void run(async () => void (await onCreateSector({ name: sec.name })), "Erro ao cadastrar setor.")}>
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Cadastrar &ldquo;{sec.name}&rdquo;
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3" aria-labelledby="cad-locais">
          <h3 id="cad-locais" className="text-sm font-semibold">Locais de instalação</h3>
          <form onSubmit={handleAddLocation} className="space-y-2">
            <div className="flex gap-2">
              <input aria-label="Nome do local" required value={newLocationName} onChange={(e) => setNewLocationName(e.target.value)} placeholder="Ex.: Sala 104, Auditório" className="tw-input flex-1" />
              <button type="submit" disabled={!online} className="tw-btn tw-btn-primary shrink-0">
                <Plus className="w-4 h-4" aria-hidden="true" /> Adicionar
              </button>
            </div>
            <select aria-label="Setor do local" value={newLocationSectorId} onChange={(e) => setNewLocationSectorId(e.target.value)} className="tw-input">
              <option value="">Sem setor específico</option>
              {sectors.filter((s) => s.active === 1).map((s) => (
                <option key={s.id} value={s.id}>Setor: {s.name}</option>
              ))}
            </select>
          </form>

          <ul className="space-y-1.5">
            {locations.map((loc) => {
              const linked = sectors.find((s) => s.id === loc.sector_id);
              return (
                <li key={loc.id} className="tw-card px-3 py-2 flex items-center justify-between gap-2" style={{ backgroundColor: "var(--bg)" }}>
                  <div className="text-sm">
                    <strong>{loc.name}</strong>
                    <div className="text-xs flex gap-2" style={{ color: "var(--text-muted)" }}>
                      {linked && <span>Setor: {linked.name}</span>}
                      {loc.active === 0 && <span style={{ color: "var(--cin-red)" }}>Inativo</span>}
                    </div>
                  </div>
                  <button type="button" className="tw-btn tw-btn-sm" disabled={!online} onClick={() => setEditingLoc({ ...loc })}>
                    <Pencil className="w-3 h-3" aria-hidden="true" /> Editar
                  </button>
                </li>
              );
            })}
            {locations.length === 0 && <li className="text-xs" style={{ color: "var(--text-muted)" }}>Nenhum local cadastrado.</li>}
          </ul>
        </section>
      </div>

      <dialog ref={secDialogRef} aria-labelledby="edit-sec-title" className="m-auto w-[min(94vw,420px)] rounded-xl p-5 shadow-xl">
        {editingSec && (
          <form onSubmit={saveSector} className="space-y-3">
            <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: "var(--border)" }}>
              <h3 id="edit-sec-title" className="text-sm font-semibold">Editar setor</h3>
              <button type="button" aria-label="Fechar" onClick={() => setEditingSec(null)} className="tw-btn tw-btn-sm"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label htmlFor="sec-name" className="tw-label">Nome</label>
              <input id="sec-name" required value={editingSec.name} onChange={(e) => setEditingSec({ ...editingSec, name: e.target.value })} className="tw-input" />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={editingSec.is_default === 1} onChange={(e) => setEditingSec({ ...editingSec, is_default: e.target.checked ? 1 : 0 })} />
              <span>Setor padrão</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={editingSec.active === 1} onChange={(e) => setEditingSec({ ...editingSec, active: e.target.checked ? 1 : 0 })} />
              <span>Ativo</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="tw-btn" onClick={() => setEditingSec(null)}>Cancelar</button>
              <button type="submit" className="tw-btn tw-btn-primary">Salvar</button>
            </div>
          </form>
        )}
      </dialog>

      <dialog ref={locDialogRef} aria-labelledby="edit-loc-title" className="m-auto w-[min(94vw,420px)] rounded-xl p-5 shadow-xl">
        {editingLoc && (
          <form onSubmit={saveLocation} className="space-y-3">
            <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: "var(--border)" }}>
              <h3 id="edit-loc-title" className="text-sm font-semibold">Editar local</h3>
              <button type="button" aria-label="Fechar" onClick={() => setEditingLoc(null)} className="tw-btn tw-btn-sm"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label htmlFor="loc-name" className="tw-label">Nome</label>
              <input id="loc-name" required value={editingLoc.name} onChange={(e) => setEditingLoc({ ...editingLoc, name: e.target.value })} className="tw-input" />
            </div>
            <div>
              <label htmlFor="loc-sector" className="tw-label">Setor</label>
              <select id="loc-sector" value={editingLoc.sector_id ?? ""} onChange={(e) => setEditingLoc({ ...editingLoc, sector_id: e.target.value ? Number(e.target.value) : null })} className="tw-input">
                <option value="">Sem setor específico</option>
                {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={editingLoc.active === 1} onChange={(e) => setEditingLoc({ ...editingLoc, active: e.target.checked ? 1 : 0 })} />
              <span>Ativo</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="tw-btn" onClick={() => setEditingLoc(null)}>Cancelar</button>
              <button type="submit" className="tw-btn tw-btn-primary">Salvar</button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
