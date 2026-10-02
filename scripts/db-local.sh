#!/usr/bin/env bash
# Prepara um Postgres local (ou de CI) com o mesmo schema do Supabase para `npm run dev` e `npm run test:db`.
# Uso: DATABASE_ADMIN_URL=postgres://postgres@127.0.0.1:5432/interos npm run db:local
# Depois: DATABASE_URL=postgres://interos_app:local@127.0.0.1:5432/interos
set -euo pipefail
: "${DATABASE_ADMIN_URL:?Defina DATABASE_ADMIN_URL (superusuário do Postgres local)}"
cd "$(dirname "$0")/.."
export PGOPTIONS="-c client_min_messages=warning"
psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -q -f tests/docdb/local-supabase-stub.sql
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "alter role interos_app with login password 'local'"
echo "Banco local pronto. DATABASE_URL=postgres://interos_app:local@<host>:<porta>/<banco>"
