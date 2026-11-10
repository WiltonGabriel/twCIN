import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import {
  createEquipmentSchema,
  createLocationSchema,
  createSectorSchema,
  returnToOwnerSchema,
  updateEquipmentSchema,
  updateLocationSchema,
  updateSectorSchema
} from "../schemas/index.js";
import {
  createCatalogEquipment,
  createCatalogLocation,
  createCatalogSector,
  findEquipmentByIdOrUuid,
  getSuggestions,
  listCatalogEquipments,
  listCatalogLocations,
  listCatalogSectors,
  returnEquipmentToOwner,
  updateCatalogEquipment,
  updateCatalogLocation,
  updateCatalogSector
} from "../services/catalogs.service.js";
import { BadRequestError, NotFoundError } from "../services/errors.js";

export function registerCatalogRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  requireAuth: (req: any, reply: any) => Promise<void>
): void {
  app.get("/api/catalogs/suggestions", { preHandler: [requireAuth] }, async () => {
    return getSuggestions(db);
  });

  app.get("/api/catalogs/equipments", { preHandler: [requireAuth] }, async (request) => {
    const includeInactive = (request.query as { includeInactive?: string }).includeInactive === "true";
    return { items: listCatalogEquipments(db, includeInactive) };
  });

  app.get("/api/catalogs/equipments/:id", { preHandler: [requireAuth] }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestError("ID inválido.");
    }
    const item = findEquipmentByIdOrUuid(db, id);
    if (!item) {
      throw new NotFoundError("Equipamento não encontrado.");
    }
    const movements = db
      .prepare("SELECT * FROM movements WHERE equipment_id = ? ORDER BY out_at DESC, id DESC")
      .all(id);
    return { item, movements };
  });

  app.post("/api/catalogs/equipments", { preHandler: [requireAuth] }, async (request, reply) => {
    const input = createEquipmentSchema.parse(request.body);
    const item = createCatalogEquipment(db, input, request.currentUser!, request.ip);
    return reply.code(201).send({ item });
  });

  app.patch("/api/catalogs/equipments/:id", { preHandler: [requireAuth] }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestError("ID inválido.");
    }
    const input = updateEquipmentSchema.parse(request.body);
    const item = updateCatalogEquipment(db, { id }, input, request.currentUser!, request.ip);
    return { item };
  });

  app.post("/api/catalogs/equipments/:id/return-to-owner", { preHandler: [requireAuth] }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestError("ID inválido.");
    }
    const input = returnToOwnerSchema.parse(request.body);
    const item = returnEquipmentToOwner(db, { id }, input, request.currentUser!, request.ip);
    return { item };
  });

  app.get("/api/catalogs/sectors", { preHandler: [requireAuth] }, async (request) => {
    const includeInactive = (request.query as { includeInactive?: string }).includeInactive === "true";
    return { items: listCatalogSectors(db, includeInactive) };
  });

  app.post("/api/catalogs/sectors", { preHandler: [requireAuth] }, async (request, reply) => {
    const input = createSectorSchema.parse(request.body);
    const item = createCatalogSector(db, input, request.currentUser!, request.ip);
    return reply.code(201).send({ item });
  });

  app.patch("/api/catalogs/sectors/:id", { preHandler: [requireAuth] }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestError("ID inválido.");
    }
    const input = updateSectorSchema.parse(request.body);
    const item = updateCatalogSector(db, id, input, request.currentUser!, request.ip);
    return { item };
  });

  app.get("/api/catalogs/locations", { preHandler: [requireAuth] }, async (request) => {
    const includeInactive = (request.query as { includeInactive?: string }).includeInactive === "true";
    return { items: listCatalogLocations(db, includeInactive) };
  });

  app.post("/api/catalogs/locations", { preHandler: [requireAuth] }, async (request, reply) => {
    const input = createLocationSchema.parse(request.body);
    const item = createCatalogLocation(db, input, request.currentUser!, request.ip);
    return reply.code(201).send({ item });
  });

  app.patch("/api/catalogs/locations/:id", { preHandler: [requireAuth] }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestError("ID inválido.");
    }
    const input = updateLocationSchema.parse(request.body);
    const item = updateCatalogLocation(db, id, input, request.currentUser!, request.ip);
    return { item };
  });
}
