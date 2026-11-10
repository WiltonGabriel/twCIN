import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";

function positiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function isoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function registerAuditRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  requireAuth: (req: any, reply: any) => Promise<void>
): void {
  /**
   * Consulta da auditoria com paginação por cursor.
   * `before_id` = o `next_before_id` da página anterior. `from`/`to` = período (ISO ou AAAA-MM-DD).
   */
  app.get("/api/audit", { preHandler: [requireAuth] }, async (request) => {
    const query = request.query as {
      entity?: string;
      entity_id?: string;
      action?: string;
      user_id?: string;
      limit?: string;
      before_id?: string;
      from?: string;
      to?: string;
      q?: string;
    };

    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (query.entity?.trim()) {
      conditions.push("entity = ?");
      params.push(query.entity.trim());
    }
    const entityId = positiveInt(query.entity_id);
    if (entityId !== undefined) {
      conditions.push("entity_id = ?");
      params.push(entityId);
    }
    if (query.action?.trim()) {
      conditions.push("action = ?");
      params.push(query.action.trim());
    }
    const userId = positiveInt(query.user_id);
    if (userId !== undefined) {
      conditions.push("user_id = ?");
      params.push(userId);
    }
    const beforeId = positiveInt(query.before_id);
    if (beforeId !== undefined) {
      conditions.push("id < ?");
      params.push(beforeId);
    }
    const from = isoDate(query.from);
    if (from) {
      conditions.push("created_at >= ?");
      params.push(from);
    }
    const to = isoDate(query.to);
    if (to) {
      // "to" em formato de data (AAAA-MM-DD) inclui o dia inteiro.
      const end = /^\d{4}-\d{2}-\d{2}$/.test(query.to ?? "")
        ? new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000).toISOString()
        : to;
      conditions.push("created_at < ?");
      params.push(end);
    }
    if (query.q?.trim()) {
      conditions.push("(summary LIKE ? OR user_name LIKE ?)");
      const like = `%${query.q.trim()}%`;
      params.push(like, like);
    }

    const parsedLimit = Number(query.limit || 100);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 500) : 100;
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Ordenado por id (crescente no tempo) para o cursor ser estável.
    const rows = db
      .prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ?`)
      .all(...params, limit + 1) as Array<{ id: number }>;

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, next_before_id: hasMore ? items[items.length - 1].id : null };
  });
}
