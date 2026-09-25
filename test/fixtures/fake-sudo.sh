#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = -n ]; then shift; fi
if [ "${1:-}" = gcloud ] && [ "${MOCK_SUDO_GCLOUD_FAIL:-0}" = 1 ]; then exit 1; fi
MOCK_AS_SUDO=1 exec "$@"
