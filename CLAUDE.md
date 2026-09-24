@AGENTS.md

# Interos

Next.js 16 (App Router) + TypeScript + Tailwind v4 + Firebase, deploy na Vercel.

## Convenções

- Código e comentários em português; nomes de identificadores em inglês.
- Firebase no cliente somente via `src/lib/firebase/client.ts`. Nunca instancie o SDK direto em componentes.
- Acesso privilegiado (Admin SDK) fica em código de servidor e usa credenciais sem o prefixo `NEXT_PUBLIC_`.
- Toda nova coleção do Firestore exige regra explícita em `firestore.rules`. A regra padrão é negar.
- Antes de abrir PR: `npm run lint && npm run typecheck && npm run build`.
- Variáveis de ambiente novas entram em `.env.example` com comentário explicando o uso.
