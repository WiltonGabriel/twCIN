# Changelog

Todas as mudanças notáveis do **twCIN** são documentadas neste arquivo, seguindo [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e [Versionamento Semântico](https://semver.org/lang/pt-BR/).

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
