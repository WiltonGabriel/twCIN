import type { PublicSettings } from "../types";

export interface ThemePalettePreset {
  id: string;
  name: string;
  brandColor: string;
  accentColor: string;
  bgColor: string;
}

export const THEME_PRESETS: ThemePalettePreset[] = [
  { id: "cin", name: "Institucional (Azul & Vermelho)", brandColor: "#002d6b", accentColor: "#c81018", bgColor: "" },
  { id: "oceano", name: "Oceano (Cobalto & Ciano)", brandColor: "#0f4c81", accentColor: "#0284c7", bgColor: "#f0f7ff" },
  { id: "esmeralda", name: "Esmeralda (Verde & Petróleo)", brandColor: "#047857", accentColor: "#0f766e", bgColor: "#f0fdf7" },
  { id: "indigo", name: "Índigo (Roxo & Magenta)", brandColor: "#4338ca", accentColor: "#db2777", bgColor: "#f5f3ff" },
  { id: "grafite", name: "Grafite (Corporativo & Âmbar)", brandColor: "#1e293b", accentColor: "#d97706", bgColor: "#f8fafc" },
  { id: "vinho", name: "Bordô (Vinho & Terracota)", brandColor: "#881337", accentColor: "#b45309", bgColor: "#fff5f7" }
];

function parseHex(hex: string | undefined, fallback: string): [number, number, number] {
  const clean = /^#[0-9a-fA-F]{6}$/.test(hex || "") ? (hex as string) : fallback;
  return [
    parseInt(clean.slice(1, 3), 16),
    parseInt(clean.slice(3, 5), 16),
    parseInt(clean.slice(5, 7), 16)
  ];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

function mixRgb(a: [number, number, number], b: [number, number, number], weightB: number): [number, number, number] {
  const w = Math.max(0, Math.min(1, weightB));
  return [
    a[0] * (1 - w) + b[0] * w,
    a[1] * (1 - w) + b[1] * w,
    a[2] * (1 - w) + b[2] * w
  ];
}

/** Luminância relativa WCAG (CIE XYZ D65 Y). */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Retorna cor de texto legível (#ffffff ou #0f172a) para um fundo sólido. */
export function readableForeground(hex: string): string {
  return relativeLuminance(parseHex(hex, "#002d6b")) > 0.17913 ? "#0f172a" : "#ffffff";
}

function rgba([r, g, b]: [number, number, number], alpha: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/** Ajusta `bg_color` para preservar legibilidade de texto tanto no tema claro quanto no escuro. */
export function resolveBgHex(bgColor: string | null | undefined, isDark: boolean): string | null {
  if (!bgColor || !/^#[0-9a-fA-F]{6}$/.test(bgColor)) {
    return null;
  }
  const chosenBg = parseHex(bgColor, "#f4f6fa");
  if (isDark) {
    return toHex(mixRgb([9, 14, 26], chosenBg, 0.16));
  }
  // Em tema claro, cores escuras são suavizadas com branco para garantir contraste do texto escuro (--text).
  const adjusted = relativeLuminance(chosenBg) < 0.55 ? mixRgb([255, 255, 255], chosenBg, 0.24) : chosenBg;
  return toHex(adjusted);
}

export function applyOrganizationAppearance(settings: PublicSettings, resolvedTheme: "light" | "dark"): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  const baseBrand = parseHex(settings.brand_color, "#002d6b");
  const baseAccent = parseHex(settings.accent_color, "#c81018");
  const isDark = resolvedTheme === "dark";

  // No modo escuro, cores muito escuras são suavemente clareadas para manter contraste > 4.5:1.
  const effectiveBrand =
    isDark && relativeLuminance(baseBrand) < 0.18 ? mixRgb(baseBrand, [255, 255, 255], 0.44) : baseBrand;
  const effectiveAccent =
    isDark && relativeLuminance(baseAccent) < 0.18 ? mixRgb(baseAccent, [255, 255, 255], 0.44) : baseAccent;
  const hoverBrand = isDark
    ? mixRgb(effectiveBrand, [255, 255, 255], 0.18)
    : mixRgb(effectiveBrand, [0, 0, 0], 0.16);

  const brandHex = toHex(effectiveBrand);
  root.style.setProperty("--brand", brandHex);
  root.style.setProperty("--brand-hover", toHex(hoverBrand));
  root.style.setProperty("--brand-fg", readableForeground(brandHex));
  root.style.setProperty("--brand-soft", rgba(effectiveBrand, isDark ? 0.18 : 0.11));

  root.style.setProperty("--cin-red", toHex(effectiveAccent));
  root.style.setProperty("--cin-red-soft", rgba(effectiveAccent, isDark ? 0.18 : 0.1));

  const resolvedBgHex = resolveBgHex(settings.bg_color, isDark);
  let effectiveBgRgb: [number, number, number] = isDark ? [9, 14, 26] : [244, 246, 250];
  if (resolvedBgHex) {
    effectiveBgRgb = parseHex(resolvedBgHex, isDark ? "#090e1a" : "#f4f6fa");
    root.style.setProperty("--bg", resolvedBgHex);
    root.style.setProperty(
      "--surface-alt",
      toHex(isDark ? mixRgb(effectiveBgRgb, [255, 255, 255], 0.08) : mixRgb(effectiveBgRgb, [15, 23, 42], 0.05))
    );
  } else {
    root.style.removeProperty("--bg");
    root.style.removeProperty("--surface-alt");
  }

  if (settings.bg_image_data_url) {
    const overlayAlpha = Math.max(0, Math.min(95, settings.bg_overlay_opacity ?? 85)) / 100;
    const tint = rgba(effectiveBgRgb, overlayAlpha);
    root.style.setProperty("--app-bg-layer", `linear-gradient(${tint}, ${tint}), url("${settings.bg_image_data_url}")`);
  } else {
    root.style.removeProperty("--app-bg-layer");
  }

  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", isDark ? "#090e1a" : toHex(baseBrand));
  }

  // Atualiza o favicon da guia do navegador com o logotipo personalizado (ou restaura o ícone padrão).
  const iconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (iconLink) {
    if (settings.logo_data_url) {
      iconLink.type = settings.logo_data_url.match(/^data:(image\/[a-z+.-]+);/i)?.[1] ?? "image/png";
      iconLink.href = settings.logo_data_url;
    } else {
      iconLink.type = "image/png";
      iconLink.href = "/icons/icon-192.png";
    }
  }
}
