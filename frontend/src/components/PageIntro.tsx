import { HelpCircle, X } from "lucide-react";
import { useState, type ReactNode } from "react";

interface PageIntroProps {
  title: string;
  purpose: string;
  howTo: string[];
  /** Ações principais da página (ex.: botão "Nova movimentação"). */
  actions?: ReactNode;
}

function storageKey(title: string): string {
  return `twcin:intro-visto:${title}`;
}

function readSeen(title: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(title)) === "1";
  } catch {
    return false;
  }
}

function writeSeen(title: string): void {
  try {
    window.localStorage.setItem(storageKey(title), "1");
  } catch {
    // Sem armazenamento local: a ajuda volta a aparecer, sem prejuízo.
  }
}

/**
 * Cabeçalho da página. A explicação "como usar" aparece só no primeiro acesso e depois fica
 * atrás do botão "?" (antes ocupava cerca de 1/5 da tela em todas as visitas).
 */
export function PageIntro({ title, purpose, howTo, actions }: PageIntroProps) {
  const [showHelp, setShowHelp] = useState(() => !readSeen(title));

  const closeHelp = () => {
    writeSeen(title);
    setShowHelp(false);
  };

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          <button
            type="button"
            className="p-1 rounded-full cursor-pointer"
            style={{ color: "var(--text-muted)" }}
            aria-label={showHelp ? "Ocultar ajuda" : "Mostrar ajuda desta página"}
            aria-expanded={showHelp}
            onClick={() => (showHelp ? closeHelp() : setShowHelp(true))}
          >
            <HelpCircle className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>

      {showHelp && (
        <section
          className="tw-card p-4 space-y-2"
          style={{ borderLeftWidth: "4px", borderLeftColor: "var(--brand)" }}
          aria-label={`Como usar: ${title}`}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {purpose}
            </p>
            <button type="button" className="tw-btn tw-btn-sm shrink-0" onClick={closeHelp}>
              <X className="w-3.5 h-3.5" aria-hidden="true" /> Entendi
            </button>
          </div>
          {howTo.length > 0 && (
            <ol className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              {howTo.map((step, index) => (
                <li key={step} className="rounded-lg border px-3 py-2 flex items-start gap-2" style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}>
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold shrink-0" style={{ backgroundColor: "var(--brand-soft)", color: "var(--brand)" }}>
                    {index + 1}
                  </span>
                  <span className="leading-snug">{step}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </header>
  );
}
