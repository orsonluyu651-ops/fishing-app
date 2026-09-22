#!/bin/bash

# Fishlore production sync monitor.
#
# This script is intentionally safe to run on a CI worker or operator machine:
# it never attempts to inspect an Expo device sandbox or fabricate production
# metrics. Supply TELEMETRY_LOG_FILE with newline-delimited JSON (JSONL) from
# an approved collector to calculate the thresholds below. Supported events:
#
#   {"type":"sync","status":"success|failed","startedAt":"ISO","completedAt":"ISO","payloadBytes":123}
#   {"type":"conflict","action":"client-wins|server-wins|merge-fields|defer","createdAt":"ISO"}
#   {"type":"export_cleanup","success":true}
#   {"type":"map_cache","bytes":123}
#
# Optional environment variables:
#   TELEMETRY_LOG_FILE=/approved/path/events.jsonl
#   EXPORT_DIR=/approved/local/cache/exports
#   RUN_VERIFICATION=1|0       (default: 1; run tsc and Jest once per invocation)
#   WATCH_INTERVAL_SECONDS=0|N (default: 0; N polls the JSONL feed repeatedly)

set -euo pipefail

# Anchor relative paths and npm commands to the repository rather than the
# caller's shell directory, so scheduled jobs may invoke this script by path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
cd "$PROJECT_ROOT"

TEXT_CYAN='\033[0;36m'
TEXT_GREEN='\033[0;32m'
TEXT_YELLOW='\033[0;33m'
TEXT_RED='\033[0;31m'
TEXT_RESET='\033[0m'

SSR_TARGET=99.2
MAX_SYNC_LATENCY_MS=1200
MAX_PAYLOAD_BYTES=$((15 * 1024))
MAX_MAP_CACHE_BYTES=$((250 * 1024 * 1024))
MAX_DEFER_AGE_HOURS=48
RUN_VERIFICATION="${RUN_VERIFICATION:-1}"
WATCH_INTERVAL_SECONDS="${WATCH_INTERVAL_SECONDS:-0}"
EXPORT_DIR="${EXPORT_DIR:-$PROJECT_ROOT/cache/exports}"
TELEMETRY_LOG_FILE="${TELEMETRY_LOG_FILE:-}"

echo -e "${TEXT_CYAN}[Telemetry Monitor] Initializing Fishlore operational sync audit...${TEXT_RESET}"

require_integer() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

safe_cleanup_export_dir() {
  local resolved_dir resolved_root
  if [[ ! -d "$EXPORT_DIR" ]]; then
    echo -e "${TEXT_GREEN}[SUCCESS] No host-local export sandbox exists to clean.${TEXT_RESET}"
    return
  fi

  resolved_dir="$(cd "$EXPORT_DIR" && pwd -P)"
  resolved_root="$PROJECT_ROOT/cache/exports"

  # Refuse deletion unless the target is exactly the repository-local default
  # cache path, or an explicitly supplied path containing a cache/exports suffix.
  if [[ "$resolved_dir" != "$resolved_root" && "$resolved_dir" != */cache/exports ]]; then
    echo -e "${TEXT_RED}[CRITICAL FAULT] Refusing to clean unsafe EXPORT_DIR: $resolved_dir${TEXT_RESET}"
    exit 1
  fi

  if [[ -d "$resolved_dir" ]] && [[ -n "$(find "$resolved_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    echo -e "${TEXT_YELLOW}[WARNING] Host-local export artifacts detected at $resolved_dir.${TEXT_RESET}"
    find "$resolved_dir" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
    echo -e "${TEXT_GREEN}[SUCCESS] Host-local export artifacts scrubbed.${TEXT_RESET}"
  else
    echo -e "${TEXT_GREEN}[SUCCESS] Host-local export sandbox is clean or unavailable.${TEXT_RESET}"
  fi
}

run_verification_gates() {
  if [[ "$RUN_VERIFICATION" != "1" ]]; then
    echo -e "${TEXT_YELLOW}[WARNING] Compilation and test gates skipped (RUN_VERIFICATION=$RUN_VERIFICATION).${TEXT_RESET}"
    return
  fi

  echo -e "${TEXT_CYAN}[Telemetry Monitor] Running type and unit-test regression gates...${TEXT_RESET}"
  npx tsc --noEmit
  npm test -- --watchAll=false
  echo -e "${TEXT_GREEN}[SUCCESS] Type safety and unit-test gates passed.${TEXT_RESET}"
}

report_telemetry() {
  if [[ -z "$TELEMETRY_LOG_FILE" ]]; then
    echo -e "${TEXT_YELLOW}[WARNING] TELEMETRY_LOG_FILE is unset; live SSR, latency, payload, conflict, and cache metrics are unavailable.${TEXT_RESET}"
    return
  fi

  if [[ ! -f "$TELEMETRY_LOG_FILE" ]]; then
    echo -e "${TEXT_RED}[CRITICAL FAULT] TELEMETRY_LOG_FILE does not exist: $TELEMETRY_LOG_FILE${TEXT_RESET}"
    exit 1
  fi

  node - "$TELEMETRY_LOG_FILE" "$SSR_TARGET" "$MAX_SYNC_LATENCY_MS" "$MAX_PAYLOAD_BYTES" "$MAX_MAP_CACHE_BYTES" "$MAX_DEFER_AGE_HOURS" <<'NODE'
const fs = require('fs');

const [file, ssrTarget, maxLatency, maxPayload, maxCache, maxDeferHours] = process.argv.slice(2);
const limits = {
  ssrTarget: Number(ssrTarget),
  maxLatency: Number(maxLatency),
  maxPayload: Number(maxPayload),
  maxCache: Number(maxCache),
  maxDeferMs: Number(maxDeferHours) * 60 * 60 * 1000,
};

const state = {
  syncSuccess: 0,
  syncFailed: 0,
  latencies: [],
  payloads: [],
  conflicts: { 'client-wins': 0, 'server-wins': 0, 'merge-fields': 0, defer: 0 },
  staleDeferrals: 0,
  exportCleanupSuccess: 0,
  exportCleanupFailed: 0,
  mapCacheBytes: null,
  malformed: 0,
};

for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    state.malformed += 1;
    continue;
  }
  if (!event || typeof event !== 'object') continue;

  if (event.type === 'sync') {
    if (event.status === 'success') state.syncSuccess += 1;
    if (event.status === 'failed') state.syncFailed += 1;
    const start = Date.parse(event.startedAt);
    const completed = Date.parse(event.completedAt);
    if (Number.isFinite(start) && Number.isFinite(completed) && completed >= start) {
      state.latencies.push(completed - start);
    }
    if (Number.isFinite(event.payloadBytes) && event.payloadBytes >= 0) state.payloads.push(event.payloadBytes);
  }

  if (event.type === 'conflict') {
    if (Object.hasOwn(state.conflicts, event.action)) state.conflicts[event.action] += 1;
    if (event.action === 'defer') {
      const created = Date.parse(event.createdAt);
      if (Number.isFinite(created) && Date.now() - created > limits.maxDeferMs) state.staleDeferrals += 1;
    }
  }

  if (event.type === 'export_cleanup') {
    if (event.success === true) state.exportCleanupSuccess += 1;
    if (event.success === false) state.exportCleanupFailed += 1;
  }

  if (event.type === 'map_cache' && Number.isFinite(event.bytes) && event.bytes >= 0) {
    state.mapCacheBytes = event.bytes;
  }
}

const totalSync = state.syncSuccess + state.syncFailed;
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const ssr = totalSync ? (state.syncSuccess / totalSync) * 100 : null;
const averageLatency = average(state.latencies);
const averagePayload = average(state.payloads);
const cleanupTotal = state.exportCleanupSuccess + state.exportCleanupFailed;
const cleanupRate = cleanupTotal ? (state.exportCleanupSuccess / cleanupTotal) * 100 : null;
const checks = [
  ['SSR', ssr, limits.ssrTarget, '>='],
  ['Average sync latency (ms)', averageLatency, limits.maxLatency, '<='],
  ['Average payload (bytes)', averagePayload, limits.maxPayload, '<='],
  ['Stale deferred conflicts', state.staleDeferrals, 0, '<='],
  ['Export cleanup success (%)', cleanupRate, 100, '>='],
  ['Map-cache footprint (bytes)', state.mapCacheBytes, limits.maxCache, '<='],
];

console.log('\n================================================================================');
console.log('FISHLORE LIVE TELEMETRY THRESHOLD REPORT');
console.log('================================================================================');
for (const [label, value, limit, operator] of checks) {
  if (value === null) {
    console.log(`[UNAVAILABLE] ${label}: no compatible telemetry events`);
    continue;
  }
  const pass = operator === '>=' ? value >= limit : value <= limit;
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);
  console.log(`[${pass ? 'PASS' : 'ALERT'}] ${label}: ${formatted} (target ${operator} ${limit})`);
}
console.log(`[INFO] Conflict choices: client-wins=${state.conflicts['client-wins']}, server-wins=${state.conflicts['server-wins']}, merge-fields=${state.conflicts['merge-fields']}, defer=${state.conflicts.defer}`);
if (state.malformed) console.log(`[WARNING] Ignored malformed JSONL events: ${state.malformed}`);
console.log('================================================================================');

const failed = checks.some(([_, value, limit, operator]) => value !== null && (operator === '>=' ? value < limit : value > limit));
process.exitCode = failed ? 2 : 0;
NODE
}

monitor_once() {
  safe_cleanup_export_dir
  report_telemetry
}

if ! require_integer "$WATCH_INTERVAL_SECONDS"; then
  echo -e "${TEXT_RED}[CRITICAL FAULT] WATCH_INTERVAL_SECONDS must be a non-negative integer.${TEXT_RESET}"
  exit 1
fi

run_verification_gates

if [[ "$WATCH_INTERVAL_SECONDS" -eq 0 ]]; then
  monitor_once
  echo -e "${TEXT_GREEN}[MONITOR COMPLETE] Local checks complete; telemetry status above reflects supplied events only.${TEXT_RESET}"
  exit 0
fi

echo -e "${TEXT_CYAN}[Telemetry Monitor] Polling telemetry every ${WATCH_INTERVAL_SECONDS}s. Press Ctrl-C to stop.${TEXT_RESET}"
while true; do
  monitor_once || echo -e "${TEXT_RED}[ALERT] Threshold violation or telemetry parse failure; continuing to monitor.${TEXT_RESET}"
  sleep "$WATCH_INTERVAL_SECONDS"
done