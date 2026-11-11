import type { DatabaseSync } from "node:sqlite";
import { withTransaction } from "../db/connection.js";
import { writeAuditLog } from "../security/audit.js";
import type { AuthUser } from "../security/auth.js";

export interface PublicSettings {
  app_name: string;
  org_name: string;
  org_subtitle: string;
  org_document: string;
  org_contact: string;
  loan_term_footer: string;
  logo_data_url: string;
  /** Prazo padrão de devolução dos empréstimos, em dias. 0 = sem prazo. */
  loan_default_days: number;
  theme_preset: string;
  brand_color: string;
  accent_color: string;
  bg_color: string;
  bg_image_data_url: string;
  bg_overlay_opacity: number;
}

export const DEFAULT_LOAN_DAYS = 7;
export const DEFAULT_BG_OVERLAY = 85;

function parseBoundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function getPublicSettings(db: DatabaseSync): PublicSettings {
  const rows = db.prepare("SELECT key, value FROM app_settings").all() as Array<{
    key: string;
    value: string;
  }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    app_name: map.get("app_name") || "twCIN",
    org_name: map.get("org_name") || "Setor de TI",
    org_subtitle: map.get("org_subtitle") ?? "",
    org_document: map.get("org_document") ?? "",
    org_contact: map.get("org_contact") ?? "",
    loan_term_footer: map.get("loan_term_footer") ?? "",
    logo_data_url: map.get("logo_data_url") || "",
    loan_default_days: parseBoundedInt(map.get("loan_default_days"), DEFAULT_LOAN_DAYS, 0, 365),
    theme_preset: map.get("theme_preset") || "cin",
    brand_color: map.get("brand_color") || "#002d6b",
    accent_color: map.get("accent_color") || "#c81018",
    bg_color: map.get("bg_color") ?? "",
    bg_image_data_url: map.get("bg_image_data_url") ?? "",
    bg_overlay_opacity: parseBoundedInt(map.get("bg_overlay_opacity"), DEFAULT_BG_OVERLAY, 0, 95)
  };
}

const STRING_SETTING_KEYS: Array<
  keyof Pick<
    PublicSettings,
    | "app_name"
    | "org_name"
    | "org_subtitle"
    | "org_document"
    | "org_contact"
    | "loan_term_footer"
    | "logo_data_url"
    | "theme_preset"
    | "brand_color"
    | "accent_color"
    | "bg_color"
    | "bg_image_data_url"
  >
> = [
  "app_name",
  "org_name",
  "org_subtitle",
  "org_document",
  "org_contact",
  "loan_term_footer",
  "logo_data_url",
  "theme_preset",
  "brand_color",
  "accent_color",
  "bg_color",
  "bg_image_data_url"
];

export function updatePublicSettings(
  db: DatabaseSync,
  input: Partial<PublicSettings>,
  actor: AuthUser,
  ipAddress: string
): PublicSettings {
  const before = getPublicSettings(db);
  const now = new Date().toISOString();

  return withTransaction(db, () => {
    const upsert = db.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    for (const key of STRING_SETTING_KEYS) {
      const val = input[key];
      if (val !== undefined) {
        upsert.run(key, key === "logo_data_url" || key === "bg_image_data_url" ? val : val.trim(), now);
      }
    }
    if (input.loan_default_days !== undefined) {
      upsert.run("loan_default_days", String(input.loan_default_days), now);
    }
    if (input.bg_overlay_opacity !== undefined) {
      upsert.run("bg_overlay_opacity", String(input.bg_overlay_opacity), now);
    }

    const after = getPublicSettings(db);
    const summarize = (s: PublicSettings) => ({
      app_name: s.app_name,
      org_name: s.org_name,
      org_subtitle: s.org_subtitle,
      org_document: s.org_document,
      org_contact: s.org_contact,
      has_logo: Boolean(s.logo_data_url),
      has_bg_image: Boolean(s.bg_image_data_url),
      theme_preset: s.theme_preset,
      brand_color: s.brand_color,
      accent_color: s.accent_color,
      bg_color: s.bg_color,
      bg_overlay_opacity: s.bg_overlay_opacity,
      loan_default_days: s.loan_default_days
    });
    writeAuditLog(db, {
      userId: actor.id,
      userName: actor.full_name,
      action: "UPDATE",
      entity: "app_settings",
      summary: `Configurações da organização atualizadas (${after.app_name} / ${after.org_name})`,
      before: summarize(before),
      after: summarize(after),
      ipAddress
    });

    return after;
  });
}
