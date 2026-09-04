#!/usr/bin/env bash
set -euo pipefail

IMAGE_URI="${1:?Error: IMAGE_URI argument is required}"
CONTAINER_NAME="${2:-snipsik-bot}"
GAR_LOCATION="${3:-us-central1}"
ENV_FILE="${HOME}/snipsik/.env"

echo "=========================================="
echo "Starting deployment for ${CONTAINER_NAME}"
echo "Image: ${IMAGE_URI}"
echo "=========================================="

echo "==> 1. Checking prerequisites..."
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: Environment file ${ENV_FILE} does not exist on VM!" >&2
  exit 1
fi

echo "==> 2. Configuring Artifact Registry auth on VM..."
gcloud auth configure-docker "${GAR_LOCATION}-docker.pkg.dev" --quiet

echo "==> 3. Pulling target image (${IMAGE_URI})..."
docker pull "$IMAGE_URI"

echo "==> 4. Preparing container switch..."
BACKUP_CONTAINER="${CONTAINER_NAME}-backup"
docker rm -f "$BACKUP_CONTAINER" 2>/dev/null || true

HAS_OLD=0
if docker ps -a --format '{{.Names}}' | grep -Eq "^${CONTAINER_NAME}\$"; then
  HAS_OLD=1
  echo "Backing up existing container to ${BACKUP_CONTAINER}..."
  docker rename "$CONTAINER_NAME" "$BACKUP_CONTAINER"
  docker stop "$BACKUP_CONTAINER" || true
fi

echo "==> 5. Starting new container..."
if ! docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --env-file "$ENV_FILE" \
  "$IMAGE_URI"; then
  echo "Error: docker run failed! Rolling back..." >&2
  if [ "$HAS_OLD" -eq 1 ]; then
    docker start "$BACKUP_CONTAINER" || true
    docker rename "$BACKUP_CONTAINER" "$CONTAINER_NAME" || true
  fi
  exit 1
fi

echo "==> 6. Verifying container health..."
sleep 5
IS_RUNNING=$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || echo "false")
if [ "$IS_RUNNING" != "true" ]; then
  echo "Error: Container exited unexpectedly! Logs:" >&2
  docker logs --tail 30 "$CONTAINER_NAME" >&2 || true
  echo "Rolling back to previous container..." >&2
  docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
  if [ "$HAS_OLD" -eq 1 ]; then
    docker start "$BACKUP_CONTAINER" || true
    docker rename "$BACKUP_CONTAINER" "$CONTAINER_NAME" || true
    echo "Rollback complete." >&2
  fi
  exit 1
fi

# Clean up backup container after successful deployment
if [ "$HAS_OLD" -eq 1 ]; then
  docker rm -f "$BACKUP_CONTAINER" 2>/dev/null || true
fi

echo "==> 7. Cleaning up dangling images..."
docker image prune -f

echo "==> 8. Deployment succeeded! Container status:"
docker ps --filter "name=${CONTAINER_NAME}"
