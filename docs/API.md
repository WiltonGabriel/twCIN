# Referência da API

Todas as rotas — exceto `/api/health`, `/api/settings/public`, `/api/auth/status`, `/api/auth/setup` e `/api/auth/login` — exigem um cookie de sessão `HttpOnly` válido (`twcin_session`).

## Saúde e configurações da organização

- `GET /api/health` — Retorna `{ ok: true }`.
- `GET /api/settings/public` — Retorna `{ settings: { app_name, org_name, logo_data_url } }`.
- `PATCH /api/settings` — Atualiza a identidade visual da organização (`app_name`, `org_name`, `logo_data_url` em PNG, JPEG ou WebP) e o prazo padrão de empréstimo em dias (`loan_default_days`, 0 = sem prazo).

## Autenticação

- `GET /api/auth/status` — Verifica se o setup inicial ainda é necessário (`{ needs_setup: boolean }`).
- `POST /api/auth/setup` — Cria o primeiro usuário quando não há contas cadastradas (com rate limit).
- `POST /api/auth/login` — Autentica o usuário e define o cookie de sessão `HttpOnly` (com rate limit rigoroso).
- `POST /api/auth/change-password` — Atualiza a senha do usuário autenticado, rotaciona `token_version` e emite novo cookie.
- `POST /api/auth/logout` — Encerra a sessão atual (o token deixa de ser aceito, mesmo se copiado) e remove o cookie.
- `POST /api/auth/logout-all` — Encerra as sessões do usuário em todos os dispositivos.
- `GET /api/auth/me` — Retorna os dados do usuário autenticado atualmente.

## Equipamentos (custódia e inventário de TI)

- `GET /api/catalogs/equipments` — Lista equipamentos (`?includeInactive=true`).
- `GET /api/catalogs/equipments/:id` — Retorna os detalhes do equipamento e o histórico de movimentações vinculadas.
- `POST /api/catalogs/equipments` — Cadastra um equipamento (`ownership_type`, `condition_status`, além dos campos opcionais `patrimony`, `origin`, `received_from`, `reason` e `notes`).
- `PATCH /api/catalogs/equipments/:id` — Edita campos e situação do equipamento com validação de concorrência via `expected_version`. A situação "emprestado" é definida pelas movimentações; com movimentação aberta, a situação não pode ser alterada nem o equipamento desativado.
- `POST /api/catalogs/equipments/:id/return-to-owner` — Devolve ao dono um equipamento de terceiro (`received_by` obrigatório; `returned_at` e `notes` opcionais). O equipamento fica com situação `devolvido_dono` e inativo.

## Movimentações e empréstimos

- `GET /api/movements` — Lista movimentações (`?includeFinished=true&status=...&sector=...&sector_id=...&search=...&overdue=true`).
- `GET /api/movements/:id` — Consulta uma movimentação pelo ID.
- `POST /api/movements` — Registra saída ou empréstimo (`install_location` obrigatório; `patrimony` e `received_by` opcionais) e gera código sequencial `document_code` (`MOV-XXXX`). Empréstimos recebem `due_at` (prazo) pelo prazo padrão das configurações, a menos que `due_at` seja enviado (`null` = sem prazo). Equipamento descartado, inativo, em manutenção, em avaliação, devolvido ao dono ou já fora é recusado. A saída atualiza a situação do equipamento (empréstimo → `emprestado`, instalação fixa → `em_uso`).
- `PATCH /api/movements/:id` — Edita um registro de movimentação com controle otimista de versão. Tipo e status precisam ser compatíveis (empréstimo: `ativo`/`devolvido`; instalação: `fixo`/`devolvido`).
- `POST /api/movements/:id/return` — Registra a devolução (ou desfaz a instalação fixa) com carimbo de data/hora e técnico recebedor; o equipamento volta a `disponivel`.

## Setores, locais e autocomplete

- `GET /api/catalogs/suggestions` — Sugestões combinadas de equipamentos, setores, locais e pessoas para autocomplete.
- `GET /api/catalogs/sectors`, `POST /api/catalogs/sectors`, `PATCH /api/catalogs/sectors/:id`
- `GET /api/catalogs/locations`, `POST /api/catalogs/locations`, `PATCH /api/catalogs/locations/:id`

## Usuários e logs de auditoria

- `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id` — Gestão de usuários da equipe de TI com acesso igualitário (`must_change_password` e ativação/desativação).
- `POST /api/users/:id/revoke-sessions` — Incrementa `token_version` para invalidar sessões ativas imediatamente.
- `GET /api/audit` — Consulta registros imutáveis de auditoria (`?entity=...&entity_id=...&action=...&user_id=...&from=...&to=...&q=...&limit=...&before_id=...`). Retorna `{ items, next_before_id }`; passe `next_before_id` como `before_id` para a próxima página.

## Backup

- `POST /api/backup` — Baixa uma cópia consistente do banco SQLite. Exige `{ password }` do usuário logado, pois o arquivo contém todos os dados.

## Sincronização offline

- `GET /api/sync/snapshot` — Snapshot completo para hidratação do cache local em `IndexedDB`.
- `POST /api/sync` — Processa operações enfileiradas em ordem cronológica (`equipment.*`, `movement.*`, `sector.create`) com idempotência por `client_uuid` e detecção de conflitos via `version`.
