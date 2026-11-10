import { z } from "zod";

// Mesma política de senha em todo o sistema (antes: 8 no setup/troca e 6 na criação/redefinição).
const passwordSchema = z.string().min(8, "A senha deve ter no mínimo 8 caracteres.").max(128);

export const loginSchema = z.object({
  username: z.string().trim().min(2).max(60),
  password: z.string().min(1).max(128)
});

export const setupSchema = z.object({
  full_name: z.string().trim().min(2).max(100),
  username: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/, "Usuário deve conter apenas letras, números, ponto, hífen ou sublinhado."),
  password: z.string().min(8, "A senha deve ter no mínimo 8 caracteres.").max(128),
  app_name: z.string().trim().min(1).max(60).optional(),
  org_name: z.string().trim().min(1).max(120).optional()
});

export const updateSettingsSchema = z.object({
  app_name: z.string().trim().min(1).max(60).optional(),
  org_name: z.string().trim().min(1).max(120).optional(),
  logo_data_url: z
    .string()
    .max(750_000, "A imagem da logo excede o tamanho máximo permitido.")
    .refine(
      (val) =>
        val === "" ||
        /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(val),
      "Formato de imagem inválido. Use PNG, JPEG ou WebP."
    )
    .optional(),
  loan_default_days: z.number().int().min(0, "Prazo inválido.").max(365, "O prazo máximo é de 365 dias.").optional()
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, "Informe a senha atual.").max(128),
  new_password: z
    .string()
    .min(8, "A nova senha deve ter no mínimo 8 caracteres.")
    .max(128)
});

export const createUserSchema = z.object({
  full_name: z.string().trim().min(2).max(100),
  username: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/, "Usuário deve conter apenas letras, números, ponto, hífen ou sublinhado."),
  password: passwordSchema,
  must_change_password: z.boolean().optional().default(true)
});

export const updateUserSchema = z.object({
  full_name: z.string().trim().min(2).max(100).optional(),
  username: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/, "Usuário deve conter apenas letras, números, ponto, hífen ou sublinhado.")
    .optional(),
  password: passwordSchema.optional(),
  active: z.boolean().optional(),
  must_change_password: z.boolean().optional()
});

// Data/hora ISO 8601 completa (ex.: 2026-11-10T20:46:07.590Z). Antes aceitava qualquer texto
// com 10+ caracteres, o que permitia gravar valores como "aaaaaaaaaa" em out_at/returned_at.
const isoDateTime = (message: string) => z.string().datetime({ offset: true, message });

export const movementTypeEnum = z.enum(["emprestimo", "instalacao_fixa"]);
export const movementStatusEnum = z.enum(["ativo", "devolvido", "fixo"]);

export const createMovementSchema = z.object({
  client_uuid: z.string().uuid().optional(),
  movement_type: movementTypeEnum.optional().default("emprestimo"),
  equipment_id: z.number().int().positive().nullable().optional(),
  equipment_name: z.string().trim().min(1, "Informe o equipamento.").max(160),
  patrimony: z.string().trim().max(80).optional().default(""),
  sector_id: z.number().int().positive().nullable().optional(),
  sector_name: z.string().trim().min(1, "Informe o setor de destino.").max(120),
  install_location: z.string().trim().min(1, "Informe o local de instalação.").max(140),
  received_by: z.string().trim().max(120).optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
  out_at: isoDateTime("Data/hora de saída inválida.").optional(),
  /** Prazo de devolução. Ausente = prazo padrão das configurações; null = sem prazo. */
  due_at: isoDateTime("Prazo de devolução inválido.").nullable().optional()
});

export const updateMovementSchema = z.object({
  movement_type: movementTypeEnum.optional(),
  equipment_id: z.number().int().positive().nullable().optional(),
  equipment_name: z.string().trim().min(1).max(160).optional(),
  patrimony: z.string().trim().max(80).optional(),
  sector_id: z.number().int().positive().nullable().optional(),
  sector_name: z.string().trim().min(1).max(120).optional(),
  install_location: z.string().trim().min(1, "Informe o local de instalação.").max(140).optional(),
  received_by: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  out_at: isoDateTime("Data/hora de saída inválida.").optional(),
  returned_at: isoDateTime("Data/hora de devolução inválida.").nullable().optional(),
  due_at: isoDateTime("Prazo de devolução inválido.").nullable().optional(),
  status: movementStatusEnum.optional(),
  expected_version: z.number().int().positive().optional()
});

export const returnMovementSchema = z.object({
  returned_at: isoDateTime("Data/hora de devolução inválida.").optional(),
  notes: z.string().trim().max(1000).optional(),
  expected_version: z.number().int().positive().optional()
});

export const equipmentOwnershipEnum = z.enum(["proprio_ti", "estoque", "terceiro"]);
export const equipmentConditionEnum = z.enum([
  "disponivel",
  "em_uso",
  "manutencao",
  "avaliacao",
  "emprestado",
  "descartado",
  "devolvido_dono"
]);

export const returnToOwnerSchema = z.object({
  returned_at: isoDateTime("Data/hora inválida.").optional(),
  received_by: z.string().trim().min(1, "Informe quem recebeu o equipamento.").max(120),
  notes: z.string().trim().max(1000).optional(),
  expected_version: z.number().int().positive().optional()
});

export const createEquipmentSchema = z.object({
  client_uuid: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Informe o nome do equipamento.").max(160),
  patrimony: z.string().trim().max(80).optional().default(""),
  category: z.string().trim().max(80).optional().default(""),
  ownership_type: equipmentOwnershipEnum.optional().default("proprio_ti"),
  condition_status: equipmentConditionEnum.optional().default("disponivel"),
  origin: z.string().trim().max(140).optional().default(""),
  received_from: z.string().trim().max(120).optional().default(""),
  reason: z.string().trim().max(500).optional().default(""),
  notes: z.string().trim().max(1000).optional().default("")
});

export const updateEquipmentSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  patrimony: z.string().trim().max(80).optional(),
  category: z.string().trim().max(80).optional(),
  ownership_type: equipmentOwnershipEnum.optional(),
  condition_status: equipmentConditionEnum.optional(),
  origin: z.string().trim().max(140).optional(),
  received_from: z.string().trim().max(120).optional(),
  reason: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
  active: z.boolean().optional(),
  expected_version: z.number().int().positive().optional()
});

export const createSectorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  is_default: z.boolean().optional().default(false)
});

export const updateSectorSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  is_default: z.boolean().optional(),
  active: z.boolean().optional()
});

export const createLocationSchema = z.object({
  name: z.string().trim().min(1).max(140),
  sector_id: z.number().int().positive().nullable().optional()
});

export const updateLocationSchema = z.object({
  name: z.string().trim().min(1).max(140).optional(),
  sector_id: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional()
});

export const syncOperationSchema = z.discriminatedUnion("type", [
  z.object({
    op_id: z.string().min(1),
    type: z.literal("equipment.create"),
    payload: createEquipmentSchema
  }),
  z.object({
    op_id: z.string().min(1),
    type: z.literal("equipment.update"),
    entity_id: z.number().int().positive().optional(),
    client_uuid: z.string().uuid().optional(),
    payload: updateEquipmentSchema
  }),
  z.object({
    op_id: z.string().min(1),
    type: z.literal("equipment.return_to_owner"),
    entity_id: z.number().int().positive().optional(),
    client_uuid: z.string().uuid().optional(),
    payload: returnToOwnerSchema
  }),
  z.object({
    op_id: z.string().min(1),
    type: z.literal("movement.create"),
    payload: createMovementSchema
  }),
  z.object({
    op_id: z.string().min(1),
    type: z.literal("movement.update"),
    entity_id: z.number().int().positive().optional(),
    client_uuid: z.string().uuid().optional(),
    payload: updateMovementSchema
  }),
  z.object({
    op_id: z.string().min(1),
    type: z.literal("movement.return"),
    entity_id: z.number().int().positive().optional(),
    client_uuid: z.string().uuid().optional(),
    payload: returnMovementSchema
  }),
  z.object({
    op_id: z.string().min(1),
    type: z.literal("sector.create"),
    payload: createSectorSchema
  })
]);

// O lote é validado só no formato geral; cada operação é validada individualmente em
// processSyncBatch. Assim, uma operação inválida vira um resultado "error" isolado em vez de
// rejeitar o lote inteiro com 400 (o que travava a fila offline para sempre).
export const syncBatchSchema = z.object({
  operations: z.array(z.unknown()).max(100)
});
