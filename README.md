# twCIN

![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003B57?logo=sqlite&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-Offline--First-5A0FC8)
![Licença](https://img.shields.io/badge/Licen%C3%A7a-MIT-blue.svg)

Aplicação web progressiva (PWA) offline-first para gestão interna do setor de TI, controle de equipamentos sob custódia, movimentações, empréstimos e instalações.

## O que o projeto faz

O **twCIN** oferece à equipe de TI um ambiente único para controlar equipamentos sob responsabilidade do setor (**Equipamentos**), registrar empréstimos e instalações para outros setores (**Movimentações**), acompanhar o dia a dia e os indicadores (**Início**) e administrar cadastros, equipe e dados (**Configurações**), sem depender de portal de chamados para usuários finais.

## Por que ele é útil

- **Visão rápida (`Início`):** busca unificada, empréstimos atrasados e vencendo, equipamentos em manutenção/avaliação, o que está emprestado agora e, na aba **Indicadores**, os gráficos do acervo e das movimentações.
- **Gestão de equipamentos (`Equipamentos`):** tabela com situação e "onde está" de cada item; distingue itens próprios, estoque e equipamentos de terceiros/outros setores, que podem ser **devolvidos ao dono** com histórico preservado.
- **Movimentações com regras (`Movimentações`):** escolha do equipamento pelo catálogo (nome + patrimônio + situação), prazo de devolução com prazo padrão configurável, confirmação de devolução, instalação fixa que pode ser desfeita, histórico, trilha de registros e PDF com termo de entrega.
- **Situação sempre coerente:** a saída marca o equipamento como Emprestado (ou Em uso na instalação fixa) e a devolução como Disponível; equipamentos em manutenção, avaliação, descartados ou já fora não podem sair.
- **Auditoria imutável:** todos os registros são rastreados em `audit_logs` com snapshots antes/depois, consultáveis em **Configurações → Auditoria** com filtros e paginação.
- **PWA offline-first com sincronização:** instalável em computador e celular, dados em `IndexedDB` (Dexie), fila offline por usuário com idempotência por `client_uuid`, detecção de conflitos por `version` e tela de **pendências de sincronização** para reaplicar ou descartar o que o servidor recusou.
- **Segurança por padrão:** senhas com `scrypt`, sessão em cookie JWT `HttpOnly` revogada no logout, "sair de todos os dispositivos", troca obrigatória de senha no primeiro acesso, validação com Zod, `@fastify/helmet` e `@fastify/rate-limit`.
- **Configurações organizadas:** Pessoal (minha conta, preferências), Sistema (organização, cadastros de setores e locais, regras de empréstimo, equipe) e Dados (sincronização, auditoria, exportação CSV e backup do banco, aplicativo).
## Primeiros passos

### Pré-requisitos

- **Node.js `24.x`** ou superior (utiliza o módulo nativo `node:sqlite`, sem necessidade de compilação C++)
- **npm `10+`**

### Instalação

```bash
git clone https://github.com/WiltonGabriel/twCIN.git
cd twCIN

npm --prefix backend install
npm --prefix frontend install
```

### Configuração (opcional)

Por padrão, o backend armazena o banco SQLite em `backend/data/twcin.db` e gera uma chave local persistente em `backend/data/.jwt_secret`. Para personalizar variáveis de ambiente em implantação, copie o arquivo de exemplo:

```bash
cp backend/.env.example backend/.env
```

### Executando localmente

Inicie simultaneamente a API Fastify (`http://localhost:3333`) e o frontend Vite PWA (`http://localhost:5173`):

```bash
npm run dev
```

No Windows PowerShell (caso a política de execução bloqueie scripts `.ps1`), execute `npm.cmd run dev` ou `node scripts/dev.mjs`.

### Primeiro acesso (Setup inicial)

Ao iniciar com o banco de dados vazio (sem usuários cadastrados), abra `http://localhost:5173` no navegador para criar a primeira conta da equipe de TI e definir o nome da organização na própria tela inicial.

### Testes e build de produção

```bash
# Verificação de tipos do backend
npm --prefix backend run typecheck

# Suite automatizada de testes do backend
npm test

# Build de produção do backend e do frontend PWA
npm run build
```

> **Nota para uso em rede local / celular (PWA):** Navegadores móveis exigem `localhost` ou **HTTPS** para habilitar o Service Worker e a instalação do PWA. Para instalação em celulares da rede, publique o build `frontend/dist` com proxy reverso para `/api` atrás de HTTPS (por exemplo, Caddy ou Nginx). Nesse cenário, defina `TRUST_PROXY` no `backend/.env` (por exemplo, `TRUST_PROXY=127.0.0.1`, o IP do proxy) para que o backend enxergue o IP real de cada cliente; sem isso, o rate limit de login passa a ser compartilhado por todos os usuários. Não habilite `TRUST_PROXY` se o backend recebe conexões diretas, pois o cabeçalho `X-Forwarded-For` poderia ser forjado.

## Estrutura do projeto

```text
twCIN/
├── backend/              # API REST Fastify, schema SQLite, auth, sync e testes
├── frontend/             # React 19 + TypeScript + Tailwind + Vite PWA
├── docs/                 # Documentação complementar
├── scripts/dev.mjs       # Executor local multi-processo
├── CONTRIBUTING.md       # Guia de contribuição
└── LICENSE               # Licença MIT
```

## Onde obter ajuda

- **Referência da API:** [docs/API.md](docs/API.md)
- **Diretrizes de contribuição:** [CONTRIBUTING.md](CONTRIBUTING.md)
- **Relato de bugs e melhorias:** Abra uma issue na aba *Issues* do repositório no GitHub.

## Mantenedores e contribuição

Mantido por **Wilton Pereira** e **Thales**.

Contribuições são bem-vindas — consulte [CONTRIBUTING.md](CONTRIBUTING.md) antes de enviar um pull request. Distribuído sob a [Licença MIT](LICENSE).
