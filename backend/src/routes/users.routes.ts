import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { requireAdmin } from "../security/auth.js";
import { createUserSchema, updateUserSchema } from "../schemas/index.js";
import { BadRequestError } from "../services/errors.js";
import { createUser, listUsers, revokeUserSessions, updateUser } from "../services/users.service.js";

export function registerUserRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  requireAuth: (req: any, reply: any) => Promise<void>
): void {
  app.get("/api/users", { preHandler: [requireAuth] }, async () => {
    return { items: listUsers(db) };
  });

  app.post("/api/users", { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
    const input = createUserSchema.parse(request.body);
    const item = createUser(db, input, request.currentUser!, request.ip);
    return reply.code(201).send({ item });
  });

  app.patch("/api/users/:id", { preHandler: [requireAuth, requireAdmin] }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestError("ID inválido.");
    }
    const input = updateUserSchema.parse(request.body);
    const item = updateUser(db, id, input, request.currentUser!, request.ip);
    return { item };
  });

  app.post("/api/users/:id/revoke-sessions", { preHandler: [requireAuth, requireAdmin] }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestError("ID inválido.");
    }
    const item = revokeUserSessions(db, id, request.currentUser!, request.ip);
    return { item };
  });
}
