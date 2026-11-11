import { ExternalLink, Shield, Wifi, WifiOff } from "lucide-react";
import type { AuthUser, PublicSettings } from "../types";

interface SobrePanelProps {
  user: AuthUser;
  settings: PublicSettings;
  online: boolean;
  counts: {
    equipments: number;
    movements: number;
    sectors: number;
    locations: number;
  };
}

export function SobrePanel({ user, settings, online, counts }: SobrePanelProps) {
  const appVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.0.0";

  return (
    <div className="space-y-6 max-w-2xl">
      <div
        className="p-4 rounded-xl border flex flex-wrap items-center justify-between gap-4"
        style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="bg-white rounded-lg p-2 border border-slate-200 shrink-0">
            <img src={settings.logo_data_url || "/logo.svg"} alt={settings.app_name} className="h-9 w-auto block" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <strong className="text-base">{settings.app_name}</strong>
              <span className="tw-badge font-mono" style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand)" }}>
                v{appVersion}
              </span>
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {settings.org_name}
              {settings.org_subtitle ? ` · ${settings.org_subtitle}` : ""}
            </div>
            {settings.org_document && (
              <div className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                {settings.org_document}
              </div>
            )}
            {settings.org_contact && (
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                Suporte: {settings.org_contact}
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="space-y-2" aria-labelledby="sobre-cache-title">
        <h3 id="sobre-cache-title" className="text-sm font-semibold">Resumo neste dispositivo</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="tw-stat">
            <span className="tw-stat-label">Equipamentos</span>
            <strong>{counts.equipments}</strong>
          </div>
          <div className="tw-stat">
            <span className="tw-stat-label">Movimentações</span>
            <strong>{counts.movements}</strong>
          </div>
          <div className="tw-stat">
            <span className="tw-stat-label">Setores</span>
            <strong>{counts.sectors}</strong>
          </div>
          <div className="tw-stat">
            <span className="tw-stat-label">Locais</span>
            <strong>{counts.locations}</strong>
          </div>
        </div>
      </section>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div className="p-3.5 rounded-xl border space-y-1" style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}>
          <dt className="text-xs" style={{ color: "var(--text-muted)" }}>Conexão atual</dt>
          <dd className="font-semibold flex items-center gap-1.5" style={{ color: online ? "var(--ok)" : "var(--cin-red)" }}>
            {online ? <Wifi className="w-4 h-4" aria-hidden="true" /> : <WifiOff className="w-4 h-4" aria-hidden="true" />}
            {online ? "Online" : "Offline (usando cache local)"}
          </dd>
        </div>

        <div className="p-3.5 rounded-xl border space-y-1" style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}>
          <dt className="text-xs" style={{ color: "var(--text-muted)" }}>Seu perfil</dt>
          <dd className="font-semibold flex items-center gap-1.5">
            <Shield className="w-4 h-4" style={{ color: "var(--brand)" }} aria-hidden="true" />
            {user.role === "tecnico" ? "Técnico" : "Administrador"} (@{user.username})
          </dd>
        </div>
      </dl>

      <section className="pt-4 border-t space-y-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
        <p>
          Aplicação web progressiva (PWA) offline-first para gestão de equipamentos, empréstimos, instalações e auditoria do setor de TI.
        </p>
        <p>
          <strong>Tecnologias:</strong> React 19, TypeScript, Tailwind CSS, IndexedDB (Dexie), Fastify e SQLite (`node:sqlite`).
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>Mantido por <strong>Wilton Pereira</strong> e <strong>Thales</strong> · Licença MIT</span>
          <a
            href="https://github.com/WiltonGabriel/twCIN"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold underline"
            style={{ color: "var(--brand)" }}
          >
            Repositório no GitHub <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        </p>
      </section>
    </div>
  );
}
