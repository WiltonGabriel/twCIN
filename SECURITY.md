# Política de Segurança

## Versões suportadas

| Versão | Suporte de segurança |
| :--- | :--- |
| `1.1.x` | Suportada |
| `< 1.1.0` | Atualizar para `1.1.x` |

## Como reportar uma vulnerabilidade

**Não abra uma Issue pública** para relatar falhas de segurança, credenciais expostas ou problemas de autenticação/autorização.

Em vez disso:

1. Utilize a aba **Security → Advisories → Report a vulnerability** diretamente no repositório do GitHub; ou
2. Entre em contato diretamente com os mantenedores por canal privado antes de qualquer divulgação pública.

Inclua na mensagem:

- Descrição objetiva do problema e impacto potencial;
- Passos para reproduzir em ambiente controlado;
- Versão ou tag afetada e método de implantação (Docker, Windows Server ou Linux).

## Boas práticas recomendadas em produção

- Defina um `JWT_SECRET` forte (mínimo de 32 caracteres aleatórios) ou preserve o `.jwt_secret` gerado em diretório restrito.
- Habilite `COOKIE_SECURE=true` e `TRUST_PROXY` adequado quando publicar o serviço atrás de HTTPS/proxy reverso.
- Restrinja o acesso à pasta de dados (`C:\ProgramData\twCIN`, `/var/lib/twcin` ou volume Docker) e aos arquivos de backup `.db`.
