#!/usr/bin/env bash
set -euo pipefail

# Default display and screen size for Xvfb.
: "${DISPLAY:=:99}"
: "${SCREEN_RES:=1280x720x24}"
: "${VNC_PORT:=5900}"
: "${NOVNC_PORT:=7900}"

echo "[boot] starting Xvfb on ${DISPLAY} (${SCREEN_RES})"
Xvfb "${DISPLAY}" -screen 0 "${SCREEN_RES}" -ac -nolisten tcp &
XVFB_PID=$!

# Wait for Xvfb to be ready to accept connections.
for _ in $(seq 1 30); do
  if xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

echo "[boot] starting x11vnc on port ${VNC_PORT}"
x11vnc -display "${DISPLAY}" -rfbport "${VNC_PORT}" -forever -shared -nopw -quiet &
X11VNC_PID=$!

echo "[boot] starting noVNC/websockify on port ${NOVNC_PORT}"
websockify --web=/usr/share/novnc/ "${NOVNC_PORT}" "localhost:${VNC_PORT}" &
NOVNC_PID=$!

cleanup() {
  echo "[shutdown] stopping child processes"
  kill "${NOVNC_PID}" "${X11VNC_PID}" "${XVFB_PID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[boot] starting app"
node dist/main.js
