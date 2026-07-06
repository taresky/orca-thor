#!/usr/bin/env bash
# Phase 2 — build the reusable base image: tools image (Dockerfile) -> clone repo + build
# inside a running container -> `docker commit` to the "built" image. Run this by hand.
#   GH_TOKEN=... ./scripts/orca-vm/docker-ssh-base.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
state="$here/docker-ssh-state.json"

# Resolve a value: env var -> state file -> fallback.
json_value() { node -e 'const fs=require("fs");try{const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const v=d[process.argv[2]];process.stdout.write(v==null?"":String(v))}catch{process.stdout.write("")}' "$state" "$1"; }
resolve() { local env_name="$1" key="$2" fb="${3:-}"; local ev="${!env_name:-}"; if [ -n "$ev" ]; then printf '%s' "$ev"; return; fi; local sv; sv="$(json_value "$key")"; if [ -n "$sv" ]; then printf '%s' "$sv"; return; fi; printf '%s' "$fb"; }

base_image="$(resolve ORCA_BASE_IMAGE baseImage orca-docker-base:latest)"
built_image="$(resolve ORCA_BUILT_IMAGE builtImage orca-docker-built:latest)"
repo_url="$(resolve ORCA_REPO_URL repoUrl https://github.com/stablyai/orca.git)"
repo_ref="$(resolve ORCA_REPO_REF repoRef main)"
project_root="$(resolve ORCA_PROJECT_ROOT projectRoot /home/orca/orca)"
ssh_user="$(resolve ORCA_SSH_USER sshUser orca)"
# What to run inside the container to make the repo workspace-ready. Overridable.
build_cmd="${ORCA_BUILD_CMD:-node config/scripts/run-internal-dev-setup.mjs && pnpm install}"

gh_token="${GH_TOKEN:-${GITHUB_TOKEN:-$(command -v gh >/dev/null 2>&1 && gh auth token 2>/dev/null || true)}}"
[ -n "$gh_token" ] || { echo "No git token (set GH_TOKEN or run: gh auth login)" >&2; exit 1; }

echo ">> Building tools image $base_image" >&2
docker build -t "$base_image" "$here" >&2

builder="orca-docker-build-$$"
cleanup() { docker rm -f "$builder" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo ">> Starting build container $builder" >&2
docker run -d --name "$builder" "$base_image" >&2

echo ">> Cloning $repo_url@$repo_ref and building ($build_cmd)" >&2
docker exec -u "$ssh_user" -e HOME="/home/$ssh_user" -w "/home/$ssh_user" \
  -e GH_TOKEN="$gh_token" -e ORCA_REPO_URL="$repo_url" -e ORCA_REPO_REF="$repo_ref" \
  -e ORCA_PROJECT_ROOT="$project_root" -e ORCA_BUILD_CMD="$build_cmd" \
  "$builder" bash -lc '
    set -euo pipefail
    # GIT_ASKPASS feeds the token as x-access-token so a private clone never prompts/hangs.
    # \$1 / \$GH_TOKEN stay literal in the file and resolve at git-runtime (token never baked).
    printf "%s\n" "#!/usr/bin/env bash" "case \"\$1\" in *Username*) echo x-access-token;; *Password*) echo \"\$GH_TOKEN\";; esac" > /tmp/askpass.sh
    chmod 700 /tmp/askpass.sh
    export GIT_ASKPASS=/tmp/askpass.sh GIT_TERMINAL_PROMPT=0
    git clone "$ORCA_REPO_URL" "$ORCA_PROJECT_ROOT"
    cd "$ORCA_PROJECT_ROOT"
    git fetch origin "$ORCA_REPO_REF"
    git checkout -B "$ORCA_REPO_REF" FETCH_HEAD
    corepack enable
    eval "$ORCA_BUILD_CMD"
    rm -f /tmp/askpass.sh
    node --version && pnpm --version && codex --version
  ' >&2

echo ">> Committing built image $built_image" >&2
docker commit "$builder" "$built_image" >&2

# Merge outputs back into state (snapshotId stays empty until Phase 3 authenticates).
node -e '
  const fs=require("fs");const [sp,...kv]=process.argv.slice(1);
  const d=fs.existsSync(sp)?JSON.parse(fs.readFileSync(sp,"utf8")):{};
  for(let i=0;i<kv.length;i+=2)d[kv[i]]=kv[i+1];
  fs.writeFileSync(sp,JSON.stringify(d,null,2)+"\n");
  process.stdout.write(JSON.stringify(d));
' "$state" baseImage "$base_image" builtImage "$built_image" authSourceImage "$built_image" \
  repoUrl "$repo_url" repoRef "$repo_ref" projectRoot "$project_root" sshUser "$ssh_user"
echo >&2
