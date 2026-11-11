# Referência da API

Todas as rotas — exceto `/api/health`, `/api/settings/public`, `/api/auth/csrf`, `/api/auth/status`, `/api/auth/setup`, `/api/auth/login` e `/api/backup/restore-initial` (apenas antes do setup inicial) — exigem um cookie de sessão `HttpOnly` válido (`twcin_session`). Requisições mutáveis autenticadas (`POST`, `PUT`, `PATCH`, `DELETE`) também exigem o header `X-CSRF-Token` igual ao cookie assinado `twcin_csrf` (Double-Submit Cookie).

## Saúde e configurações da organização

- `GET /api/health` — Verifica a conectividade com o banco SQLite (`SELECT 1`), retornando `200` com `{ ok: true, status: "ok", version, uptime_s }` ou `503` em caso de falha.
- `GET /api/settings/public` — Retorna `{ settings }` com identidade da organização, prazo padrão e aparência (`app_name`, `org_name`, `org_subtitle`, `org_document`, `org_contact`, `loan_term_footer`, `logo_data_url`, `loan_default_days`, `theme_preset`, `brand_color`, `accent_color`, `bg_color`, `bg_image_data_url`, `bg_overlay_opacity`).
- `PATCH /api/settings` — Atualiza os campos de organização, aparência (cores hexadecimais `#RRGGBB`, imagem de fundo PNG/JPEG/WebP, opacidade da película `0–95`) e `loan_default_days` (`0–365`). Requer perfil `admin`.

## Autenticação

- `GET /api/auth/csrf` — Garante e retorna `{ csrf_token }` no cookie `twcin_csrf` para envio em `X-CSRF-Token`.
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
- `POST /api/catalogs/equipments` — Cadastra um equipamento (`ownership_type`, `condition_status`, além dos campos opcionais `patrimony`, `origin_sector_id`, `origin`, `received_from`, `received_at`, `reason` e `notes`).
- `PATCH /api/catalogs/equipments/:id` — Edita campos e situação do equipamento (`origin_sector_id`, `received_at`, etc.) com validação de concorrência via `expected_version`. A situação "emprestado" é definida pelas movimentações; com movimentação aberta, a situação não pode ser alterada nem o equipamento desativado.
- `POST /api/catalogs/equipments/:id/return-to-owner` — Devolve ao dono um equipamento de terceiro (`received_by` obrigatório; `returned_at` ≥ recebimento e `notes` opcionais). O equipamento fica com situação `devolvido_dono` e inativo.

## Movimentações e empréstimos

- `GET /api/movements` — Lista movimentações (`?includeFinished=true&status=...&sector=...&sector_id=...&search=...&overdue=true`).
- `GET /api/movements/:id` — Consulta uma movimentação pelo ID.
- `POST /api/movements` — Registra saída ou empréstimo (`install_location` obrigatório; `patrimony`, `received_by` e `equipment_client_uuid` opcionais) e gera código sequencial `document_code` (`MOV-XXXX`). Empréstimos recebem `due_at` (prazo) pelo prazo padrão das configurações, a menos que `due_at` seja enviado (`null` = sem prazo). Equipamento descartado, inativo, em manutenção, em avaliação, devolvido ao dono ou já fora é recusado. A saída atualiza a situação do equipamento (empréstimo → `emprestado`, instalação fixa → `em_uso`).
- `PATCH /api/movements/:id` — Edita um registro de movimentação com controle otimista de versão. Tipo e status precisam ser compatíveis (empréstimo: `ativo`/`devolvido`; instalação: `fixo`/`devolvido`).
- `POST /api/movements/:id/return` — Registra a devolução (ou desfaz a instalação fixa) com carimbo de data/hora e técnico recebedor; o equipamento volta a `disponivel`.

## Setores, categorias, locais e autocomplete

- `GET /api/catalogs/suggestions` — Sugestões combinadas de equipamentos, setores, categorias, locais e pessoas para autocomplete.
- `GET /api/catalogs/sectors`, `POST /api/catalogs/sectors`, `PATCH /api/catalogs/sectors/:id`
- `GET /api/catalogs/categories`, `POST /api/catalogs/categories`, `PATCH /api/catalogs/categories/:id`
- `GET /api/catalogs/locations`, `POST /api/catalogs/locations`, `PATCH /api/catalogs/locations/:id`

## Usuários e logs de auditoria

- `GET /api/users` — Lista contas da equipe de TI (autenticado).
- `POST /api/users`, `PATCH /api/users/:id` — Criação e edição de usuários com perfil `admin` ou `tecnico` (`must_change_password` e ativação/desativação). Requer perfil `admin` e protege o último administrador ativo.
- `POST /api/users/:id/revoke-sessions` — Incrementa `token_version` para invalidar sessões ativas imediatamente. Requer perfil `admin`.
- `GET /api/audit` — Consulta registros imutáveis de auditoria (`?entity=...&entity_id=...&action=...&user_id=...&from=...&to=...&q=...&limit=...&before_id=...`). Retorna `{ items, next_before_id }`; passe `next_before_id` como `before_id` para a próxima página.

## Backup e restauração

- `POST /api/backup` — Baixa uma cópia consistente do banco SQLite (`.db`). Requer perfil `admin` e `{ password }` do usuário logado, pois o arquivo contém todos os dados.
- `POST /api/backup/restore` — Importa um arquivo `.db` (`{ password, backup_base64 }`) substituindo atomicamente os dados atuais após checar integridade e esquema. Requer perfil `admin`.
- `POST /api/backup/restore-initial` — Importa um arquivo `.db` (`{ backup_base64 }`) quando o sistema ainda não possui usuários (`needs_setup = true`), permitindo migrar para uma nova instância sem refazer o cadastro inicial. Bloqueado com `409` após o setup.

## Sincronização offline

- `GET /api/sync/snapshot` — Snapshot completo para hidratação do cache local em `IndexedDB`.
- `POST /api/sync` — Processa operações enfileiradas em ordem cronológica (`equipment.*`, `movement.*`, `sector.create`, `category.create`) com idempotência por `client_uuid` e detecção de conflitos via `version`.
