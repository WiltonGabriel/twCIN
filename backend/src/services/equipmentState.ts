import type { DatabaseSync } from "node:sqlite";
import { writeAuditLog } from "../security/audit.js";
import type { AuthUser } from "../security/auth.js";

/**
 * Regras que ligam a situação do equipamento às movimentações (decisão de produto de 10/11/2026):
 * - saída por empréstimo → "emprestado"; instalação fixa → "em_uso";
 * - devolução → "disponivel";
 * - equipamento em manutenção, avaliação, descartado ou devolvido ao dono não pode sair.
 */

export const OPEN_MOVEMENT_STATUSES = ["ativo", "fixo"] as const;

/** Situações em que o equipamento não pode ser movimentado. */
export const BLOCKED_CONDITIONS: Record<string, string> = {
  descartado: "está descartado",
  manutencao: "está em manutenção",
  avaliacao: "está em avaliação",
  devolvido_dono: "já foi devolvido ao dono"
};

/** Situações que só o sistema define (a partir das movimentações). */
export const MOVEMENT_DRIVEN_CONDITIONS = ["emprestado", "em_uso"] as const;

export function conditionForMovementType(type: "emprestimo" | "instalacao_fixa"): "emprestado" | "em_uso" {
  return type === "emprestimo" ? "emprestado" : "em_uso";
}

export function findOpenMovement(
  db: DatabaseSync,
  equipmentId: number,
  ignoreMovementId?: number
): { id: number; document_code: string; movement_type: "emprestimo" | "instalacao_fixa" } | undefined {
  return db
    .prepare(
      `SELECT id, document_code, movement_type FROM movements
       WHERE equipment_id = ? AND status IN ('ativo', 'fixo') AND id != ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(equipmentId, ignoreMovementId ?? -1) as
    | { id: number; document_code: string; movement_type: "emprestimo" | "instalacao_fixa" }
    | undefined;
}

/**
 * Atualiza a situação do equipamento por causa de uma movimentação, registrando na auditoria.
 * Deve ser chamada dentro da mesma transação da movimentação.
 */
export function setEquipmentConditionFromMovement(
  db: DatabaseSync,
  equipmentId: number | null | undefined,
  nextCondition: string,
  reason: string,
  actor: AuthUser,
  ipAddress: string
): void {
  if (equipmentId === null || equipmentId === undefined) return;
  const before = db.prepare("SELECT * FROM catalog_equipments WHERE id = ?").get(equipmentId) as
    | { id: number; name: string; condition_status: string }
    | undefined;
  if (!before || before.condition_status === nextCondition) return;

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE catalog_equipments SET condition_status = ?, version = version + 1,
       updated_by_id = ?, updated_by_name = ?, updated_at = ?
     WHERE id = ?`
  ).run(nextCondition, actor.id, actor.full_name, now, equipmentId);

  const after = db.prepare("SELECT * FROM catalog_equipments WHERE id = ?").get(equipmentId);
  writeAuditLog(db, {
    userId: actor.id,
    userName: actor.full_name,
    action: "STATUS_CHANGE",
    entity: "catalog_equipment",
    entityId: equipmentId,
    summary: `Situação de ${before.name}: ${before.condition_status} → ${nextCondition} (${reason})`,
    before,
    after,
    ipAddress
  });
}
