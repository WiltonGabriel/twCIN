export type ImageOutputFormat = "image/webp" | "image/png" | "image/jpeg";
export type ImageRotation = 0 | 90 | 180 | 270;
export type CropCorner = "nw" | "ne" | "sw" | "se";

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AspectPreset {
  id: string;
  label: string;
  ratio: number | null;
}

export interface DecodedImageSource {
  img: HTMLImageElement;
  url: string;
  width: number;
  height: number;
  originalFormat: string;
  wasNonStandardFormat: boolean;
  revoke: () => void;
}

export interface RenderedImageResult {
  dataUrl: string;
  width: number;
  height: number;
  usedFormat: ImageOutputFormat;
  bytes: number;
}

const VALID_BACKEND_FORMATS = new Set(["image/png", "image/jpeg", "image/webp"]);

export function getRotatedDimensions(width: number, height: number, rotation: ImageRotation): { rotW: number; rotH: number } {
  return rotation === 90 || rotation === 270 ? { rotW: height, rotH: width } : { rotW: width, rotH: height };
}

export function clampCrop(rect: CropRect, minSize = 0.08): CropRect {
  const w = Math.max(minSize, Math.min(1, rect.w));
  const h = Math.max(minSize, Math.min(1, rect.h));
  const x = Math.max(0, Math.min(1 - w, rect.x));
  const y = Math.max(0, Math.min(1 - h, rect.y));
  return { x, y, w, h };
}

/** Calcula o maior recorte centralizado que respeita a proporção alvo no espaço [0..1]. */
export function fitAspectCrop(rotW: number, rotH: number, ratio: number | null): CropRect {
  if (!ratio || rotW <= 0 || rotH <= 0) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  const imgAspect = rotW / rotH;
  const normRatio = ratio / imgAspect;
  if (normRatio >= 1) {
    const w = 1;
    const h = 1 / normRatio;
    return clampCrop({ x: 0, y: (1 - h) / 2, w, h });
  }
  const h = 1;
  const w = normRatio;
  return clampCrop({ x: (1 - w) / 2, y: 0, w, h });
}

/** Redimensiona o retângulo de recorte arrastando um canto, ancorado no canto oposto. */
export function resizeCropByCorner(
  start: CropRect,
  corner: CropCorner,
  dx: number,
  dy: number,
  rotW: number,
  rotH: number,
  ratio: number | null,
  minSize = 0.08
): CropRect {
  const movingRight = corner === "se" || corner === "ne";
  const movingDown = corner === "se" || corner === "sw";

  const anchorX = movingRight ? start.x : start.x + start.w;
  const anchorY = movingDown ? start.y : start.y + start.h;

  const maxW = movingRight ? 1 - anchorX : anchorX;
  const maxH = movingDown ? 1 - anchorY : anchorY;

  let w = Math.max(minSize, Math.min(maxW, movingRight ? start.w + dx : start.w - dx));
  let h = Math.max(minSize, Math.min(maxH, movingDown ? start.h + dy : start.h - dy));

  if (ratio && rotW > 0 && rotH > 0) {
    const normRatio = ratio * (rotH / rotW);
    h = w / normRatio;
    if (h > maxH) {
      h = maxH;
      w = h * normRatio;
    }
    if (h < minSize) {
      h = Math.min(maxH, minSize);
      w = Math.min(maxW, h * normRatio);
    }
    if (w > maxW) {
      w = maxW;
      h = w / normRatio;
    }
  }

  const x = movingRight ? anchorX : anchorX - w;
  const y = movingDown ? anchorY : anchorY - h;
  return clampCrop({ x, y, w, h }, Math.min(minSize, w, h));
}

export function getOutputDimensions(
  rotW: number,
  rotH: number,
  crop: CropRect,
  maxDimension: number
): { srcX: number; srcY: number; srcW: number; srcH: number; width: number; height: number } {
  const safe = clampCrop(crop, 0.01);
  const srcX = Math.max(0, Math.round(safe.x * rotW));
  const srcY = Math.max(0, Math.round(safe.y * rotH));
  const srcW = Math.max(1, Math.min(rotW - srcX, Math.round(safe.w * rotW)));
  const srcH = Math.max(1, Math.min(rotH - srcY, Math.round(safe.h * rotH)));
  const scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
  return {
    srcX,
    srcY,
    srcW,
    srcH,
    width: Math.max(1, Math.round(srcW * scale)),
    height: Math.max(1, Math.round(srcH * scale))
  };
}

export function dataUrlExtension(dataUrl: string): "webp" | "png" | "jpg" {
  const mime = dataUrl.match(/^data:(image\/[a-z+.-]+);/i)?.[1]?.toLowerCase() ?? "";
  if (mime === "image/webp") return "webp";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  return "png";
}

export function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

export function formatBytesCompact(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2).replace(".", ",")} MB`;
}

/** Carrega File (qualquer formato decodificável pelo navegador) ou Data URL existente para edição. */
export async function decodeImageSource(source: File | string, maxRawBytes = 15 * 1024 * 1024): Promise<DecodedImageSource> {
  let url = "";
  let revoke = () => {};
  let originalFormat = "image/png";

  if (typeof source === "string") {
    url = source;
    originalFormat = source.match(/^data:(image\/[a-z+.-]+);/i)?.[1]?.toLowerCase() ?? "image/png";
  } else {
    if (source.size > maxRawBytes) {
      const mb = Math.round(maxRawBytes / (1024 * 1024));
      throw new Error(`O arquivo selecionado excede ${mb} MB.`);
    }
    if (source.type && !source.type.startsWith("image/")) {
      throw new Error("Selecione um arquivo de imagem válido.");
    }
    url = URL.createObjectURL(source);
    revoke = () => URL.revokeObjectURL(url);
    originalFormat = (source.type || "").toLowerCase() || source.name.split(".").pop()?.toUpperCase() || "desconhecido";
  }

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(new Error("Não foi possível decodificar esta imagem neste navegador. Tente PNG, JPEG, WebP, GIF, BMP, AVIF ou SVG."));
      el.src = url;
    });
    const width = Math.max(1, img.naturalWidth || img.width || 512);
    const height = Math.max(1, img.naturalHeight || img.height || 512);
    return {
      img,
      url,
      width,
      height,
      originalFormat,
      wasNonStandardFormat: typeof source !== "string" && !VALID_BACKEND_FORMATS.has(originalFormat),
      revoke
    };
  } catch (err) {
    revoke();
    throw err;
  }
}

export function drawRotatedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  srcWidth: number,
  srcHeight: number,
  rotation: ImageRotation,
  destWidth: number,
  destHeight: number
): void {
  ctx.save();
  ctx.clearRect(0, 0, destWidth, destHeight);
  ctx.translate(destWidth / 2, destHeight / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  const scaleX = rotation === 90 || rotation === 270 ? destHeight / srcWidth : destWidth / srcWidth;
  const scaleY = rotation === 90 || rotation === 270 ? destWidth / srcHeight : destHeight / srcHeight;
  ctx.scale(scaleX, scaleY);
  ctx.drawImage(img, -srcWidth / 2, -srcHeight / 2, srcWidth, srcHeight);
  ctx.restore();
}

export function renderCroppedDataUrl(
  decoded: DecodedImageSource,
  options: {
    rotation: ImageRotation;
    crop: CropRect;
    maxDimension: number;
    format: ImageOutputFormat;
    quality: number;
  }
): RenderedImageResult {
  const { rotW, rotH } = getRotatedDimensions(decoded.width, decoded.height, options.rotation);
  const { srcX, srcY, srcW, srcH, width, height } = getOutputDimensions(rotW, rotH, options.crop, options.maxDimension);

  const rotatedCanvas = document.createElement("canvas");
  rotatedCanvas.width = rotW;
  rotatedCanvas.height = rotH;
  const rotCtx = rotatedCanvas.getContext("2d");
  if (!rotCtx) {
    throw new Error("Contexto de canvas indisponível neste navegador.");
  }
  drawRotatedImage(rotCtx, decoded.img, decoded.width, decoded.height, options.rotation, rotW, rotH);

  const outCanvas = document.createElement("canvas");
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) {
    throw new Error("Contexto de canvas indisponível neste navegador.");
  }

  // Fundo branco em JPEG para que áreas transparentes não fiquem pretas.
  if (options.format === "image/jpeg") {
    outCtx.fillStyle = "#ffffff";
    outCtx.fillRect(0, 0, width, height);
  }
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = "high";
  outCtx.drawImage(rotatedCanvas, srcX, srcY, srcW, srcH, 0, 0, width, height);

  let usedFormat: ImageOutputFormat = options.format;
  let dataUrl = outCanvas.toDataURL(options.format, options.quality);

  // Fallback para JPEG caso o navegador não suporte codificação WebP no canvas.
  if (options.format === "image/webp" && !dataUrl.startsWith("data:image/webp")) {
    usedFormat = "image/jpeg";
    const jpegCanvas = document.createElement("canvas");
    jpegCanvas.width = width;
    jpegCanvas.height = height;
    const jCtx = jpegCanvas.getContext("2d");
    if (jCtx) {
      jCtx.fillStyle = "#ffffff";
      jCtx.fillRect(0, 0, width, height);
      jCtx.drawImage(outCanvas, 0, 0);
      dataUrl = jpegCanvas.toDataURL("image/jpeg", options.quality);
    }
  }

  return {
    dataUrl,
    width,
    height,
    usedFormat,
    bytes: estimateDataUrlBytes(dataUrl)
  };
}

/** Dispara o download local de um Data URL já convertido e recortado. */
export function downloadDataUrl(dataUrl: string, baseFilename: string): void {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return;
  const mime = dataUrl.match(/^data:(image\/[a-z+.-]+);/i)?.[1] ?? "image/webp";
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseFilename}.${dataUrlExtension(dataUrl)}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
