import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { createMovementSchema, returnMovementSchema, updateMovementSchema } from "../schemas/index.js";
import { BadRequestError, NotFoundError } from "../services/errors.js";
import {
  createMovement,
  findMovementByIdOrUuid,
  listMovements,
  returnMovement,
  updateMovement
} from "../services/movements.service.js";

export function registerMovementRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  requireAuth: (req: any, reply: any) => Promise<void>
): void {
  app.get("/api/movements", { preHandler: [requireAuth] }, async (request) => {
    const query = request.query as {
      status?: string;
      includeFinished?: string;
      sector?: string;
      sector_id?: string;
      search?: string;
      overdue?: string;
    };
    const sectorId = query.sector_id !== undefined ? Number(query.sector_id) : undefined;
    const items = listMovements(db, {
      status: query.status,
      includeFinished: query.includeFinished === "true",
      sector: query.sector,
      sectorId: sectorId !== undefined && Number.isInteger(sectorId) && sectorId > 0 ? sectorId : undefined,
      search: query.search,
      overdue: query.overdue === "true"
    });
    return { items };
  });

  app.get("/api/movements/:id", { preHandler: [requireAuth] }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestError("ID inválido.");
    }
    const item = findMovementByIdOrUuid(db, id);
    if (!item) {
      throw new NotFoundError("Movimentação não encontrada.");
    }
    return { item };
  });

  app.post("/api/movements", { preHandler: [requireAuth] }, async (request, reply) => {
    const input = createMovementSchema.parse(request.body);
    const item = createMovement(db, input, request.currentUser!, request.ip);
    return reply.code(201).send({ item });
  });

  app.patch("/api/movements/:id", { preHandler: [requireAuth] }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestError("ID inválido.");
    }
    const input = updateMovementSchema.parse(request.body);
    const item = updateMovement(db, { id }, input, request.currentUser!, request.ip);
    return { item };
  });

  app.post("/api/movements/:id/return", { preHandler: [requireAuth] }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestError("ID inválido.");
    }
    const input = returnMovementSchema.parse(request.body ?? {});
    const item = returnMovement(db, { id }, input, request.currentUser!, request.ip);
    return { item };
  });
}
