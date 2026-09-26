#!/usr/bin/env bash
set -euo pipefail

IMAGE_URI="${1:?IMAGE_URI is required}"
CONTAINER_NAME="${2:-snipsik-bot}"
GAR_LOCATION="${3:-us-central1}"
ENV_FILE="${4:-/opt/snipsik/.env}"
ENV_FILE="${ENV_FILE/#\~/$HOME}"
BACKUP="${CONTAINER_NAME}-backup"
CANDIDATE="${CONTAINER_NAME}-candidate"
DOCKER=(docker)
SWITCH_STARTED=0
COMPLETE=0

dcmd() { "${DOCKER[@]}" "$@"; }
exists() { dcmd container inspect "$1" >/dev/null 2>&1; }
running() { [ "$(dcmd inspect -f '{{.State.Running}}' "$1" 2>/dev/null || :)" = true ]; }
healthy() {
  local status
  running "$1" || return 1
  status="$(dcmd inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$1" 2>/dev/null || :)"
  [ "$status" = healthy ] || { [ "${2:-}" = allow-missing ] && [ "$status" = missing ]; }
}

restore_backup() {
  echo "==> Restoring previous container..." >&2
  if exists "$BACKUP"; then
    if exists "$CONTAINER_NAME"; then dcmd rm -f "$CONTAINER_NAME" || return 1; fi
    dcmd rename "$BACKUP" "$CONTAINER_NAME" || return 1
    dcmd start "$CONTAINER_NAME" || return 1
    echo "Recovery complete: previous container is running." >&2
  elif exists "$CONTAINER_NAME" && ! running "$CONTAINER_NAME"; then
    dcmd start "$CONTAINER_NAME" || return 1
    echo "Recovery complete: stopped primary restarted." >&2
  fi
  if exists "$CANDIDATE"; then dcmd rm -f "$CANDIDATE" || return 1; fi
}

on_exit() {
  local result=$?
  trap - EXIT INT TERM HUP
  if [ "$COMPLETE" -ne 1 ] && [ "$SWITCH_STARTED" -eq 1 ]; then
    echo "Deployment interrupted or failed (exit=$result); restoring service." >&2
    restore_backup || echo "Recovery failed; rerun deploy.sh to retry recovery." >&2
  fi
  exit "$result"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

echo "==> Validating deployment prerequisites..."
[ -f "$ENV_FILE" ] || { echo "Environment file missing: $ENV_FILE" >&2; exit 1; }
if ! docker info >/dev/null 2>&1; then
  sudo -n docker info >/dev/null 2>&1 || { echo "Docker daemon unavailable" >&2; exit 1; }
  DOCKER=(sudo docker)
fi

# A prior SIGKILL or VM interruption can leave a stopped primary, backup, or
# unstarted candidate. Restore the old instance before doing any new work.
if exists "$BACKUP"; then
  if exists "$CONTAINER_NAME" && healthy "$CONTAINER_NAME" allow-missing; then
    echo "==> Previous switch finished; healthy primary retained."
    if ! dcmd rm -f "$BACKUP"; then
      echo "Could not remove stale backup; active container remains running. Retry after Docker can remove it." >&2
      exit 1
    fi
  else
    echo "==> Recovering interrupted switch from backup."
    restore_backup
  fi
elif exists "$CONTAINER_NAME" && ! running "$CONTAINER_NAME"; then
  echo "==> Restarting stopped primary after interrupted switch."
  dcmd start "$CONTAINER_NAME"
fi
if exists "$CANDIDATE"; then dcmd rm -f "$CANDIDATE"; fi

echo "==> Configuring registry and pulling $IMAGE_URI..."
gcloud auth configure-docker "${GAR_LOCATION}-docker.pkg.dev" --quiet
if [ "${DOCKER[0]}" = sudo ]; then
  sudo gcloud auth configure-docker "${GAR_LOCATION}-docker.pkg.dev" --quiet 2>/dev/null ||
    echo "Root registry configuration failed; trying the existing Docker credentials." >&2
fi
dcmd pull "$IMAGE_URI"

# Run the preflight in the target image before stopping the active bot.
echo "==> Checking required database schema..."
dcmd run --rm --env-file "$ENV_FILE" --entrypoint bun "$IMAGE_URI" run dist/db/checkSchema.js

echo "==> Creating candidate container..."
dcmd create --name "$CANDIDATE" --restart unless-stopped --env-file "$ENV_FILE" "$IMAGE_URI" >/dev/null
SWITCH_STARTED=1

if exists "$CONTAINER_NAME"; then
  echo "==> Stopping current bot and preserving backup..."
  dcmd stop "$CONTAINER_NAME" >/dev/null
  dcmd rename "$CONTAINER_NAME" "$BACKUP"
fi
dcmd rename "$CANDIDATE" "$CONTAINER_NAME"
dcmd start "$CONTAINER_NAME" >/dev/null

echo "==> Waiting for Discord, database, and cache readiness..."
for ((attempt=1; attempt<=30; attempt++)); do
  if healthy "$CONTAINER_NAME"; then
    echo "New container is healthy."
    previous_image=""
    if exists "$BACKUP"; then
      previous_image="$(dcmd inspect -f '{{.Config.Image}}' "$BACKUP")"
    fi
    COMPLETE=1
    if exists "$BACKUP" && ! dcmd rm -f "$BACKUP"; then
      echo "Could not remove backup container; it will be cleaned up on the next deployment." >&2
      previous_image=""
    fi
    if [ -n "$previous_image" ] && [ "$previous_image" != "$IMAGE_URI" ]; then
      dcmd image rm "$previous_image" || echo "Could not remove previous image: $previous_image" >&2
    fi
    dcmd image prune -f || echo "Could not prune dangling images." >&2
    echo "Deployment succeeded with one running bot."
    exit 0
  fi
  if ! running "$CONTAINER_NAME"; then
    echo "Candidate exited before readiness." >&2
    dcmd logs --tail 30 "$CONTAINER_NAME" >&2 || true
    exit 1
  fi
  echo "Readiness pending ($attempt/30)..."
  sleep 2
done
echo "Readiness timed out; rolling back." >&2
dcmd logs --tail 30 "$CONTAINER_NAME" >&2 || true
exit 1
