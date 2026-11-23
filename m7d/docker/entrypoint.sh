#!/bin/sh
# Starts m7d as an unprivileged user. Started as root (the default), it first gives the two
# volume folders to that user: Docker creates missing bind-mount folders owned by root, which
# m7d (UID 1000) could not write. PUID / PGID pick another user, e.g. to match the host owner.
set -e
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
  for dir in /data /home/m7d/.config/Apps2Samsung; do
    mkdir -p "$dir"
    if [ "$(stat -c %u "$dir")" != "$PUID" ]; then
      echo "[entrypoint] giving $dir to $PUID:$PGID"
      chown -R "$PUID:$PGID" "$dir"
    fi
  done
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups /app/m7d "$@"
fi
exec /app/m7d "$@"
