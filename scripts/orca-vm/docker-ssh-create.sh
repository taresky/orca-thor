#!/usr/bin/env bash
# Per-workspace create: boot a container from the authenticated image, inject the workspace
# SSH key, refresh the repo to the desired ref, and print the SSH connection block Orca dials.
# stdout = one JSON object; all logs go to stderr.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
state="$here/docker-ssh-state.json"

json_value() { node -e 'const fs=require("fs");try{const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const v=d[process.argv[2]];process.stdout.write(v==null?"":String(v))}catch{process.stdout.write("")}' "$state" "$1"; }
resolve() { local env_name="$1" key="$2" fb="${3:-}"; local ev="${!env_name:-}"; if [ -n "$ev" ]; then printf '%s' "$ev"; return; fi; local sv; sv="$(json_value "$key")"; if [ -n "$sv" ]; then printf '%s' "$sv"; return; fi; printf '%s' "$fb"; }

auth_image="$(resolve ORCA_AUTH_IMAGE snapshotId)"
[ -n "$auth_image" ] || { echo "snapshotId (authenticated image) missing — run docker-ssh-base.sh then docker-ssh-auth.sh first" >&2; exit 1; }
ssh_user="$(resolve ORCA_SSH_USER sshUser orca)"
project_root="$(resolve ORCA_PROJECT_ROOT projectRoot /home/orca/orca)"
repo_ref="${ORCA_VM_BRANCH:-$(resolve ORCA_REPO_REF repoRef main)}"
gh_token="${GH_TOKEN:-${GITHUB_TOKEN:-$(command -v gh >/dev/null 2>&1 && gh auth token 2>/dev/null || true)}}"

# Identity file (repo-relative in state) -> absolute for the emitted target.
id_rel="$(resolve ORCA_IDENTITY_FILE identityFile scripts/orca-vm/keys/orca-docker-ssh)"
case "$id_rel" in /*) id_abs="$id_rel";; *) id_abs="$repo_root/$id_rel";; esac
if [ ! -f "$id_abs" ]; then
  echo ">> Generating workspace SSH key at $id_abs" >&2
  mkdir -p "$(dirname "$id_abs")"
  ssh-keygen -t ed25519 -N '' -C orca-docker-ssh -f "$id_abs" >&2
fi
pubkey="$(cat "$id_abs.pub")"

# Sanitize + length-cap the container name (Docker allows [a-zA-Z0-9_.-]).
raw="orca-${ORCA_VM_RECIPE_ID:-docker-ssh}-${ORCA_VM_INSTANCE_ID:-$(date +%s)}"
name="$(printf '%s' "$raw" | tr -c 'A-Za-z0-9_.-' '-' | cut -c1-63)"

cleanup_on_error() { [ "$?" -ne 0 ] && docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup_on_error EXIT

echo ">> Booting $name from $auth_image" >&2
docker run -d --name "$name" -p 127.0.0.1::22 -e "ORCA_SSH_PUBLIC_KEY=$pubkey" "$auth_image" >&2

# Map the published SSH port (docker picks a free 127.0.0.1 port).
mapped="$(docker port "$name" 22/tcp | head -1)"      # e.g. 127.0.0.1:49153
port="${mapped##*:}"
[ -n "$port" ] || { echo "could not read published SSH port" >&2; exit 1; }

# Wait for sshd to accept the workspace key.
echo ">> Waiting for sshd on 127.0.0.1:$port" >&2
ready=0
for _ in $(seq 1 60); do
  if ssh -i "$id_abs" -p "$port" \
       -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
       -o ConnectTimeout=2 -o BatchMode=yes "$ssh_user@127.0.0.1" true 2>/dev/null; then
    ready=1; break
  fi
  sleep 0.5
done
[ "$ready" -eq 1 ] || { echo "sshd did not become reachable" >&2; docker logs "$name" >&2 || true; exit 1; }

# Refresh the repo to the desired ref (best-effort; the image already has a built checkout).
echo ">> Ensuring repo at $repo_ref" >&2
docker exec -u "$ssh_user" -e HOME="/home/$ssh_user" -e ORCA_PROJECT_ROOT="$project_root" \
  -e ORCA_REPO_REF="$repo_ref" -e GH_TOKEN="$gh_token" "$name" bash -lc '
    set -euo pipefail
    cd "$ORCA_PROJECT_ROOT"
    # Token via askpass for the private fetch; GIT_TERMINAL_PROMPT=0 fails fast if it is absent.
    printf "%s\n" "#!/usr/bin/env bash" "case \"\$1\" in *Username*) echo x-access-token;; *Password*) echo \"\$GH_TOKEN\";; esac" > /tmp/askpass.sh
    chmod 700 /tmp/askpass.sh
    export GIT_ASKPASS=/tmp/askpass.sh GIT_TERMINAL_PROMPT=0
    git fetch origin "$ORCA_REPO_REF" || true
    git checkout -B "$ORCA_REPO_REF" "origin/$ORCA_REPO_REF" 2>/dev/null || true
    rm -f /tmp/askpass.sh
  ' >&2 || echo ">> repo refresh skipped (non-fatal)" >&2

# Emit the SSH connection block (SSH mode: NO orca serve, NO pairingCode).
node -e '
  const [host,port,user,idf,root,resourceId,image]=process.argv.slice(1);
  const target={ label:"orca-docker-ssh", host, port:Number(port), username:user,
                 identityFile:idf, identitiesOnly:true };
  console.log(JSON.stringify({ schemaVersion:1,
    connection:{ type:"ssh", projectRoot:root, target },
    userData:{ provider:"local-docker", resourceId, image } }));
' "127.0.0.1" "$port" "$ssh_user" "$id_abs" "$project_root" "$name" "$auth_image"

trap - EXIT
