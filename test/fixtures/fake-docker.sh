#!/usr/bin/env bash
set -euo pipefail

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
  info|pull) exit 0 ;;
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
      *State.Health.Status*) echo "$health" ;;
      *State.Status*) if [ "$running" = true ]; then echo running; else echo exited; fi ;;
      *Config.Image*) echo "$image" ;;
    esac
    ;;
  run)
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
    rm -f "$(state "$name")"
    ;;
  logs) exit 0 ;;
  *) echo "Unexpected fake docker command: $*" >&2; exit 2 ;;
esac
