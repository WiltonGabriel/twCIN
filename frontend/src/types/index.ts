export type UserRole = "admin" | "tecnico";

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  role?: UserRole;
  must_change_password: boolean;
  last_login_at: string | null;
}

export interface TiUser {
  id: number;
  full_name: string;
  username: string;
  role?: UserRole;
  active: number;
  must_change_password: number;
  last_login_at: string | null;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type EquipmentOwnership = "proprio_ti" | "estoque" | "terceiro";
export type EquipmentCondition =
  | "disponivel"
  | "em_uso"
  | "manutencao"
  | "avaliacao"
  | "emprestado"
  | "descartado"
  | "devolvido_dono";

export interface CatalogEquipment {
  id: number;
  client_uuid: string;
  name: string;
  patrimony: string | null;
  category: string;
  ownership_type: EquipmentOwnership;
  condition_status: EquipmentCondition;
  origin_sector_id?: number | null;
  origin: string;
  received_from: string;
  received_at?: string | null;
  reason: string;
  notes: string;
  active: number;
  version: number;
  created_by_id: number | null;
  created_by_name: string;
  updated_by_id: number | null;
  updated_by_name: string;
  owner_returned_at?: string | null;
  owner_received_by?: string;
  owner_returned_by_name?: string;
  created_at: string;
  updated_at: string;
  _pendingSync?: boolean;
}

export type MovementType = "emprestimo" | "instalacao_fixa";
export type MovementStatus = "ativo" | "devolvido" | "fixo";

export interface MovementItem {
  id: number;
  client_uuid: string;
  document_code: string;
  movement_type: MovementType;
  equipment_id: number | null;
  equipment_name: string;
  patrimony: string;
  sector_id: number | null;
  sector_name: string;
  install_location: string;
  received_by: string;
  notes: string;
  status: MovementStatus;
  version: number;
  out_at: string;
  due_at?: string | null;
  returned_at: string | null;
  registered_by_id: number | null;
  registered_by_name: string;
  returned_to_id: number | null;
  returned_to_name: string | null;
  created_at: string;
  updated_at: string;
  _pendingSync?: boolean;
}

export interface CatalogSector {
  id: number;
  name: string;
  is_default: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface CatalogLocation {
  id: number;
  name: string;
  sector_id: number | null;
  active: number;
  created_at: string;
}

export interface SuggestionsPayload {
  equipments: Array<{ id: number | null; name: string; patrimony: string }>;
  sectors: Array<{ id: number | null; name: string; is_default: boolean }>;
  locations: string[];
  people: string[];
}

export interface AuditLogItem {
  id: number;
  user_id: number | null;
  user_name: string;
  action: string;
  entity: string;
  entity_id: number | null;
  summary: string;
  before_json: string | null;
  after_json: string | null;
  ip_address: string;
  created_at: string;
}

export interface PublicSettings {
  app_name: string;
  org_name: string;
  org_subtitle?: string;
  org_document?: string;
  org_contact?: string;
  loan_term_footer?: string;
  logo_data_url: string;
  /** Prazo padrão de devolução dos empréstimos, em dias. 0 = sem prazo. */
  loan_default_days?: number;
  theme_preset?: string;
  brand_color?: string;
  accent_color?: string;
  bg_color?: string;
  bg_image_data_url?: string;
  bg_overlay_opacity?: number;
}

export type ThemePreference = "system" | "light" | "dark";
export type PageKey = "inicio" | "equipamentos" | "movimentacoes" | "setores" | "configuracoes";
