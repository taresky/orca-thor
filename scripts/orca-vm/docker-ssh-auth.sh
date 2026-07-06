#!/usr/bin/env bash
# Phase 3 — log codex in inside a container built from the "built" image, then commit the
# authenticated layer as the image per-workspace create boots from. Run this by hand:
#   ./scripts/orca-vm/docker-ssh-auth.sh    (you complete the codex login URL/code in a browser)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
state="$here/docker-ssh-state.json"

json_value() { node -e 'const fs=require("fs");try{const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const v=d[process.argv[2]];process.stdout.write(v==null?"":String(v))}catch{process.stdout.write("")}' "$state" "$1"; }
resolve() { local env_name="$1" key="$2" fb="${3:-}"; local ev="${!env_name:-}"; if [ -n "$ev" ]; then printf '%s' "$ev"; return; fi; local sv; sv="$(json_value "$key")"; if [ -n "$sv" ]; then printf '%s' "$sv"; return; fi; printf '%s' "$fb"; }

source_image="$(resolve ORCA_BUILT_IMAGE builtImage orca-docker-built:latest)"
auth_image="$(resolve ORCA_AUTH_IMAGE snapshotId orca-docker-auth:latest)"
[ -n "$auth_image" ] || auth_image="orca-docker-auth:latest"
ssh_user="$(resolve ORCA_SSH_USER sshUser orca)"

authbox="orca-docker-auth-$$"
cleanup() { docker rm -f "$authbox" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo ">> Starting auth container $authbox from $source_image" >&2
docker run -d --name "$authbox" "$source_image" >&2

echo ">> Logging codex in via device auth (open the printed URL + code in your browser)..." >&2
# Device auth (not the default loopback OAuth): a container port isn't reachable from the host browser.
docker exec -it -u "$ssh_user" -e HOME="/home/$ssh_user" -w "/home/$ssh_user" \
  "$authbox" bash -lc 'codex login --device-auth'

# Refuse to snapshot an unauthenticated VM. (codex prints its status to stderr, so fold it in.)
echo ">> Verifying codex login" >&2
docker exec -u "$ssh_user" -e HOME="/home/$ssh_user" "$authbox" bash -lc 'codex login status 2>&1' \
  | grep -qi 'logged in' \
  || { echo "codex not logged in; not committing image" >&2; exit 1; }

# Commit, forcing the runtime entrypoint back to sshd (the interactive exec above does not
# change ENTRYPOINT, but be explicit so an authenticated image always boots into sshd).
echo ">> Committing authenticated image $auth_image" >&2
docker commit --change='ENTRYPOINT ["/usr/local/bin/orca-docker-ssh-entrypoint"]' \
  "$authbox" "$auth_image" >&2

node -e '
  const fs=require("fs");const [sp,...kv]=process.argv.slice(1);
  const d=fs.existsSync(sp)?JSON.parse(fs.readFileSync(sp,"utf8")):{};
  for(let i=0;i<kv.length;i+=2)d[kv[i]]=kv[i+1];
  fs.writeFileSync(sp,JSON.stringify(d,null,2)+"\n");
  process.stdout.write(JSON.stringify(d));
' "$state" snapshotId "$auth_image" authSourceImage "$source_image"
echo >&2
