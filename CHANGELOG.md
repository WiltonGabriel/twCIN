# Changelog

Todas as mudanças notáveis do **twCIN** são documentadas neste arquivo, seguindo [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não publicado]

### Adicionado

- **Catálogo gerenciável de categorias (`Configurações → Cadastros` e `Equipamentos`):**
  - Nova tabela `catalog_categories` com endpoints dedicados (`GET/POST/PATCH /api/catalogs/categories`), sugestões unificadas e suporte à criação offline (`category.create` em `/api/sync`).
  - Seletor unificado com busca, autocompletar, criação rápida e filtro por categoria na tela de **Equipamentos**, propagando renomeações para os equipamentos vinculados.
- **Gerenciamento rápido de serviço e governança do repositório:**
  - Script interativo [`deploy/windows/gerenciar-servico.bat`](deploy/windows/gerenciar-servico.bat) para parar, iniciar, reiniciar, abrir logs ou abrir o navegador com 1 clique no Windows Server.
  - Política de segurança (`SECURITY.md`), código de conduta (`CODE_OF_CONDUCT.md`), templates de Issue/PR, `dependabot.yml`, `.gitattributes`, `.editorconfig`, `.nvmrc` e restrição `engines` (`Node.js >= 24`).

### Alterado

- **Política empresarial de porta (`PORT_AUTO_FALLBACK`):**
  - Serviços (`WinSW`, `systemd` e Docker) usam `twcin.env` como fonte única de porta (preservada em atualizações), falham rápido com diagnóstico claro em `EADDRINUSE` e validam portas ocupadas antes da instalação (`-Port` no Windows, `TWCIN_PORT` no Linux).
  - Inicializações portáteis (`iniciar-twcin.bat` e `iniciar-twcin.sh`) habilitam `PORT_AUTO_FALLBACK=true` para subir automaticamente na próxima porta livre caso a padrão esteja em uso.

## [1.0.0] - 2026-11-10

### Principais recursos

- **Gestão completa de equipamentos e custódia (`Equipamentos`):**
  - Diferencia itens próprios do TI, estoque e equipamentos de terceiros/outros setores.
  - Vincula setor de origem (`origin_sector_id`), pessoa entregadora (`received_from`) e data/hora real de recebimento (`received_at`).
  - Fluxo de **Devolver ao dono** com data/hora, recebedor, observações e filtro dedicado **Devolvidos ao dono**.
- **Visão unificada por setor (`Por Setor` / Dossiê):**
  - Consulta única para comprovar tudo de um setor específico (o que está com o setor agora, o que está na TI para conserto, o que já foi devolvido ao dono e repasses/histórico), com filtro por data e PDF consolidado.
- **Movimentações e termos imprimíveis (`Movimentações` e PDF):**
  - Empréstimos com prazo configurável, instalações fixas, filtros por setor também na aba **Em aberto**, códigos `MOV-XXXX` e PDFs com assinatura tanto para movimentações quanto para entrada/devolução de itens de terceiros.
- **PWA offline-first com sincronização segura:**
  - Armazenamento local em `IndexedDB` (Dexie), fila offline por usuário, resolução automática de referências offline (`equipment_client_uuid`) e detecção de conflitos por versão.
- **Personalização visual, editor de imagem e backup portátil:**
  - Temas claro/escuro/sistema, paletas institucionais com contraste garantido, imagem de fundo, logo sincronizada com o favicon da guia e editor/recortador integrado com conversão automática para WebP e download.
  - Exportação CSV, exportação e restauração atômica de backup `.db` (inclusive na tela inicial de uma nova instalação) e backups automáticos programados em disco.
- **Empacotamento e operação em servidor:**
  - Docker multi-arch (`Dockerfile` + `docker-compose.yml`), pacote autossuficiente para Windows Server (com suporte portátil e serviço nativo via WinSW) e pacote Linux (`systemd`).
