# Base image for Orca local-Docker per-workspace VMs (SSH connection mode).
# Tools only — the repo clone + build and the codex login are layered in later by
# docker-ssh-base.sh / docker-ssh-auth.sh via `docker exec` + `docker commit`, so no
# git token or agent credentials are ever baked into an image layer here.
FROM node:24-bookworm

# System deps: sshd for the SSH connection, plus the toolchain node-pty/native modules
# need to build during `pnpm install`.
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-server git ca-certificates curl build-essential python3 procps \
    && rm -rf /var/lib/apt/lists/*

# pnpm via corepack (the repo pins its package manager).
RUN corepack enable

# codex CLI — logged in later (Phase 3) inside a container, then committed.
RUN npm install -g @openai/codex

# Unprivileged workspace user; the repo and codex creds live under its home.
RUN useradd -m -s /bin/bash orca

# Key-only SSH; sshd runs as root in the entrypoint and drops to the user on login.
RUN mkdir -p /run/sshd /etc/ssh/sshd_config.d \
    && printf '%s\n' \
        'PermitRootLogin no' \
        'PasswordAuthentication no' \
        'PubkeyAuthentication yes' \
        'AllowUsers orca' \
      > /etc/ssh/sshd_config.d/orca.conf

# Bake host keys into the image so every ephemeral container presents the SAME host key
# (avoids a churning key across containers). Regenerated only if absent.
RUN ssh-keygen -A

COPY orca-docker-ssh-entrypoint.sh /usr/local/bin/orca-docker-ssh-entrypoint
RUN chmod 755 /usr/local/bin/orca-docker-ssh-entrypoint

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/orca-docker-ssh-entrypoint"]
