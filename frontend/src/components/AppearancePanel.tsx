import { Check, Crop, Download, Image as ImageIcon, RotateCcw, Trash2, Upload } from "lucide-react";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { apiRequest, ApiError } from "../services/api";
import { THEME_PRESETS } from "../theme/appearance";
import type { PublicSettings } from "../types";
import { downloadDataUrl } from "../utils/imageEditor";
import { ImageEditorModal } from "./ImageEditorModal";
import { OnlineOnlyNotice } from "./OnlineOnlyNotice";

interface AppearancePanelProps {
  settings: PublicSettings;
  online: boolean;
  onPreviewChange: (draft: PublicSettings | null) => void;
  onSaved: (updated: PublicSettings) => void;
}

interface AppearanceDraft {
  theme_preset: string;
  brand_color: string;
  accent_color: string;
  bg_color: string;
  bg_image_data_url: string;
  bg_overlay_opacity: number;
}

function draftFromSettings(s: PublicSettings): AppearanceDraft {
  return {
    theme_preset: s.theme_preset || "cin",
    brand_color: s.brand_color || "#002d6b",
    accent_color: s.accent_color || "#c81018",
    bg_color: s.bg_color ?? "",
    bg_image_data_url: s.bg_image_data_url ?? "",
    bg_overlay_opacity: s.bg_overlay_opacity ?? 85
  };
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function AppearancePanel({ settings, online, onPreviewChange, onSaved }: AppearancePanelProps) {
  const [draft, setDraft] = useState<AppearanceDraft>(() => draftFromSettings(settings));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bgEditorSource, setBgEditorSource] = useState<File | string | null>(null);

  useEffect(() => {
    setDraft(draftFromSettings(settings));
  }, [settings]);

  useEffect(() => {
    return () => onPreviewChange(null);
  }, [onPreviewChange]);

  const updateDraft = (patch: Partial<AppearanceDraft>) => {
    setMessage(null);
    setError(null);
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      onPreviewChange({ ...settings, ...next });
      return next;
    });
  };

  const handleBgImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setMessage(null);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBgEditorSource(file);
  };

  const handleRestoreDefault = () => {
    const def = THEME_PRESETS[0];
    updateDraft({
      theme_preset: def.id,
      brand_color: def.brandColor,
      accent_color: def.accentColor,
      bg_color: def.bgColor,
      bg_image_data_url: "",
      bg_overlay_opacity: 85
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!HEX_RE.test(draft.brand_color) || !HEX_RE.test(draft.accent_color)) {
      setError("Informe cores válidas no formato hexadecimal (#RRGGBB).");
      return;
    }
    if (draft.bg_color && !HEX_RE.test(draft.bg_color)) {
      setError("A cor de fundo deve estar no formato #RRGGBB ou vazia.");
      return;
    }

    setSaving(true);
    try {
      const res = await apiRequest<{ settings: PublicSettings }>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(draft)
      });
      onPreviewChange(null);
      onSaved(res.settings);
      setMessage("Aparência salva para toda a organização.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erro ao salvar aparência.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      {!online && <OnlineOnlyNotice />}

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Paletas prontas</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {THEME_PRESETS.map((preset) => {
            const selected = draft.theme_preset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  updateDraft({
                    theme_preset: preset.id,
                    brand_color: preset.brandColor,
                    accent_color: preset.accentColor,
                    bg_color: preset.bgColor
                  })
                }
                className="p-3 rounded-xl border text-left space-y-2 cursor-pointer transition-colors"
                style={
                  selected
                    ? { backgroundColor: "var(--brand-soft)", borderColor: "var(--brand)" }
                    : { backgroundColor: "var(--bg)", borderColor: "var(--border)" }
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5" aria-hidden="true">
                    <span className="w-5 h-5 rounded-full border border-black/15" style={{ backgroundColor: preset.brandColor }} />
                    <span className="w-5 h-5 rounded-full border border-black/15" style={{ backgroundColor: preset.accentColor }} />
                    <span className="w-5 h-5 rounded-full border border-black/15" style={{ backgroundColor: preset.bgColor || "#f4f6fa" }} />
                  </div>
                  {selected && <Check className="w-4 h-4 shrink-0" style={{ color: "var(--brand)" }} aria-hidden="true" />}
                </div>
                <div className="text-xs font-semibold leading-snug">{preset.name}</div>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-3 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
        <legend className="text-sm font-semibold">Montar paleta própria</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="app-brand-color" className="tw-label">Cor principal</label>
            <div className="flex items-center gap-2">
              <input
                id="app-brand-color"
                type="color"
                value={HEX_RE.test(draft.brand_color) ? draft.brand_color : "#002d6b"}
                onChange={(e) => updateDraft({ theme_preset: "custom", brand_color: e.target.value })}
                className="h-11 w-12 rounded-lg border cursor-pointer shrink-0 p-1"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
              />
              <input
                type="text"
                aria-label="Código hexadecimal da cor principal"
                value={draft.brand_color}
                onChange={(e) => updateDraft({ theme_preset: "custom", brand_color: e.target.value })}
                placeholder="#002d6b"
                maxLength={7}
                className="tw-input font-mono text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="app-accent-color" className="tw-label">Cor de destaque / alerta</label>
            <div className="flex items-center gap-2">
              <input
                id="app-accent-color"
                type="color"
                value={HEX_RE.test(draft.accent_color) ? draft.accent_color : "#c81018"}
                onChange={(e) => updateDraft({ theme_preset: "custom", accent_color: e.target.value })}
                className="h-11 w-12 rounded-lg border cursor-pointer shrink-0 p-1"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
              />
              <input
                type="text"
                aria-label="Código hexadecimal da cor de destaque"
                value={draft.accent_color}
                onChange={(e) => updateDraft({ theme_preset: "custom", accent_color: e.target.value })}
                placeholder="#c81018"
                maxLength={7}
                className="tw-input font-mono text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="app-bg-color" className="tw-label">Cor de fundo (opcional)</label>
            <div className="flex items-center gap-2">
              <input
                id="app-bg-color"
                type="color"
                value={HEX_RE.test(draft.bg_color) ? draft.bg_color : "#f4f6fa"}
                onChange={(e) => updateDraft({ theme_preset: "custom", bg_color: e.target.value })}
                className="h-11 w-12 rounded-lg border cursor-pointer shrink-0 p-1"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
              />
              <input
                type="text"
                aria-label="Código hexadecimal da cor de fundo"
                value={draft.bg_color}
                onChange={(e) => updateDraft({ theme_preset: "custom", bg_color: e.target.value })}
                placeholder="Padrão neutro"
                maxLength={7}
                className="tw-input font-mono text-sm"
              />
            </div>
            {draft.bg_color && (
              <button
                type="button"
                onClick={() => updateDraft({ theme_preset: "custom", bg_color: "" })}
                className="text-xs underline mt-1 cursor-pointer"
                style={{ color: "var(--text-muted)" }}
              >
                Usar fundo neutro padrão
              </button>
            )}
          </div>
        </div>
      </fieldset>

      <section className="space-y-3 pt-4 border-t" style={{ borderColor: "var(--border)" }} aria-labelledby="bg-image-title">
        <div>
          <h3 id="bg-image-title" className="text-sm font-semibold">Imagem de fundo da empresa</h3>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Exibida atrás dos cartões em todo o sistema. Aceita qualquer imagem compatível, abre o editor de recorte e converte para WebP leve. Não aparece nas impressões em PDF.
          </p>
        </div>

        <div className="p-4 rounded-xl border space-y-4" style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}>
          <div className="flex flex-wrap items-center gap-2.5">
            {draft.bg_image_data_url ? (
              <img
                src={draft.bg_image_data_url}
                alt="Prévia do fundo"
                className="h-14 w-24 object-cover rounded-lg border"
                style={{ borderColor: "var(--border)" }}
              />
            ) : (
              <div
                className="h-14 w-24 rounded-lg border flex items-center justify-center"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-alt)", color: "var(--text-muted)" }}
              >
                <ImageIcon className="w-5 h-5" aria-hidden="true" />
              </div>
            )}

            <label
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 rounded-lg text-xs font-medium border cursor-pointer"
              style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Enviar e recortar</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleBgImageChange}
                className="sr-only"
              />
            </label>

            {draft.bg_image_data_url && (
              <>
                <button
                  type="button"
                  onClick={() => setBgEditorSource(draft.bg_image_data_url)}
                  className="tw-btn"
                >
                  <Crop className="w-3.5 h-3.5" aria-hidden="true" />
                  Editar / recortar
                </button>
                <button
                  type="button"
                  onClick={() => downloadDataUrl(draft.bg_image_data_url, "fundo-sistema")}
                  className="tw-btn"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  Baixar
                </button>
                <button
                  type="button"
                  onClick={() => updateDraft({ bg_image_data_url: "" })}
                  className="tw-btn tw-btn-danger"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Remover
                </button>
              </>
            )}
          </div>

          {draft.bg_image_data_url && (
            <div className="max-w-sm space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="bg-overlay-range" className="font-semibold">
                  Película de leitura sobre a imagem
                </label>
                <span className="font-mono" style={{ color: "var(--text-muted)" }}>
                  {draft.bg_overlay_opacity}%
                </span>
              </div>
              <input
                id="bg-overlay-range"
                type="range"
                min={0}
                max={95}
                step={5}
                value={draft.bg_overlay_opacity}
                onChange={(e) => updateDraft({ bg_overlay_opacity: Number(e.target.value) })}
                className="w-full cursor-pointer"
              />
            </div>
          )}
        </div>
      </section>

      {error && (
        <div role="alert" className="px-3 py-2 rounded-lg text-sm border" style={{ backgroundColor: "var(--cin-red-soft)", borderColor: "var(--cin-red)", color: "var(--cin-red)" }}>
          {error}
        </div>
      )}

      {message && (
        <div role="status" className="px-3 py-2 rounded-lg text-sm border" style={{ backgroundColor: "var(--ok-soft)", borderColor: "var(--ok)", color: "var(--ok)" }}>
          {message}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <button type="submit" disabled={!online || saving} className="tw-btn tw-btn-primary">
          {saving ? "Salvando..." : "Salvar aparência"}
        </button>
        <button type="button" onClick={handleRestoreDefault} className="tw-btn">
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
          Restaurar padrão
        </button>
      </div>
    </form>

    <ImageEditorModal
      source={bgEditorSource}
      mode="background"
      maxDimension={1600}
      maxDataUrlLength={2_000_000}
      defaultFilename="fundo-sistema"
      onCancel={() => setBgEditorSource(null)}
      onApply={(dataUrl) => {
        updateDraft({ bg_image_data_url: dataUrl });
        setBgEditorSource(null);
      }}
    />
    </>
  );
}
