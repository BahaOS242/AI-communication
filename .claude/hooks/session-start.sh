#!/bin/bash
# Prepares a Claude Code cloud session: dependencies, local Postgres, migrations.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "$CLAUDE_PROJECT_DIR"

npm install --no-audit --no-fund >/dev/null

DB_URL="postgresql://postgres:postgres@localhost:5432/agentforge"
if command -v service >/dev/null && [ -d /usr/lib/postgresql ]; then
  service postgresql start >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do pg_isready -q && break; sleep 0.5; done
  su postgres -c "psql -qc \"ALTER USER postgres PASSWORD 'postgres';\"" >/dev/null 2>&1 || true
  su postgres -c "createdb agentforge" >/dev/null 2>&1 || true
  DATABASE_URL="$DB_URL" npx prisma migrate deploy >/dev/null
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export DATABASE_URL=\"$DB_URL\"" >> "$CLAUDE_ENV_FILE"
  fi
fi
