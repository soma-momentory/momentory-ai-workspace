#!/usr/bin/env bash
set -euo pipefail
group="$(cut -d: -f3 /proc/self/cgroup)"
cat "/sys/fs/cgroup${group}/memory.max"
ulimit -t
