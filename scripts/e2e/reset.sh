#!/usr/bin/env bash
# A fresh ladder, the walks' people, and PostgREST told to re-read the schema.
# Local only — `rebuild.sh` refuses anything else.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
"$HERE/../../supabase/local/rebuild.sh" >/dev/null 2>&1
psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-5433}" -U postgres -q -v ON_ERROR_STOP=1 -f "$HERE/seed-procurement.sql"
psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-5433}" -U postgres -q -v ON_ERROR_STOP=1 -f "$HERE/seed-hr.sql"
psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-5433}" -U postgres -q -At -v ON_ERROR_STOP=1 -f "$HERE/seed-inventory.sql" >/dev/null
psql -h "${PGHOST:-/tmp}" -p "${PGPORT:-5433}" -U postgres -q -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if; end \$\$; grant anon, authenticated, service_role to authenticator; notify pgrst, 'reload schema';"
echo "reset: ladder rebuilt, walk seeded"
