## Resumo

<!-- Descreva de forma objetiva o problema resolvido ou a funcionalidade adicionada. -->

## Tipo de alteração

- [ ] Correção de bug (`fix`)
- [ ] Nova funcionalidade (`feat`)
- [ ] Implantação / Docker / Serviços (`deploy`)
- [ ] Documentação (`docs`)
- [ ] Refatoração / testes (`refactor` / `test`)

## Checklist antes de pedir revisão

- [ ] `npm run typecheck` passa sem erros
- [ ] `npm test` passa sem erros (testes novos ou atualizados quando aplicável)
- [ ] `npm run build` compila backend e frontend PWA sem erros
- [ ] Payloads novos/alterados validados com Zod e eventos críticos gravados em `audit_logs` (se aplicável)
- [ ] Documentação atualizada (`README.md`, `CHANGELOG.md`, `docs/API.md` e/ou `docs/DEPLOY.md`, se aplicável)
- [ ] Nenhum arquivo `.env`, banco `.db`, segredo ou dado sensível incluído no diff
