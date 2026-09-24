# Interos

Aplicação web construída com Next.js (App Router), TypeScript, Tailwind CSS e Firebase, publicada na Vercel.

## Infraestrutura

| Serviço  | Recurso                                   | Observação                                                    |
| -------- | ----------------------------------------- | ------------------------------------------------------------- |
| GitHub   | `martinsphilippes/interos`                | Branch padrão `main`. CI roda lint, typecheck e build.        |
| Vercel   | Projeto `interos`, time `martinsphilippes` | Deploy automático a cada push. Preview por branch/PR.         |
| Firebase | Projeto `interos-crm`, Auth e Firestore   | Regras versionadas em `firestore.rules`. Storage exige plano Blaze. |

## Primeiros passos

```bash
npm install
cp .env.example .env.local   # preencha com os dados do console do Firebase
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
| `npm run firebase:emulators`   | Sobe Auth, Firestore e Storage locais (requer `firebase-tools`) |
| `npm run firebase:deploy:rules`| Publica regras e índices do Firestore no projeto Firebase        |

## Variáveis de ambiente

Todas as chaves estão documentadas em `.env.example`. As variáveis `NEXT_PUBLIC_*` são embutidas no bundle do navegador em tempo de build, portanto:

- só coloque nelas valores que podem ser públicos (a config web do Firebase é pública por design; a segurança vem das regras);
- cadastre as mesmas chaves na Vercel em **Settings > Environment Variables**, para os ambientes Production e Preview;
- qualquer segredo de servidor (service account, chaves de API privadas) fica **sem** o prefixo `NEXT_PUBLIC_`.

## Firebase

1. Crie ou selecione o projeto no [console do Firebase](https://console.firebase.google.com/).
2. Adicione um app Web e copie a configuração para `.env.local`.
3. Ative os provedores de Auth desejados.
4. Em **Authentication > Settings > Authorized domains**, adicione `localhost`, o domínio `*.vercel.app` do projeto e o domínio final.
5. O projeto já está vinculado em `.firebaserc` (`interos-crm`). Para publicar regras:

```bash
npx firebase-tools login
npm run firebase:deploy:rules
```

O Storage fica fora do `firebase.json` até o projeto migrar para o plano Blaze, exigido pelo Cloud Storage for Firebase. As regras já estão prontas em `storage.rules`; ao ativar o Blaze, crie o bucket no console e adicione `"storage": { "rules": "storage.rules" }` ao `firebase.json`.

As regras iniciais negam tudo por padrão e liberam apenas o documento do próprio usuário em `users/{uid}`. Amplie por coleção conforme o domínio evoluir, sempre testando nos emuladores.

## Estrutura

```
src/
  app/                 rotas (App Router)
    api/health/        health check
  lib/
    firebase/          config validada + SDK do cliente (lazy singleton)
firebase.json          emuladores e apontamento das regras
firestore.rules        regras do Firestore
storage.rules          regras do Storage
.github/workflows/     CI
```

## Fluxo de trabalho

- Desenvolva em branches e abra PR para `main`.
- Cada PR gera um preview na Vercel e roda o CI.
- Merge em `main` publica em produção.
