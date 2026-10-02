@AGENTS.md

# Interos

Next.js 16 (App Router) + TypeScript + Tailwind v4 + Supabase (Postgres + Auth), deploy na Vercel.

## Convenções

- Código e comentários em português; nomes de identificadores em inglês.
- Supabase no navegador somente via `src/lib/supabase/client.ts`, e só para autenticação. Dados nunca são lidos do cliente.
- Acesso a dados só no servidor (`src/server/db.ts` / `src/server/docdb.ts`), com `DATABASE_URL` (sem prefixo `NEXT_PUBLIC_`).
- Toda nova coleção exige migration em `supabase/migrations/` (`select interos.create_doc_table('<nome>');`), aplicada no Supabase antes do deploy. O schema `interos` nunca é exposto a `anon`/`authenticated`.
- Antes de abrir PR: `npm run lint && npm run typecheck && npm test && npm run check:access && npm run build` (e `npm run test:db` se mexer em `docdb`/migrations).
- Autorização: toda `page.tsx` nova chama `requireScreen`; toda server action nova chama `requirePermission`; toda tela/seção/ação nova entra no catálogo `src/domain/permissions` (ver "Autorização" em `docs/arquitetura.md`).
- Variáveis de ambiente novas entram em `.env.example` com comentário explicando o uso.
