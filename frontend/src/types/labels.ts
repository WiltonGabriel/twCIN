import type { CSSProperties } from "react";
import type { EquipmentCondition, EquipmentOwnership, MovementItem } from "./index";

/** Rótulos únicos usados em todas as telas e PDFs (antes repetidos em 4 arquivos). */
export const OWNERSHIP_LABELS: Record<EquipmentOwnership, string> = {
  proprio_ti: "Próprio do TI",
  estoque: "Em estoque",
  terceiro: "De terceiro / outro setor"
};

export const CONDITION_LABELS: Record<EquipmentCondition, string> = {
  disponivel: "Disponível",
  em_uso: "Em uso",
  manutencao: "Manutenção",
  avaliacao: "Avaliação",
  emprestado: "Emprestado",
  descartado: "Descartado",
  devolvido_dono: "Devolvido ao dono"
};

/** Situações que a pessoa pode escolher à mão (as demais vêm de ações do sistema). */
export const MANUAL_CONDITIONS: EquipmentCondition[] = [
  "disponivel",
  "em_uso",
  "manutencao",
  "avaliacao",
  "descartado"
];

/** Situações em que o equipamento não pode sair numa movimentação. */
export const BLOCKED_CONDITIONS: EquipmentCondition[] = ["manutencao", "avaliacao", "descartado", "devolvido_dono"];

export function conditionStyle(status: EquipmentCondition): CSSProperties {
  if (status === "disponivel") return { backgroundColor: "var(--ok-soft)", color: "var(--ok)" };
  if (status === "manutencao" || status === "avaliacao") return { backgroundColor: "var(--warn-soft)", color: "var(--warn)" };
  if (status === "descartado") return { backgroundColor: "var(--cin-red-soft)", color: "var(--cin-red)" };
  if (status === "devolvido_dono") return { backgroundColor: "var(--surface-alt)", color: "var(--text-muted)" };
  return { backgroundColor: "var(--brand-soft)", color: "var(--brand)" };
}

export function isOverdue(m: Pick<MovementItem, "status" | "due_at">, now = Date.now()): boolean {
  return m.status === "ativo" && Boolean(m.due_at) && new Date(m.due_at as string).getTime() < now;
}

export function daysOverdue(m: Pick<MovementItem, "due_at">, now = Date.now()): number {
  if (!m.due_at) return 0;
  return Math.max(0, Math.floor((now - new Date(m.due_at).getTime()) / (24 * 60 * 60 * 1000)));
}

export function movementStatusLabel(m: Pick<MovementItem, "status" | "due_at">): string {
  if (m.status === "devolvido") return "Devolvido";
  if (m.status === "fixo") return "Instalação fixa";
  return isOverdue(m) ? "Atrasado" : "Emprestado";
}

export function movementStatusStyle(m: Pick<MovementItem, "status" | "due_at">): CSSProperties {
  if (m.status === "devolvido") return { backgroundColor: "var(--ok-soft)", color: "var(--ok)" };
  if (m.status === "fixo") return { backgroundColor: "var(--surface-alt)", color: "var(--text-muted)" };
  if (isOverdue(m)) return { backgroundColor: "var(--cin-red-soft)", color: "var(--cin-red)" };
  return { backgroundColor: "var(--brand-soft)", color: "var(--brand)" };
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR");
}
