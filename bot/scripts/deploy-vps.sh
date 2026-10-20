#!/usr/bin/env bash
# Exécuté sur le VPS via `ssh bash -s`. Attend IMAGE, DEPLOY_PATH, REGISTRY_USER
# et REGISTRY_TOKEN exportés par le workflow. compose.yaml et .env sont dans DEPLOY_PATH.
set -euo pipefail
: "${IMAGE:?}" "${DEPLOY_PATH:?}" "${REGISTRY_USER:?}" "${REGISTRY_TOKEN:?}"

cd "$DEPLOY_PATH"
[[ -f .env ]] || { echo "Missing $DEPLOY_PATH/.env" >&2; exit 1; }

printf '%s' "$REGISTRY_TOKEN" | docker login ghcr.io -u "$REGISTRY_USER" --password-stdin
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

export APP_IMAGE="$IMAGE"

# Sauvegarde avant migration : les 14 dernières sont conservées.
if docker compose ps --status running --services | grep -qx postgres; then
  mkdir -p backups
  docker compose exec -T postgres pg_dump -U lck_bot lck_bot | gzip > "backups/lck_bot_$(date +%Y%m%d_%H%M%S).sql.gz"
  ls -1t backups/*.sql.gz | tail -n +15 | xargs -r rm --
fi

docker compose pull app
docker compose run --rm app node dist/bot/register-commands.js
docker compose up -d --remove-orphans
docker compose ps
docker image prune -f
echo "$IMAGE" > .deployed-image
