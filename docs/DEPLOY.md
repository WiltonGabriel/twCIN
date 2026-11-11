# Guia de Implantação em Servidor (`Docker`, `Linux` e `Windows Server`)

O **twCIN** foi projetado para rodar em **um único processo**, sem banco externo nem compilação em C/C++ (`node:sqlite` nativo), mantendo o código separado do diretório de dados persistentes (`twcin.db`, `.jwt_secret`, `backups/` e `logs/`).

## Onde baixar cada versão

Na aba **[Releases](https://github.com/WiltonGabriel/twCIN/releases)** do GitHub você encontra os artefatos prontos de cada versão junto com `SHA256SUMS.txt`:

- **Docker (`Linux`):** arquivo `docker-compose.yml` + imagem multi-arch em `ghcr.io/wiltongabriel/twcin` (`linux/amd64` e `linux/arm64`).
- **Linux sem Docker:** `twcin-vX.Y.Z-linux-x64.tar.gz` (com runtime Node.js incluído + scripts de serviço `systemd`).
- **Windows / Windows Server:** `twcin-vX.Y.Z-win-x64.zip` (com runtime Node.js + wrapper de serviço `WinSW` .NET 4.0+ incluídos).

---

## 1. Docker (Recomendado para servidores Linux)

### Subindo direto do código ou do Release (`docker compose`)

1. Baixe `docker-compose.yml` do Release (ou clone o repositório):

```bash
docker compose up -d
```

> Se estiver no repositório clonado e quiser compilar localmente antes de existir imagem no registry, execute `docker compose up -d --build`.

2. Acesse no navegador: **`http://<IP-DO-SERVIDOR>:3333`**.
3. O primeiro acesso exibirá o assistente para criar a conta de administrador ou importar um backup `.db`.

### Boas práticas já configuradas no `docker-compose.yml`

- Roda sem privilégios de `root` (`USER node`), com sistema raiz `read_only: true`, `/tmp` em memória e `cap_drop: [ALL]`.
- Dados persistidos exclusivamente no volume nomeado `twcin_data` (`/data`).
- Reinício automático em quedas (`restart: unless-stopped`), rotação de logs (`10m × 5`) e `HEALTHCHECK` verificando o SQLite em `/api/health`.
- Backup automático em `/data/backups` a cada 24h (retendo os últimos 14 arquivos).

### Atualizando no Docker (sem perder dados)

```bash
docker compose pull
docker compose up -d
```

As migrações do SQLite rodam automaticamente na inicialização.

### Habilitando HTTPS interno para instalar PWA em celulares

Para instalar o PWA via navegador em celulares na rede local, navegadores exigem HTTPS. O `docker-compose.yml` inclui um proxy **Caddy** opcional:

```bash
TWCIN_DOMAIN=ti.suaempresa.local COOKIE_SECURE=true TRUST_PROXY=caddy \
  docker compose --profile https up -d
```

---

## 2. Windows Server (Sem precisar de Docker)

Baixe o arquivo **`twcin-vX.Y.Z-win-x64.zip`** da página de **Releases** no GitHub e extraia a pasta no servidor. O pacote oficial já inclui o runtime **Node.js 24 LTS** e o wrapper de serviço **WinSW**, sem precisar instalar dependências na máquina.

### Opção A — Teste / Execução portátil imediata

1. Abra a pasta extraída.
2. Dê dois cliques em **`iniciar-twcin.bat`**.
3. Acesse a URL exibida no console (por padrão `http://localhost:3333`). Se a porta estiver ocupada no computador, o modo portátil usa automaticamente a próxima porta livre (`PORT_AUTO_FALLBACK=true`) para você abrir sem erro.
4. Para encerrar com segurança, pressione **`Ctrl + C`** na janela do terminal.

Todos os dados ficam dentro da subpasta `.\data\` ao lado do script.

### Opção B — Instalar como Serviço nativo do Windows Server (Recomendado)

Para continuar rodando mesmo sem usuário logado, iniciar no boot e reiniciar automaticamente em quedas:

1. Abra o **PowerShell como Administrador** dentro da pasta extraída.
2. Execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\instalar-servico.ps1
```

> Se quiser liberar também o Firewall do Windows na rede Privada/Domínio, adicione `-OpenFirewall`. Se a porta `3333` já estiver ocupada no servidor, o instalador avisa antes de registrar e você pode definir outra com `-Port 3400` (a configuração é salva exclusivamente em `twcin.env`).

**O que o instalador faz sem invadir o sistema:**
- Copia os arquivos do programa para `C:\Program Files\twCIN` (imutável).
- Mantém banco, `.jwt_secret`, `twcin.env`, backups automáticos e logs rotacionados em **`C:\ProgramData\twCIN`** com permissões NTFS restritas a `Administrators`, `SYSTEM` e `NT AUTHORITY\LOCAL SERVICE`.
- Registra o serviço **`twCIN`** rodando sob a conta restrita **`NT AUTHORITY\LocalService`** (sem privilégio de Administrador).

### Como parar, reiniciar, atualizar ou remover no Windows Server

- **Forma rápida (1 clique):** execute **`gerenciar-servico.bat`** para ver o status atual e escolher **Parar**, **Iniciar**, **Reiniciar**, abrir logs ou abrir no navegador.
- **Pelo Windows / PowerShell:** abra `services.msc` e gerencie **`twCIN — Gestão Interna de TI`**, ou execute `Stop-Service twCIN` / `Start-Service twCIN` / `Restart-Service twCIN`.
- **Mudar a porta depois de instalado:** edite `PORT=...` em `C:\ProgramData\twCIN\twcin.env` e reinicie o serviço.
- **Atualizar:** baixe e extraia o novo `.zip` e execute novamente `.\instalar-servico.ps1`. O script para o serviço, substitui apenas `C:\Program Files\twCIN`, preserva 100% dos dados e a porta configurada em `C:\ProgramData\twCIN` e sobe o serviço já migrado.
- **Remover serviço:** execute `.\desinstalar-servico.ps1` (os dados em `C:\ProgramData\twCIN` continuam preservados, a menos que passe `-PurgeData`).

---

## 3. Servidor Linux sem Docker (`systemd`)

Baixe **`twcin-vX.Y.Z-linux-x64.tar.gz`** nos Releases e extraia:

```bash
tar -xzf twcin-v1.0.0-linux-x64.tar.gz
cd twcin-v1.0.0-linux-x64
```

- **Teste rápido:** `./iniciar-twcin.sh` (usa a próxima porta livre automaticamente se `3333` estiver em uso; encerre com `Ctrl + C`).
- **Serviço systemd dedicado:** `sudo ./instalar-linux.sh` (ou `TWCIN_PORT=3400 sudo -E ./instalar-linux.sh` se `3333` estiver ocupada).
  - Programa em `/opt/twcin`, dados e `twcin.env` em `/var/lib/twcin`, rodando sob o usuário de sistema `twcin` com `ProtectSystem=strict` e `NoNewPrivileges=true`.
- **Parar / reiniciar / ver logs:** `sudo systemctl stop twcin`, `sudo systemctl restart twcin`, `sudo systemctl status twcin` e `sudo journalctl -u twcin -f`.
- **Atualizar:** repita `sudo ./instalar-linux.sh` com a nova versão extraída (os dados e a porta em `/var/lib/twcin/twcin.env` são preservados).

---

## 4. Variáveis de ambiente principais

Consulte [backend/.env.example](../backend/.env.example) (copiado como `data/twcin.env` / `C:\ProgramData\twCIN\twcin.env` nos pacotes):

| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `PORT` | `3333` | Porta HTTP do servidor |
| `PORT_AUTO_FALLBACK` | `false` (`true` nos scripts portáteis) | Quando `true`, busca a próxima porta livre se `PORT` estiver ocupada; em serviços, mantenha `false` |
| `DATA_DIR` | `./data` | Pasta onde ficam `twcin.db`, `.jwt_secret` e `backups/` |
| `SERVE_FRONTEND` | `false` (`true` nos pacotes) | Serve o frontend PWA junto à API |
| `AUTO_BACKUP_HOURS` | `24` (em produção) | Intervalo do backup automático em disco (`0` desativa) |
| `AUTO_BACKUP_RETAIN` | `14` | Quantidade máxima de backups automáticos mantidos |
| `COOKIE_SECURE` | `false` | Defina `true` apenas quando publicar atrás de HTTPS |
| `TRUST_PROXY` | `false` | Defina `true` ou IP do proxy reverso (Caddy/Nginx/IIS) |
| `CORS_ORIGIN` | `http://localhost:5173` | Origens extras permitidas (com `SERVE_FRONTEND=true`, acessos pelo mesmo IP/host já são aceitos) |

---

## 5. Limites, Concorrência e Dimensionamento

O **twCIN** usa **Node.js 24+**, **Fastify** e **SQLite em processo único (`node:sqlite`)** — excelente para uso interno de setores de TI sem sobrecarga de infraestrutura externa, dentro dos seguintes limites configurados:

| Recurso | Limite atual | Observação prática |
| :--- | :--- | :--- |
| **Tamanho de payload JSON padrão (`bodyLimit`)** | `3 MB` | Cobre cadastros, sincronização offline em lote e logotipos/fundos convertidos para WebP. |
| **Restauração de backup (`/api/backup/restore*`)** | `50 MB` HTTP / `48 MB` base64 (`~35 MB` arquivo `.db`) | Acima de `~35 MB` em disco, prefira copiar o `.db` parado diretamente no volume/pasta `data/`. |
| **Rate limit global** | `180 req/min` por IP | Atrás de proxy reverso, configure `TRUST_PROXY` para não agrupar todos os clientes no IP do proxy. |
| **Rate limit em rotas sensíveis** | Login: `8/min` · Setup/Backup/Restore inicial: `5/min` · Troca de senha: `10/min` · Restore: `3/min` | Proteção contra força bruta e uso abusivo de CPU/disco (`scrypt` + `VACUUM INTO`). |
| **Paginação da auditoria (`GET /api/audit`)** | Padrão `100` (máx. `500` itens/página) | Navegação por cursor (`before_id`). |
| **Concorrência no SQLite (`WAL`)** | `PRAGMA journal_mode = WAL`, `synchronous = FULL`, `busy_timeout = 5000` (`5 s`) | Leituras ocorrem em paralelo; transações de escrita usam `BEGIN IMMEDIATE`. |

### Dimensionamento recomendado

- **Público ideal:** equipes internas de TI (~5 a 50 técnicos ativos, dezenas de milhares de registros de equipamentos/movimentações) e uso offline eventual com sincronização em lotes.
- **Gargalo esperado sob alta carga:** operações simultâneas de escrita intensiva (centenas de requisições `POST`/`PATCH` concorrentes por segundo) disputarão a fila de escrita única do SQLite (limitada a `5 s` de espera por `busy_timeout`) e não suportam múltiplas réplicas/containers apontando para o mesmo arquivo `.db` (mantenha sempre **1 instância ativa por banco**).
