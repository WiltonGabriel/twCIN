import { Check, Crop, Download, RotateCcw, RotateCw, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  clampCrop,
  decodeImageSource,
  downloadDataUrl,
  drawRotatedImage,
  fitAspectCrop,
  formatBytesCompact,
  getRotatedDimensions,
  renderCroppedDataUrl,
  resizeCropByCorner,
  type AspectPreset,
  type CropCorner,
  type CropRect,
  type DecodedImageSource,
  type ImageOutputFormat,
  type ImageRotation,
  type RenderedImageResult
} from "../utils/imageEditor";

export type ImageEditorMode = "logo" | "background";

interface ImageEditorModalProps {
  source: File | string | null;
  mode: ImageEditorMode;
  maxDimension: number;
  maxDataUrlLength: number;
  defaultFilename: string;
  onCancel: () => void;
  onApply: (dataUrl: string) => void;
}

const LOGO_PRESETS: AspectPreset[] = [
  { id: "free", label: "Livre", ratio: null },
  { id: "square", label: "1:1 (Ícone / Favicon)", ratio: 1 },
  { id: "wide", label: "16:9 (Horizontal)", ratio: 16 / 9 },
  { id: "banner", label: "3:1 (Faixa)", ratio: 3 }
];

const BG_PRESETS: AspectPreset[] = [
  { id: "16:9", label: "16:9 (Tela)", ratio: 16 / 9 },
  { id: "16:10", label: "16:10", ratio: 16 / 10 },
  { id: "21:9", label: "21:9 (Ultrawide)", ratio: 21 / 9 },
  { id: "free", label: "Livre", ratio: null }
];

const FORMAT_LABELS: Record<ImageOutputFormat, string> = {
  "image/webp": "WebP",
  "image/png": "PNG",
  "image/jpeg": "JPEG"
};

type DragState =
  | {
      kind: "move";
      startX: number;
      startY: number;
      startCrop: CropRect;
    }
  | {
      kind: "corner";
      corner: CropCorner;
      startX: number;
      startY: number;
      startCrop: CropRect;
    };

export function ImageEditorModal({
  source,
  mode,
  maxDimension,
  maxDataUrlLength,
  defaultFilename,
  onCancel,
  onApply
}: ImageEditorModalProps) {
  const titleId = useId();
  const qualityId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stageCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const presets = mode === "logo" ? LOGO_PRESETS : BG_PRESETS;
  const defaultPreset = presets[0];

  const [decoded, setDecoded] = useState<DecodedImageSource | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rotation, setRotation] = useState<ImageRotation>(0);
  const [presetId, setPresetId] = useState<string>(defaultPreset.id);
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: 1, h: 1 });
  const [format, setFormat] = useState<ImageOutputFormat>("image/webp");
  const [qualityPct, setQualityPct] = useState<number>(mode === "logo" ? 86 : 82);
  const [rendered, setRendered] = useState<RenderedImageResult | null>(null);

  const activePreset = useMemo(
    () => presets.find((p) => p.id === presetId) ?? defaultPreset,
    [presets, defaultPreset, presetId]
  );

  // Controla abertura/fechamento do <dialog> nativo seguindo a API top-layer.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (source && !dialog.open) {
      dialog.returnValue = "";
      dialog.showModal();
    } else if (!source && dialog.open) {
      dialog.close();
    }
  }, [source]);

  // Decodifica a imagem enviada (File de qualquer formato aceito pelo navegador ou Data URL existente).
  useEffect(() => {
    if (!source) {
      setDecoded((prev) => {
        prev?.revoke();
        return null;
      });
      setRendered(null);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setLoadError(null);
    setRendered(null);
    const initialPreset = mode === "logo" ? LOGO_PRESETS[0] : BG_PRESETS[0];
    setPresetId(initialPreset.id);
    setRotation(0);
    setFormat("image/webp");
    setQualityPct(mode === "logo" ? 86 : 82);

    void decodeImageSource(source)
      .then((res) => {
        if (cancelled) {
          res.revoke();
          return;
        }
        setDecoded((prev) => {
          prev?.revoke();
          return res;
        });
        setCrop(fitAspectCrop(res.width, res.height, initialPreset.ratio));
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Não foi possível abrir esta imagem.");
      });

    return () => {
      cancelled = true;
    };
  }, [source, mode]);

  const { rotW, rotH } = useMemo(
    () => (decoded ? getRotatedDimensions(decoded.width, decoded.height, rotation) : { rotW: 1, rotH: 1 }),
    [decoded, rotation]
  );

  // Desenha a prévia rotacionada no <canvas> de edição (WYSIWYG).
  useEffect(() => {
    const canvas = stageCanvasRef.current;
    if (!canvas || !decoded) return;
    const scale = Math.min(1, 1100 / Math.max(rotW, rotH));
    canvas.width = Math.max(1, Math.round(rotW * scale));
    canvas.height = Math.max(1, Math.round(rotH * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawRotatedImage(ctx, decoded.img, decoded.width, decoded.height, rotation, canvas.width, canvas.height);
  }, [decoded, rotation, rotW, rotH]);

  // Calcula saída convertida/comprimida com leve debounce durante arraste.
  useEffect(() => {
    if (!decoded) return;
    const timer = window.setTimeout(() => {
      try {
        const res = renderCroppedDataUrl(decoded, {
          rotation,
          crop,
          maxDimension,
          format,
          quality: qualityPct / 100
        });
        setRendered(res);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Falha ao processar a imagem.");
      }
    }, 60);
    return () => window.clearTimeout(timer);
  }, [decoded, rotation, crop, maxDimension, format, qualityPct]);

  const handleSelectPreset = (preset: AspectPreset) => {
    setPresetId(preset.id);
    if (decoded) {
      setCrop(fitAspectCrop(rotW, rotH, preset.ratio));
    }
  };

  const handleRotate = () => {
    if (!decoded) return;
    const nextRot = (((rotation + 90) % 360) as ImageRotation);
    const nextDims = getRotatedDimensions(decoded.width, decoded.height, nextRot);
    setRotation(nextRot);
    setCrop(fitAspectCrop(nextDims.rotW, nextDims.rotH, activePreset.ratio));
  };

  const handleResetCrop = () => {
    if (!decoded) return;
    setRotation(0);
    setCrop(fitAspectCrop(decoded.width, decoded.height, activePreset.ratio));
  };

  const startMove = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { kind: "move", startX: e.clientX, startY: e.clientY, startCrop: crop };
  };

  const startCorner = (corner: CropCorner, e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { kind: "corner", corner, startX: e.clientX, startY: e.clientY, startCrop: crop };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;

    if (drag.kind === "move") {
      setCrop(
        clampCrop({
          ...drag.startCrop,
          x: drag.startCrop.x + dx,
          y: drag.startCrop.y + dy
        })
      );
      return;
    }

    setCrop(
      resizeCropByCorner(drag.startCrop, drag.corner, dx, dy, rotW, rotH, activePreset.ratio)
    );
  };

  const stopDrag = () => {
    dragRef.current = null;
  };

  const handleCropKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.06 : 0.02;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setCrop((c) => clampCrop({ ...c, x: c.x - step }));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setCrop((c) => clampCrop({ ...c, x: c.x + step }));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCrop((c) => clampCrop({ ...c, y: c.y - step }));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCrop((c) => clampCrop({ ...c, y: c.y + step }));
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      setCrop((c) => resizeCropByCorner(c, "se", -step, -step, rotW, rotH, activePreset.ratio));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      setCrop((c) => resizeCropByCorner(c, "se", step, step, rotW, rotH, activePreset.ratio));
    }
  };

  const computeImmediate = (): RenderedImageResult | null => {
    if (!decoded) return null;
    const res = renderCroppedDataUrl(decoded, {
      rotation,
      crop,
      maxDimension,
      format,
      quality: qualityPct / 100
    });
    setRendered(res);
    return res;
  };

  const handleDownload = () => {
    const res = rendered ?? computeImmediate();
    if (!res) return;
    downloadDataUrl(res.dataUrl, defaultFilename);
  };

  const handleConfirm = () => {
    const res = computeImmediate();
    if (!res || res.dataUrl.length > maxDataUrlLength) return;
    onApply(res.dataUrl);
  };

  const overServerLimit = Boolean(rendered && rendered.dataUrl.length > maxDataUrlLength);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClose={() => {
        if (dialogRef.current) dialogRef.current.returnValue = "";
      }}
      className="m-auto w-[min(96vw,780px)] max-h-[92vh] rounded-xl p-0 overflow-auto shadow-xl"
    >
      <div className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2 flex-wrap">
            <Crop className="w-4 h-4 shrink-0" style={{ color: "var(--brand)" }} aria-hidden="true" />
            <h2 id={titleId} className="text-base font-semibold">
              {mode === "logo" ? "Editar e recortar logotipo" : "Editar e recortar imagem de fundo"}
            </h2>
            {decoded?.wasNonStandardFormat && (
              <span
                className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand)" }}
              >
                Convertido ({decoded.originalFormat} → WebP)
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fechar editor"
            className="p-1.5 rounded-lg cursor-pointer hover:opacity-80"
            style={{ color: "var(--text-muted)" }}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {loadError && (
          <div
            role="alert"
            className="px-3 py-2.5 rounded-lg text-sm border"
            style={{ backgroundColor: "var(--cin-red-soft)", borderColor: "var(--cin-red)", color: "var(--cin-red)" }}
          >
            {loadError}
          </div>
        )}

        {decoded && !loadError && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Proporção do recorte">
                {presets.map((preset, index) => {
                  const active = preset.id === activePreset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      autoFocus={index === 0}
                      onClick={() => handleSelectPreset(preset)}
                      aria-pressed={active}
                      className="min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-medium border cursor-pointer"
                      style={{
                        backgroundColor: active ? "var(--brand)" : "var(--surface)",
                        borderColor: active ? "var(--brand)" : "var(--border)",
                        color: active ? "var(--brand-fg)" : "var(--text)"
                      }}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5">
                <button type="button" onClick={handleRotate} className="tw-btn tw-btn-sm">
                  <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
                  Girar 90°
                </button>
                <button type="button" onClick={handleResetCrop} className="tw-btn tw-btn-sm">
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  Redefinir
                </button>
              </div>
            </div>

            <div
              className="p-3 sm:p-4 rounded-xl border flex justify-center items-center"
              style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}
            >
              <div
                ref={stageRef}
                className="relative select-none overflow-hidden rounded-lg border"
                style={{
                  width: `min(100%, calc(44vh * ${rotW / rotH}))`,
                  aspectRatio: `${rotW} / ${rotH}`,
                  borderColor: "var(--border)",
                  backgroundImage:
                    "repeating-conic-gradient(rgba(148,163,184,0.22) 0% 25%, transparent 0% 50%)",
                  backgroundSize: "16px 16px"
                }}
              >
                <canvas ref={stageCanvasRef} className="w-full h-full block" />

                <div
                  role="application"
                  tabIndex={0}
                  aria-label="Área de recorte. Arraste para mover, use os cantos para redimensionar ou use as setas do teclado."
                  onPointerDown={startMove}
                  onPointerMove={handlePointerMove}
                  onPointerUp={stopDrag}
                  onPointerCancel={stopDrag}
                  onKeyDown={handleCropKeyDown}
                  className="absolute cursor-move touch-none focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{
                    left: `${crop.x * 100}%`,
                    top: `${crop.y * 100}%`,
                    width: `${crop.w * 100}%`,
                    height: `${crop.h * 100}%`,
                    boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.56)",
                    border: "2px solid #ffffff"
                  }}
                >
                  {/* Guias de regra dos terços para facilitar enquadramento */}
                  <span className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/35" />
                  <span className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/35" />
                  <span className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/35" />
                  <span className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/35" />

                  {(
                    [
                      { corner: "nw", pos: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize" },
                      { corner: "ne", pos: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize" },
                      { corner: "sw", pos: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize" },
                      { corner: "se", pos: "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize" }
                    ] as const
                  ).map(({ corner, pos }) => (
                    <button
                      key={corner}
                      type="button"
                      tabIndex={-1}
                      aria-label={`Redimensionar canto ${corner.toUpperCase()}`}
                      onPointerDown={(e) => startCorner(corner, e)}
                      onPointerMove={handlePointerMove}
                      onPointerUp={stopDrag}
                      onPointerCancel={stopDrag}
                      className={`absolute ${pos} w-7 h-7 flex items-center justify-center touch-none`}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full border-2 border-white shadow"
                        style={{ backgroundColor: "var(--brand)" }}
                      />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div
              className="p-3 rounded-xl border grid grid-cols-1 sm:grid-cols-2 gap-4 items-center"
              style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}
            >
              <div className="space-y-1.5">
                <span className="tw-label">Formato de saída</span>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Formato de saída">
                  {(["image/webp", "image/png", "image/jpeg"] as const).map((fmt) => {
                    const active = format === fmt;
                    return (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => setFormat(fmt)}
                        aria-pressed={active}
                        className="min-h-[36px] px-3 py-1 rounded-lg text-xs font-medium border cursor-pointer"
                        style={{
                          backgroundColor: active ? "var(--brand)" : "var(--surface)",
                          borderColor: active ? "var(--brand)" : "var(--border)",
                          color: active ? "var(--brand-fg)" : "var(--text)"
                        }}
                      >
                        {fmt === "image/webp" ? "WebP (recomendado)" : FORMAT_LABELS[fmt]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                {format !== "image/png" ? (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <label htmlFor={qualityId} className="font-semibold">
                        Compressão / qualidade
                      </label>
                      <span className="font-mono" style={{ color: "var(--text-muted)" }}>
                        {qualityPct}%
                      </span>
                    </div>
                    <input
                      id={qualityId}
                      type="range"
                      min={50}
                      max={95}
                      step={5}
                      value={qualityPct}
                      onChange={(e) => setQualityPct(Number(e.target.value))}
                      className="w-full cursor-pointer"
                    />
                  </>
                ) : (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    PNG preserva transparência sem perdas, porém gera arquivos maiores que WebP.
                  </p>
                )}

                {rendered && (
                  <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                    Resultado: {rendered.width} × {rendered.height} px · {FORMAT_LABELS[rendered.usedFormat]} ·{" "}
                    {formatBytesCompact(rendered.bytes)}
                  </p>
                )}
              </div>
            </div>

            {overServerLimit && (
              <div
                role="alert"
                className="px-3 py-2 rounded-lg text-xs border flex flex-wrap items-center justify-between gap-2"
                style={{ backgroundColor: "var(--cin-red-soft)", borderColor: "var(--cin-red)", color: "var(--cin-red)" }}
              >
                <span>
                  O arquivo gerado excede o limite de envio do sistema. Use WebP, diminua a qualidade ou recorte uma área menor.
                </span>
                {format !== "image/webp" && (
                  <button
                    type="button"
                    onClick={() => setFormat("image/webp")}
                    className="tw-btn tw-btn-sm"
                  >
                    Converter para WebP
                  </button>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
          <div>
            {decoded && !loadError && (
              <button type="button" onClick={handleDownload} className="tw-btn">
                <Download className="w-4 h-4" aria-hidden="true" />
                Baixar {FORMAT_LABELS[rendered?.usedFormat ?? format]}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" autoFocus={Boolean(loadError)} onClick={onCancel} className="tw-btn">
              Cancelar
            </button>
            <button
              type="button"
              disabled={!decoded || Boolean(loadError) || overServerLimit}
              onClick={handleConfirm}
              className="tw-btn tw-btn-primary"
            >
              <Check className="w-4 h-4" aria-hidden="true" />
              Aplicar imagem
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
