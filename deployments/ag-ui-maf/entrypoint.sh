#!/usr/bin/env bash
# Starts uvicorn and runs a watchdog that polls /ok every 30s after a 180s
# startup grace. Three consecutive failures kill uvicorn so Railway's
# restart-policy can recover.
set -euo pipefail

PORT="${PORT:-8000}"
uvicorn server:app --host 0.0.0.0 --port "${PORT}" &
UVICORN_PID=$!

sleep 180  # startup grace — let imports + first OpenAI warm-up settle
STRIKES=0
while kill -0 "${UVICORN_PID}" 2>/dev/null; do
  sleep 30
  if curl -fsS "http://127.0.0.1:${PORT}/ok" >/dev/null; then
    STRIKES=0
  else
    STRIKES=$((STRIKES + 1))
    echo "watchdog: strike ${STRIKES}/3" >&2
    if [ "${STRIKES}" -ge 3 ]; then
      echo "watchdog: 3 strikes, killing uvicorn (pid ${UVICORN_PID})" >&2
      kill "${UVICORN_PID}" || true
      exit 1
    fi
  fi
done
wait "${UVICORN_PID}"
