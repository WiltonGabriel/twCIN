import { Pencil, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { apiRequest } from "../services/api";
import type { CatalogCategory, CatalogLocation, CatalogNamedItem, CatalogSector, SuggestionsPayload } from "../types";
import { OnlineOnlyNotice } from "./OnlineOnlyNotice";

interface CadastrosPanelProps {
  sectors: CatalogSector[];
  categories: CatalogCategory[];
  locations: CatalogLocation[];
  suggestions: SuggestionsPayload;
  online: boolean;
  onCreateSector: (payload: { name: string; is_default?: boolean }) => Promise<CatalogSector>;
  onCreateCategory: (payload: { name: string; is_default?: boolean }) => Promise<CatalogCategory>;
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
    const handler = () => {
      d.returnValue = "";
      onClose();
    };
    d.addEventListener("close", handler);
    return () => d.removeEventListener("close", handler);
  }, [onClose]);
  return ref;
}

interface NamedCatalogSectionProps<T extends CatalogNamedItem> {
  heading: string;
  inputLabel: string;
  inputPlaceholder: string;
  defaultCheckboxLabel: string;
  emptyText: string;
  uncataloguedTitle: string;
  items: T[];
  suggestionsList: Array<{ id: number | null; name: string }>;
  online: boolean;
  onCreate: (payload: { name: string; is_default?: boolean }) => Promise<T>;
  onEdit: (item: T) => void;
  onError: (msg: string | null) => void;
  createErrorFallback: string;
}

function NamedCatalogSection<T extends CatalogNamedItem>({
  heading,
  inputLabel,
  inputPlaceholder,
  defaultCheckboxLabel,
  emptyText,
  uncataloguedTitle,
  items,
  suggestionsList,
  online,
  onCreate,
  onEdit,
  onError,
  createErrorFallback
}: NamedCatalogSectionProps<T>) {
  const headingId = useId();
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const uncatalogued = suggestionsList.filter((s) => s.id === null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onError(null);
    void (async () => {
      try {
        await onCreate({ name, is_default: isDefault });
        setName("");
        setIsDefault(false);
      } catch (err) {
        onError(err instanceof Error ? err.message : createErrorFallback);
      }
    })();
  };

  return (
    <section className="space-y-3" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold">{heading}</h3>
      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="flex gap-2">
          <input
            aria-label={inputLabel}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={inputPlaceholder}
            className="tw-input flex-1"
          />
          <button type="submit" className="tw-btn tw-btn-primary shrink-0">
            <Plus className="w-4 h-4" aria-hidden="true" /> Adicionar
          </button>
        </div>
        <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          <span>{defaultCheckboxLabel}</span>
        </label>
      </form>

      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.id} className="tw-card px-3 py-2 flex items-center justify-between gap-2" style={{ backgroundColor: "var(--bg)" }}>
            <div className="flex items-center gap-2 text-sm">
              <strong>{item.name}</strong>
              {item.is_default === 1 && item.active === 1 && (
                <span className="tw-badge" style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand)" }}>
                  Padrão
                </span>
              )}
              {item.active === 0 && (
                <span className="tw-badge" style={{ backgroundColor: "var(--cin-red-soft)", color: "var(--cin-red)" }}>
                  Inativo
                </span>
              )}
            </div>
            <button type="button" className="tw-btn tw-btn-sm" disabled={!online} onClick={() => onEdit({ ...item })}>
              <Pencil className="w-3 h-3" aria-hidden="true" /> Editar
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="text-xs" style={{ color: "var(--text-muted)" }}>{emptyText}</li>}
      </ul>

      {uncatalogued.length > 0 && (
        <div className="pt-3 border-t space-y-2" style={{ borderColor: "var(--border)" }}>
          <div className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
            {uncataloguedTitle}
          </div>
          <div className="flex flex-wrap gap-2">
            {uncatalogued.map((entry) => (
              <button
                key={entry.name}
                type="button"
                className="tw-btn tw-btn-sm"
                onClick={() => {
                  onError(null);
                  void onCreate({ name: entry.name }).catch((err) =>
                    onError(err instanceof Error ? err.message : createErrorFallback)
                  );
                }}
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Cadastrar &ldquo;{entry.name}&rdquo;
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Setores, categorias e locais configuráveis usados nas movimentações e equipamentos. */
export function CadastrosPanel({
  sectors,
  categories,
  locations,
  suggestions,
  online,
  onCreateSector,
  onCreateCategory,
  onRefresh
}: CadastrosPanelProps) {
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationSectorId, setNewLocationSectorId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingSec, setEditingSec] = useState<CatalogSector | null>(null);
  const [editingCat, setEditingCat] = useState<CatalogCategory | null>(null);
  const [editingLoc, setEditingLoc] = useState<CatalogLocation | null>(null);

  const secDialogRef = useDialog(Boolean(editingSec), () => setEditingSec(null));
  const catDialogRef = useDialog(Boolean(editingCat), () => setEditingCat(null));
  const locDialogRef = useDialog(Boolean(editingLoc), () => setEditingLoc(null));

  const run = async (action: () => Promise<void>, fallback: string) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    }
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

  const saveNamedCatalog = (
    endpoint: string,
    target: CatalogNamedItem | null,
    clear: () => void,
    fallback: string
  ) => (e: FormEvent) => {
    e.preventDefault();
    if (!target) return;
    void run(async () => {
      await apiRequest(`${endpoint}/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: target.name,
          is_default: target.is_default === 1,
          active: target.active === 1
        })
      });
      clear();
      await onRefresh();
    }, fallback);
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

  return (
    <div className="space-y-6">
      {!online && (
        <OnlineOnlyNotice text="Você está offline. Novos setores e categorias vão para a fila de envio; locais e edições exigem conexão." />
      )}
      {error && (
        <div role="alert" className="px-3 py-2 rounded-lg border text-sm" style={{ backgroundColor: "var(--cin-red-soft)", borderColor: "var(--cin-red)", color: "var(--cin-red)" }}>
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <NamedCatalogSection
          heading="Setores de destino"
          inputLabel="Nome do setor"
          inputPlaceholder="Nome do setor"
          defaultCheckboxLabel="Usar como setor padrão nas movimentações"
          emptyText="Nenhum setor cadastrado."
          uncataloguedTitle="Setores usados em movimentações e ainda fora do catálogo"
          items={sectors}
          suggestionsList={suggestions.sectors}
          online={online}
          onCreate={onCreateSector}
          onEdit={setEditingSec}
          onError={setError}
          createErrorFallback="Erro ao cadastrar setor."
        />

        <NamedCatalogSection
          heading="Categorias de equipamentos"
          inputLabel="Nome da categoria"
          inputPlaceholder="Ex.: Notebook, Monitor, Projetor"
          defaultCheckboxLabel="Usar como categoria padrão em novos equipamentos"
          emptyText="Nenhuma categoria cadastrada."
          uncataloguedTitle="Categorias usadas em equipamentos e ainda fora do catálogo"
          items={categories}
          suggestionsList={suggestions.categories}
          online={online}
          onCreate={onCreateCategory}
          onEdit={setEditingCat}
          onError={setError}
          createErrorFallback="Erro ao cadastrar categoria."
        />
      </div>

      <section className="pt-4 border-t space-y-3" style={{ borderColor: "var(--border)" }} aria-labelledby="cad-locais">
        <h3 id="cad-locais" className="text-sm font-semibold">Locais de instalação</h3>
        <form onSubmit={handleAddLocation} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
          <div className="sm:col-span-6">
            <input aria-label="Nome do local" required value={newLocationName} onChange={(e) => setNewLocationName(e.target.value)} placeholder="Ex.: Sala 104, Auditório" className="tw-input" />
          </div>
          <div className="sm:col-span-4">
            <select aria-label="Setor do local" value={newLocationSectorId} onChange={(e) => setNewLocationSectorId(e.target.value)} className="tw-input">
              <option value="">Sem setor específico</option>
              {sectors.filter((s) => s.active === 1).map((s) => (
                <option key={s.id} value={s.id}>Setor: {s.name}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={!online} className="tw-btn tw-btn-primary w-full">
              <Plus className="w-4 h-4" aria-hidden="true" /> Adicionar
            </button>
          </div>
        </form>

        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
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

      <dialog ref={secDialogRef} aria-labelledby="edit-sec-title" className="m-auto w-[min(94vw,420px)] rounded-xl p-5 shadow-xl">
        {editingSec && (
          <form onSubmit={saveNamedCatalog("/api/catalogs/sectors", editingSec, () => setEditingSec(null), "Erro ao editar setor.")} className="space-y-3">
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

      <dialog ref={catDialogRef} aria-labelledby="edit-cat-title" className="m-auto w-[min(94vw,420px)] rounded-xl p-5 shadow-xl">
        {editingCat && (
          <form onSubmit={saveNamedCatalog("/api/catalogs/categories", editingCat, () => setEditingCat(null), "Erro ao editar categoria.")} className="space-y-3">
            <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: "var(--border)" }}>
              <h3 id="edit-cat-title" className="text-sm font-semibold">Editar categoria</h3>
              <button type="button" aria-label="Fechar" onClick={() => setEditingCat(null)} className="tw-btn tw-btn-sm"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label htmlFor="cat-name" className="tw-label">Nome</label>
              <input id="cat-name" required value={editingCat.name} onChange={(e) => setEditingCat({ ...editingCat, name: e.target.value })} className="tw-input" />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={editingCat.is_default === 1} onChange={(e) => setEditingCat({ ...editingCat, is_default: e.target.checked ? 1 : 0 })} />
              <span>Categoria padrão</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={editingCat.active === 1} onChange={(e) => setEditingCat({ ...editingCat, active: e.target.checked ? 1 : 0 })} />
              <span>Ativa</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="tw-btn" onClick={() => setEditingCat(null)}>Cancelar</button>
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
