#!/usr/bin/env bash
set -euo pipefail

pid_file="$1"
cpu_seconds="$2"
virtual_memory_kib="$3"
shift 3

umask 077
printf '%s\n' "$$" > "$pid_file"
ulimit -t "$cpu_seconds"
if [ "$virtual_memory_kib" -gt 0 ]; then ulimit -v "$virtual_memory_kib"; fi
exec "$@"
