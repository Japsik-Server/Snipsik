#!/usr/bin/env bash
set -euo pipefail

IMAGE_URI="${1:?Error: IMAGE_URI argument is required}"
CONTAINER_NAME="${2:-snipsik-bot}"
GAR_LOCATION="${3:-us-central1}"
ENV_FILE="${4:-$HOME/snipsik/.env}"
ENV_FILE="${ENV_FILE/#\~/$HOME}"

echo "=========================================="
echo "Starting deployment for ${CONTAINER_NAME}"
echo "Image: ${IMAGE_URI}"
echo "Env file: ${ENV_FILE}"
echo "=========================================="

echo "==> 1. Checking prerequisites..."
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: Environment file not found at ${ENV_FILE}!" >&2
  exit 1
fi
chmod 600 "$ENV_FILE" 2>/dev/null || true
echo "Environment file verified: $ENV_FILE"

echo "==> 2. Detecting Docker permissions..."
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  if sudo -n docker info >/dev/null 2>&1; then
    echo "Notice: Non-root user lacks docker group permission. Using 'sudo docker'."
    DOCKER="sudo docker"
    sudo usermod -aG docker "$USER" 2>/dev/null || true
  else
    echo "Error: Cannot access Docker daemon (neither as $USER nor via passwordless sudo)." >&2
    exit 1
  fi
fi

echo "==> 3. Configuring Artifact Registry auth on VM..."
gcloud auth configure-docker "${GAR_LOCATION}-docker.pkg.dev" --quiet
if [ "$DOCKER" = "sudo docker" ]; then
  sudo gcloud auth configure-docker "${GAR_LOCATION}-docker.pkg.dev" --quiet 2>/dev/null || true
fi

echo "==> 4. Pulling target image (${IMAGE_URI})..."
$DOCKER pull "$IMAGE_URI"

echo "==> 5. Preparing container switch..."
BACKUP_CONTAINER="${CONTAINER_NAME}-backup"

HAS_PRIMARY=0
if $DOCKER container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  HAS_PRIMARY=1
fi

HAS_BACKUP=0
if $DOCKER container inspect "$BACKUP_CONTAINER" >/dev/null 2>&1; then
  HAS_BACKUP=1
fi

HAS_OLD=0
if [ "$HAS_PRIMARY" -eq 1 ]; then
  # Remove previous leftover backup only when primary container is available to be backed up
  $DOCKER rm -f "$BACKUP_CONTAINER" 2>/dev/null || true
  echo "Backing up existing container to ${BACKUP_CONTAINER}..."
  $DOCKER rename "$CONTAINER_NAME" "$BACKUP_CONTAINER"
  $DOCKER stop "$BACKUP_CONTAINER" || true
  HAS_OLD=1
elif [ "$HAS_BACKUP" -eq 1 ]; then
  # Preserve leftover backup as rollback target if primary container is missing
  echo "Warning: No primary container found, but found existing backup container. Preserving as rollback target."
  $DOCKER stop "$BACKUP_CONTAINER" || true
  HAS_OLD=1
fi

echo "==> 6. Starting new container..."
if ! $DOCKER run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --env-file "$ENV_FILE" \
  "$IMAGE_URI"; then
  echo "Error: docker run failed! Rolling back..." >&2
  if [ "$HAS_OLD" -eq 1 ]; then
    $DOCKER start "$BACKUP_CONTAINER" || true
    $DOCKER rename "$BACKUP_CONTAINER" "$CONTAINER_NAME" || true
  fi
  exit 1
fi

echo "==> 7. Verifying container health..."
sleep 5
IS_RUNNING=$($DOCKER inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || echo "false")
if [ "$IS_RUNNING" != "true" ]; then
  echo "Error: Container exited unexpectedly! Logs:" >&2
  $DOCKER logs --tail 30 "$CONTAINER_NAME" >&2 || true
  echo "Rolling back to previous container..." >&2
  $DOCKER rm -f "$CONTAINER_NAME" 2>/dev/null || true
  if [ "$HAS_OLD" -eq 1 ]; then
    $DOCKER start "$BACKUP_CONTAINER" || true
    $DOCKER rename "$BACKUP_CONTAINER" "$CONTAINER_NAME" || true
    echo "Rollback complete." >&2
  fi
  exit 1
fi

# Clean up backup container after successful deployment
if [ "$HAS_OLD" -eq 1 ]; then
  $DOCKER rm -f "$BACKUP_CONTAINER" 2>/dev/null || true
fi

echo "==> 8. Cleaning up dangling images..."
$DOCKER image prune -f

echo "==> 9. Deployment succeeded! Container status:"
$DOCKER ps --filter "name=${CONTAINER_NAME}"
