#!/usr/bin/env bash
set -euo pipefail

XVFB_DISPLAY="${DISPLAY:-:99}"
XVFB_SCREEN="${XVFB_SCREEN:-1440x920x24}"
VNC_PORT="${VNC_PORT:-5900}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
API_PORT="${API_PORT:-18100}"
DISPLAY_NUM="${XVFB_DISPLAY#:}"
X_LOCK_FILE="/tmp/.X${DISPLAY_NUM}-lock"
X_SOCKET_FILE="/tmp/.X11-unix/X${DISPLAY_NUM}"
FLUXBOX_DIR="${HOME}/.fluxbox"
FLUXBOX_INIT="${FLUXBOX_DIR}/init"

cleanup() {
  jobs -p | xargs -r kill 2>/dev/null || true
}

trap cleanup EXIT INT TERM

# Remove stale Xvfb lock/socket files left by an unclean shutdown.
rm -f "${X_LOCK_FILE}"
rm -f "${X_SOCKET_FILE}"

Xvfb "${XVFB_DISPLAY}" -screen 0 "${XVFB_SCREEN}" -ac +extension RANDR &
sleep 1

mkdir -p "${FLUXBOX_DIR}"
if [ ! -f "${FLUXBOX_INIT}" ]; then
  cat > "${FLUXBOX_INIT}" <<'EOF'
session.menuFile: ~/.fluxbox/menu
session.keyFile: ~/.fluxbox/keys
session.styleFile: /usr/share/fluxbox/styles//ubuntu-light
session.configVersion: 13
session.screen0.strftimeFormat: %d %b, %a %02k:%M:%S
EOF
fi

python - <<'PY'
from pathlib import Path

init_path = Path.home() / ".fluxbox" / "init"
text = init_path.read_text(encoding="utf-8")
lines = [line for line in text.splitlines() if line.strip()]
desired = {
    "session.screen0.toolbar.visible": "false",
    "session.screen0.slit.visible": "false",
}

kept = []
seen = set()
for line in lines:
    if ":" not in line:
        kept.append(line)
        continue
    key = line.split(":", 1)[0].strip()
    if key in desired:
        if key not in seen:
            kept.append(f"{key}: {desired[key]}")
            seen.add(key)
    else:
        kept.append(line)

for key, value in desired.items():
    if key not in seen:
        kept.append(f"{key}: {value}")

init_path.write_text("\n".join(kept) + "\n", encoding="utf-8")
PY

fluxbox >/tmp/fluxbox.log 2>&1 &
x11vnc -display "${XVFB_DISPLAY}" -forever -shared -rfbport "${VNC_PORT}" -nopw -quiet >/tmp/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc "${NOVNC_PORT}" "localhost:${VNC_PORT}" >/tmp/websockify.log 2>&1 &

uvicorn server:app --host 0.0.0.0 --port "${API_PORT}" &

wait -n
