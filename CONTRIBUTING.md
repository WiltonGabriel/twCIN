# Contribuindo com o twCIN

Obrigado pelo interesse em contribuir com o **twCIN**.

## Ambiente de desenvolvimento

1. Certifique-se de ter **Node.js 24+** (com suporte nativo a `node:sqlite`) e **npm** instalados.
2. Instale as dependências de ambos os pacotes:

```bash
npm --prefix backend install
npm --prefix frontend install
```

3. Inicie os servidores de desenvolvimento:

```bash
npm run dev
```

No Windows PowerShell com restrição para scripts `.ps1`, use `npm.cmd run dev`.

## Verificações de qualidade

Antes de abrir um pull request, garanta que a checagem de tipos, os testes automatizados e o build passem sem erros:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e   # requer Chrome/Chromium/Edge instalado
```

## Diretrizes

- Mantenha toda a interface e documentação objetivas, diretas e consistentes em português (pt-BR).
- Nunca faça commit de arquivos `.env`, bancos `.db`, segredos ou logotipos/dados específicos de uma instituição privada.
- Adicione ou atualize testes automatizados em `backend/tests/` para qualquer alteração na API ou no banco de dados.
- Valide todos os novos payloads com schemas Zod e preserve o registro de auditoria em `audit_logs`.
