#!/usr/bin/env bash
# Wake: restart the container and RE-EMIT a fresh SSH connection block — Docker assigns a new
# published port on start, so the port (and thus the target) changes. Lifecycle JSON on stdin.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
state="$here/docker-ssh-state.json"

json_value() { node -e 'const fs=require("fs");try{const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const v=d[process.argv[2]];process.stdout.write(v==null?"":String(v))}catch{process.stdout.write("")}' "$state" "$1"; }
resolve() { local env_name="$1" key="$2" fb="${3:-}"; local ev="${!env_name:-}"; if [ -n "$ev" ]; then printf '%s' "$ev"; return; fi; local sv; sv="$(json_value "$key")"; if [ -n "$sv" ]; then printf '%s' "$sv"; return; fi; printf '%s' "$fb"; }

payload="$(cat)"
resource_id="$(node -e 'const d=JSON.parse(process.argv[1]||"{}");process.stdout.write(d.recipeResult?.userData?.resourceId ?? "")' "$payload")"
[ -n "$resource_id" ] || { echo "No resource id in lifecycle payload" >&2; exit 1; }

ssh_user="$(resolve ORCA_SSH_USER sshUser orca)"
project_root="$(resolve ORCA_PROJECT_ROOT projectRoot /home/orca/orca)"
id_rel="$(resolve ORCA_IDENTITY_FILE identityFile scripts/orca-vm/keys/orca-docker-ssh)"
case "$id_rel" in /*) id_abs="$id_rel";; *) id_abs="$repo_root/$id_rel";; esac
image="$(node -e 'const d=JSON.parse(process.argv[1]||"{}");process.stdout.write(d.recipeResult?.userData?.image ?? "")' "$payload")"

docker start "$resource_id" >&2
mapped="$(docker port "$resource_id" 22/tcp | head -1)"
port="${mapped##*:}"
[ -n "$port" ] || { echo "could not read published SSH port after resume" >&2; exit 1; }

node -e '
  const [host,port,user,idf,root,resourceId,image]=process.argv.slice(1);
  const target={ label:"orca-docker-ssh", host, port:Number(port), username:user,
                 identityFile:idf, identitiesOnly:true };
  console.log(JSON.stringify({ schemaVersion:1,
    connection:{ type:"ssh", projectRoot:root, target },
    userData:{ provider:"local-docker", resourceId, image } }));
' "127.0.0.1" "$port" "$ssh_user" "$id_abs" "$project_root" "$resource_id" "$image"
