import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { updateSettingsSchema } from "../schemas/index.js";
import { requireAdmin } from "../security/auth.js";
import { getPublicSettings, updatePublicSettings } from "../services/settings.service.js";

export function registerSettingsRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  requireAuth: (req: any, reply: any) => Promise<void>
): void {
  app.get("/api/settings/public", async () => {
    return { settings: getPublicSettings(db) };
  });

  app.patch("/api/settings", { preHandler: [requireAuth, requireAdmin] }, async (request) => {
    const input = updateSettingsSchema.parse(request.body);
    const settings = updatePublicSettings(db, input, request.currentUser!, request.ip);
    return { settings };
  });
}
