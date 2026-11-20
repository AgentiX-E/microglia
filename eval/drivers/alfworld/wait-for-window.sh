#!/usr/bin/env bash
# Hold a paid step until an off-peak hour, and never hold it longer than a day.
#
# DeepSeek charges exactly double inside its peak windows (01:00-04:00 and 06:00-10:00 UTC on weekdays, per
# `eval/manifests/model-rates.json`), and the bill is read when the run ends, so a job that starts inside a
# window is billed at the peak rate for every token it spends. Runner minutes are free in this repository;
# peak tokens are not. Waiting is therefore strictly cheaper than starting.
#
# A machine that wakes late still runs: a target already in the past means "start now", never "wait until
# tomorrow". The only failure this refuses is a target that is not a time at all.
#
# usage: wait-for-window.sh HH:MM [--check]
#   HH:MM    the UTC hour to start at; empty starts immediately
#   --check  print the wait in seconds and exit, so the arithmetic can be tested without sleeping
set -euo pipefail

target_hhmm="${1:-}"
mode="${2:-}"

if [ -z "${target_hhmm}" ]; then
  echo "no target hour; starting now"
  exit 0
fi

if ! target="$(date -u -d "today ${target_hhmm}" +%s 2>/dev/null)"; then
  echo "FAIL '${target_hhmm}' is not an HH:MM this host can read" >&2
  exit 2
fi

now="$(date -u +%s)"
if [ "${target}" -le "${now}" ]; then
  echo "${target_hhmm} UTC has passed; starting now"
  exit 0
fi

waiting=$((target - now))
if [ "${mode}" = "--check" ]; then
  echo "would wait ${waiting}s until ${target_hhmm} UTC"
  exit 0
fi

echo "waiting ${waiting}s until ${target_hhmm} UTC (peak tokens cost double; runner minutes are free)"
sleep "${waiting}"
echo "starting at $(date -u +%H:%M) UTC"
