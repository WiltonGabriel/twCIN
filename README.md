# twCIN

![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003B57?logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-GHCR-2496ED?logo=docker&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-Offline--First-5A0FC8)
![Licença](https://img.shields.io/badge/Licen%C3%A7a-MIT-blue.svg)

Aplicação web progressiva (PWA) offline-first para gestão interna do setor de TI, controle de equipamentos sob custódia, movimentações, empréstimos e comprovações por setor.

## O que o projeto faz

O **twCIN** oferece à equipe de TI um ambiente único para controlar equipamentos sob custódia (**Equipamentos**), registrar saídas para outros setores (**Movimentações**), consultar e imprimir tudo de um setor específico (**Por Setor**), acompanhar pendências e indicadores (**Início**) e administrar equipe, aparência e dados (**Configurações**), sem depender de portal de chamados para usuários finais.

## Principais recursos

- **Visão rápida (`Início`):** busca unificada (inclusive em itens devolvidos ao dono), empréstimos atrasados e vencendo, equipamentos em manutenção/avaliação, o que está emprestado agora e aba **Indicadores**.
- **Gestão de equipamentos e custódia (`Equipamentos`):** distingue itens próprios, estoque e equipamentos de terceiros/setores com vínculo opcional/obrigatório ao setor de origem (`origin_sector_id`), catálogo gerenciável de **Categorias** (com busca, criação rápida e filtro dedicado), data real de recebimento (`received_at`), fluxo **Devolver ao dono**, filtro exclusivo **Devolvidos ao dono** e **Comprovante PDF** individual com assinaturas.
- **Dossiê unificado por setor (`Por Setor`):** selecione um setor (ex.: *Recursos Didáticos*) e veja em uma tela o que está com ele agora, o que ele trouxe para conserto, o que já devolvemos ao setor e o histórico/doações, com filtro de período e **Imprimir dossiê PDF**.
- **Movimentações com regras (`Movimentações`):** código sequencial `MOV-XXXX`, prazo configurável, filtro por setor também na aba **Em aberto**, histórico completo, devoluções e termo PDF com assinatura.
- **Auditoria e backups:** trilha imutável em `audit_logs`, exportação de planilhas CSV, backup/restauração atômica `.db` pela interface (inclusive no setup inicial de novos servidores) e **backup automático em disco** com retenção configurável.
- **PWA offline-first e identidade visual:** cache `IndexedDB` (Dexie), fila offline por usuário com resolução de conflitos, personalização de paletas, imagem de fundo, logo sincronizada com o favicon da aba e editor/recortador de imagens com conversão para WebP e download.
- **Pronto para servidor:** encerramento gracioso (`SIGTERM`/`SIGINT`), healthcheck SQLite em `/api/health`, suporte a Docker não-privilegiado, pacote portátil com fallback automático de porta, Serviço nativo para Windows Server (com painel de gerenciamento rápido `gerenciar-servico.bat`) e serviço `systemd` para Linux.

---

## Subindo em servidor (Downloads e Execução)

Os pacotes prontos ficam na aba **[Releases](https://github.com/WiltonGabriel/twCIN/releases)** do repositório (não é preciso instalar Node.js nem compilar código para rodar em produção). O passo a passo completo está em [docs/DEPLOY.md](docs/DEPLOY.md).

### 1. Linux com Docker (recomendado)

1. Baixe o arquivo `docker-compose.yml` do Release (ou crie uma pasta com ele) e inicie:

```bash
docker compose up -d
```

2. Acesse no navegador **`http://<IP-DO-SERVIDOR>:3333`** e faça a configuração inicial (ou importe um backup `.db`).
3. Para atualizar depois sem perder dados: `docker compose pull && docker compose up -d`.

> Para instalar o PWA em celulares via rede local, o `docker-compose.yml` também inclui HTTPS pronto via Caddy (`docker compose --profile https up -d`). Veja detalhes em [docs/DEPLOY.md](docs/DEPLOY.md).

### 2. Linux sem Docker (pacote portátil / `systemd`)

1. Baixe **`twcin-vX.Y.Z-linux-x64.tar.gz`** na página de **Releases** e extraia:

```bash
tar -xzf twcin-vX.Y.Z-linux-x64.tar.gz
cd twcin-vX.Y.Z-linux-x64
```

2. **Para testar na hora:** execute `./iniciar-twcin.sh` (escolhe automaticamente a próxima porta livre se `3333` já estiver ocupada).
3. **Para rodar sempre como serviço (`systemd`):** execute `sudo ./instalar-linux.sh` (programa em `/opt/twcin`, dados e `twcin.env` em `/var/lib/twcin`; use `TWCIN_PORT=3400 sudo -E ./instalar-linux.sh` se precisar mudar a porta) e gerencie com `sudo systemctl stop|restart|status twcin`.

### 3. Windows / Windows Server (sem Docker)

1. Baixe **`twcin-vX.Y.Z-win-x64.zip`** na página de **Releases** e extraia em uma pasta (o pacote já traz o runtime Node.js e o wrapper de serviço embutidos).
2. **Para testar na hora (portátil):** dê dois cliques em **`iniciar-twcin.bat`** e acesse a URL exibida no console (padrão **`http://localhost:3333`**; se estiver ocupada, sobe automaticamente na próxima porta livre).
3. **Para rodar sempre como Serviço do Windows Server:** abra o PowerShell **como Administrador** dentro da pasta extraída e execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\instalar-servico.ps1
```

- Programa instalado em `C:\Program Files\twCIN` e dados/backups/configuração (`twcin.env`) isolados em `C:\ProgramData\twCIN`.
- Adicione `-OpenFirewall` para liberar a porta na rede privada/domínio e use `-Port 3400` se a porta `3333` já estiver em uso no servidor (o instalador verifica antes de registrar).
- **Para parar, iniciar ou reiniciar em 1 clique:** dê dois cliques em **`gerenciar-servico.bat`** (ou use `services.msc` / `Stop-Service twCIN`).
- Para atualizar no futuro sem perder o banco nem a porta configurada, extraia o novo `.zip` e rode `instalar-servico.ps1` novamente.

---

## Desenvolvimento local

### Pré-requisitos

- **Node.js `24.x`** ou superior (módulo nativo `node:sqlite`, sem compilação C++) e **npm `10+`**

### Instalação e execução

```bash
git clone https://github.com/WiltonGabriel/twCIN.git
cd twCIN

npm --prefix backend install
npm --prefix frontend install
npm run dev
```

No Windows PowerShell com bloqueio de scripts `.ps1`, execute `npm.cmd run dev` ou `node scripts/dev.mjs`.

- **Frontend dev:** `http://localhost:5173`
- **Backend API:** `http://localhost:3333`

### Testes, validação e empacotamento

```bash
# Verificação de tipos (backend e frontend)
npm run typecheck

# Testes unitários e de integração (API SQLite + motor offline Dexie)
npm test

# Build de produção (backend + frontend PWA)
npm run build

# Teste E2E no navegador Chrome real contra o servidor de produção
npm run test:e2e

# Empacotamento local (gera em release/)
npm run package:win
npm run package:linux
```

### Publicando um novo Release

1. Atualize a versão e o [CHANGELOG.md](CHANGELOG.md) (ex.: `npm run version:sync -- 1.0.0`).
2. Envie o commit para `main`, crie e envie a tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

O workflow `.github/workflows/release.yml` valida todos os testes, publica a imagem multi-arch no GHCR e anexa os pacotes de **Windows Server (`.zip`)** e **Linux (`.tar.gz`)** com `SHA256SUMS.txt` automaticamente no GitHub Release.

---

## Estrutura do projeto

```text
twCIN/
├── backend/              # API Fastify, migrations SQLite, auth, backup, sync e testes
├── frontend/             # React 19 + TypeScript + Tailwind + Vite PWA
├── deploy/               # Scripts de execução e serviço (Windows Server, Linux, Caddy)
├── docs/                 # Referência da API e Guia de Implantação
├── scripts/              # Dev runner, versionamento, empacotador e teste E2E
├── Dockerfile            # Imagem Docker multi-stage não-root com healthcheck
├── docker-compose.yml    # Stack pronta com volume persistente e HTTPS opcional
└── CHANGELOG.md          # Histórico de versões e notas de release
```

## Onde obter ajuda

- **Guia de Implantação (Docker, Windows Server e Linux):** [docs/DEPLOY.md](docs/DEPLOY.md)
- **Referência da API:** [docs/API.md](docs/API.md)
- **Notas de versão:** [CHANGELOG.md](CHANGELOG.md)
- **Diretrizes de contribuição:** [CONTRIBUTING.md](CONTRIBUTING.md)
- **Política de segurança:** [SECURITY.md](SECURITY.md)
- **Código de conduta:** [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Mantenedores e licença

Mantido por **Wilton Gabriel** e **Thales Marques**. Distribuído sob a [Licença MIT](LICENSE).
