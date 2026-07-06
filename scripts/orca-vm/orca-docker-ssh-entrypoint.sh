#!/usr/bin/env bash
# Runtime entrypoint for a per-workspace container: install the workspace's SSH public
# key (injected via ORCA_SSH_PUBLIC_KEY at `docker run`), then run sshd in the foreground.
set -euo pipefail

install -d -m 700 -o orca -g orca /home/orca/.ssh
if [ -n "${ORCA_SSH_PUBLIC_KEY:-}" ]; then
  printf '%s\n' "$ORCA_SSH_PUBLIC_KEY" > /home/orca/.ssh/authorized_keys
  chown orca:orca /home/orca/.ssh/authorized_keys
  chmod 600 /home/orca/.ssh/authorized_keys
fi

# Host keys are baked into the image; generate only if somehow missing.
ssh-keygen -A

exec /usr/sbin/sshd -D -e
