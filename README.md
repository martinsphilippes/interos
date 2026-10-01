# Interos

Aplicação web construída com Next.js (App Router), TypeScript, Tailwind CSS e Supabase (Postgres + Auth), publicada na Vercel.

## Infraestrutura

| Serviço  | Recurso                                   | Observação                                                    |
| -------- | ----------------------------------------- | ------------------------------------------------------------- |
| GitHub   | `martinsphilippes/interos`                | Branch padrão `main`. CI roda lint, typecheck e build.        |
| Vercel   | Projeto `interos`, time `martinsphilippes` | Deploy automático a cada push. Funções em `gru1` (São Paulo). |
| Supabase | Projeto `interos-prod` (`sa-east-1`), Postgres + Auth | Schema versionado em `supabase/migrations/`. Dados só pelo servidor. |

## Primeiros passos

```bash
npm install
cp .env.example .env.local   # preencha Supabase, DATABASE_URL e SESSION_COOKIE_SECRET
npm run dev
```

Abra http://localhost:3000. A página inicial mostra o estado da configuração e `/api/health` retorna um JSON com o mesmo diagnóstico.

## Scripts

| Comando                        | O que faz                                                        |
| ------------------------------ | ---------------------------------------------------------------- |
| `npm run dev`                  | Servidor de desenvolvimento                                      |
| `npm run build`                | Build de produção                                                |
| `npm run lint`                 | ESLint                                                           |
| `npm run typecheck`            | Verificação de tipos sem emitir arquivos                         |
| `npm test`                     | Testes unitários (vitest)                                        |
| `npm run test:db`              | Testes de integração do banco (Postgres local, ver abaixo)       |
| `npm run db:local`             | Aplica o schema num Postgres local (`DATABASE_ADMIN_URL`)        |
| `npm run seed`                 | Recria os dados de demonstração (apaga os da organização)        |

## Variáveis de ambiente

Todas as chaves estão documentadas em `.env.example`. As variáveis `NEXT_PUBLIC_*` são embutidas no bundle do navegador em tempo de build, portanto:

- só coloque nelas valores que podem ser públicos (URL e chave publicável do Supabase são públicas por design; o schema de dados não é exposto pela Data API);
- cadastre as mesmas chaves na Vercel em **Settings > Environment Variables**, para os ambientes Production e Preview;
- qualquer segredo de servidor (`DATABASE_URL`, `SESSION_COOKIE_SECRET`, chaves de API privadas) fica **sem** o prefixo `NEXT_PUBLIC_`.

## Supabase

- **Dados:** uma tabela por coleção no schema `interos` (`id`, `data jsonb`), criadas por `supabase/migrations/`. O schema não é exposto pela Data API e tem RLS com acesso só para o papel `interos_app`, usado pelo servidor via `DATABASE_URL` (pooler, porta 6543). `src/server/docdb.ts` oferece a mesma API do Firestore Admin que o sistema usava.
- **Coleção nova:** adicione em `COLLECTIONS` e crie uma migration com `select interos.create_doc_table('<nome>');`. Aplique no Supabase (painel → SQL Editor, CLI `supabase db push` ou MCP) **antes** do deploy.
- **Auth:** e-mail/senha e Microsoft (provedor Azure). O navegador só autentica; o servidor troca o token pelo cookie `interos_session`. Logins são geridos pelo INTEROS (Admin → Usuários) via funções SQL restritas.
- **Configuração no painel do Supabase** (Authentication):
  - *URL Configuration*: Site URL = domínio de produção; Redirect URLs com `https://<domínio>/**`, `https://*-martinsphilippes.vercel.app/**` e `http://localhost:3000/**` (links de redefinição de senha e retorno do login Microsoft).
  - *Emails → SMTP*: configure um SMTP próprio (ex.: Resend). O SMTP padrão do Supabase só entrega para membros da equipe do projeto e tem limite baixo por hora: sem SMTP próprio, "Esqueci minha senha" e "Ativar minha conta" não chegam aos usuários.

### Banco local

```bash
# Postgres 15+ rodando localmente
DATABASE_ADMIN_URL=postgres://postgres@127.0.0.1:5432/interos npm run db:local
echo 'DATABASE_URL=postgres://interos_app:local@127.0.0.1:5432/interos' >> .env.local
npm run seed
DATABASE_ADMIN_URL=postgres://postgres@127.0.0.1:5432/interos DATABASE_URL=postgres://interos_app:local@127.0.0.1:5432/interos npm run test:db
```

## Estrutura

```
src/
  app/                 rotas (App Router)
    api/health/        health check
  lib/
    supabase/          config validada + cliente de Auth do navegador (lazy singleton)
  server/
    db.ts, docdb.ts    acesso a dados (somente servidor)
supabase/migrations/   schema do banco
.github/workflows/     CI
```

## Fluxo de trabalho

- Desenvolva em branches e abra PR para `main`.
- Cada PR gera um preview na Vercel e roda o CI.
- Merge em `main` publica em produção.
