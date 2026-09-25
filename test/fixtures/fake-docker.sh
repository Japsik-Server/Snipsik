#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$MOCK_DOCKER_STATE/commands"

state() { echo "$MOCK_DOCKER_STATE/$1"; }
read_state() { IFS='|' read -r image running health < "$(state "$1")"; }
write_state() { printf '%s|%s|%s\n' "$image" "$running" "$health" > "$(state "$1")"; }
interrupt_at() {
  if [ "${MOCK_KILL_AT:-}" = "$1" ] && [ ! -e "$MOCK_DOCKER_STATE/killed" ]; then
    touch "$MOCK_DOCKER_STATE/killed"
    kill -KILL "$PPID"
  fi
}

case "${1:-}" in
  info)
    if [ "${MOCK_REQUIRE_SUDO:-0}" = 1 ] && [ "${MOCK_AS_SUDO:-0}" != 1 ]; then exit 1; fi
    exit 0
    ;;
  pull) exit 0 ;;
  container)
    [ "$2" = inspect ] && [ -e "$(state "$3")" ]
    ;;
  inspect)
    format="$3"
    name="$4"
    [ -e "$(state "$name")" ] || exit 1
    read_state "$name"
    case "$format" in
      *State.Running*) echo "$running" ;;
      *State.Health*) if [ "$health" = none ]; then echo missing; else echo "$health"; fi ;;
      *State.Status*) if [ "$running" = true ]; then echo running; else echo exited; fi ;;
      *Config.Image*) echo "$image" ;;
    esac
    ;;
  run)
    [ "${!#}" = dist/db/checkSchema.js ] || exit 2
    [ "${MOCK_SCHEMA_FAIL:-0}" = 0 ]
    ;;
  create)
    name="$3"
    image="${!#}"
    running=false
    health=starting
    write_state "$name"
    ;;
  stop)
    name="$2"
    read_state "$name"
    running=false
    write_state "$name"
    interrupt_at stop
    ;;
  rename)
    if [ "${MOCK_FAIL_RESTORE_RENAME:-0}" = 1 ] && [ "$2" = snipsik-bot-backup ]; then exit 1; fi
    mv "$(state "$2")" "$(state "$3")"
    if [ "$3" = snipsik-bot-backup ]; then interrupt_at rename-backup; fi
    if [ "$3" = snipsik-bot ]; then interrupt_at rename-primary; fi
    ;;
  start)
    name="$2"
    read_state "$name"
    running=true
    if [ "$image" = new-image ]; then
      health="${MOCK_NEW_HEALTH:-healthy}"
    else
      health=healthy
    fi
    write_state "$name"
    if [ "$image" = new-image ]; then interrupt_at start-new; fi
    ;;
  rm)
    if [ "$2" = -f ]; then name="$3"; else name="$2"; fi
    if [ "${MOCK_FAIL_BACKUP_REMOVE:-0}" = 1 ] && [ "$name" = snipsik-bot-backup ]; then exit 1; fi
    rm -f "$(state "$name")"
    ;;
  logs) exit 0 ;;
  image)
    case "${2:-}" in
      rm|prune) exit 0 ;;
    esac
    exit 2
    ;;
  *) echo "Unexpected fake docker command: $*" >&2; exit 2 ;;
esac
