import type { CatalogCategory, CatalogSector } from "../types";
import { CatalogSelector, findCatalogItem, type CatalogSelectorLabels } from "./CatalogSelector";

const SECTOR_LABELS: CatalogSelectorLabels = {
  entitySingular: "setor",
  gender: "o",
  selectPlaceholder: "Selecionar setor...",
  searchPlaceholder: "Pesquisar setor...",
  manualPlaceholder: "Digite o nome do setor",
  listTitle: "Opções de setor",
  emptyListMessage: "Nenhum setor encontrado na lista."
};

const CATEGORY_LABELS: CatalogSelectorLabels = {
  entitySingular: "categoria",
  gender: "a",
  selectPlaceholder: "Selecionar categoria...",
  searchPlaceholder: "Pesquisar categoria...",
  manualPlaceholder: "Digite o nome da categoria",
  listTitle: "Opções de categoria",
  emptyListMessage: "Nenhuma categoria encontrada na lista."
};

export function findCatalogSector(sectors: CatalogSector[], name: string): CatalogSector | undefined {
  return findCatalogItem(sectors, name);
}

export function findCatalogCategory(categories: CatalogCategory[], name: string): CatalogCategory | undefined {
  return findCatalogItem(categories, name);
}

interface SectorSelectorProps {
  id: string;
  value: string;
  onChange: (name: string) => void;
  sectors: CatalogSector[];
  suggestedNames?: string[];
  onCreateSector: (payload: { name: string; is_default?: boolean }) => Promise<CatalogSector>;
  required?: boolean;
  allowClear?: boolean;
}

export function SectorSelector({
  sectors,
  onCreateSector,
  ...rest
}: SectorSelectorProps) {
  return (
    <CatalogSelector
      {...rest}
      items={sectors}
      onCreateItem={onCreateSector}
      labels={SECTOR_LABELS}
    />
  );
}

interface CategorySelectorProps {
  id: string;
  value: string;
  onChange: (name: string) => void;
  categories: CatalogCategory[];
  suggestedNames?: string[];
  onCreateCategory: (payload: { name: string; is_default?: boolean }) => Promise<CatalogCategory>;
  required?: boolean;
  allowClear?: boolean;
}

export function CategorySelector({
  categories,
  onCreateCategory,
  allowClear = true,
  ...rest
}: CategorySelectorProps) {
  return (
    <CatalogSelector
      {...rest}
      allowClear={allowClear}
      items={categories}
      onCreateItem={onCreateCategory}
      labels={CATEGORY_LABELS}
    />
  );
}
