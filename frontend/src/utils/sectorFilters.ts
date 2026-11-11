import type { CatalogEquipment, CatalogSector, MovementItem } from "../types";

export interface SectorFilterOption {
  id: number | null;
  name: string;
}

const norm = (value: string | null | undefined) => (value || "").trim().toLowerCase();

export function matchMovementSector(
  m: Pick<MovementItem, "sector_id" | "sector_name">,
  sector: SectorFilterOption
): boolean {
  if (sector.id && sector.id > 0 && m.sector_id === sector.id) {
    return true;
  }
  const target = norm(sector.name);
  return Boolean(target) && norm(m.sector_name) === target;
}

export function matchEquipmentSector(
  eq: Pick<CatalogEquipment, "origin_sector_id" | "origin" | "received_from">,
  sector: SectorFilterOption
): boolean {
  if (sector.id && sector.id > 0 && eq.origin_sector_id === sector.id) {
    return true;
  }
  const target = norm(sector.name);
  if (!target) return false;
  return norm(eq.origin) === target || norm(eq.received_from) === target;
}

export function collectSectorFilterOptions(
  sectors: CatalogSector[],
  equipments: CatalogEquipment[],
  movements: MovementItem[]
): SectorFilterOption[] {
  const map = new Map<string, SectorFilterOption>();

  for (const s of sectors) {
    const key = norm(s.name);
    if (key) {
      map.set(key, { id: s.id > 0 ? s.id : null, name: s.name.trim() });
    }
  }
  for (const m of movements) {
    const key = norm(m.sector_name);
    if (key && !map.has(key)) {
      map.set(key, { id: m.sector_id && m.sector_id > 0 ? m.sector_id : null, name: m.sector_name.trim() });
    }
  }
  for (const eq of equipments) {
    const key = norm(eq.origin);
    if (key && !map.has(key)) {
      map.set(key, {
        id: eq.origin_sector_id && eq.origin_sector_id > 0 ? eq.origin_sector_id : null,
        name: eq.origin.trim()
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Verifica se um timestamp ISO cai dentro do intervalo inclusivo de datas locais [fromDate, toDate]. */
export function isIsoInLocalDateRange(
  iso: string | null | undefined,
  fromDate: string,
  toDate: string
): boolean {
  if (!fromDate && !toDate) return true;
  if (!iso) return false;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return false;

  if (fromDate) {
    const start = new Date(`${fromDate}T00:00:00`).getTime();
    if (!Number.isNaN(start) && ts < start) return false;
  }
  if (toDate) {
    const end = new Date(`${toDate}T23:59:59.999`).getTime();
    if (!Number.isNaN(end) && ts > end) return false;
  }
  return true;
}
