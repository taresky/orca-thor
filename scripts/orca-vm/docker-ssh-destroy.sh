#!/usr/bin/env bash
# Delete: remove the workspace container. Lifecycle JSON arrives on stdin.
set -euo pipefail
payload="$(cat)"
resource_id="$(node -e 'const d=JSON.parse(process.argv[1]||"{}");process.stdout.write(d.recipeResult?.userData?.resourceId ?? "")' "$payload")"
[ -n "$resource_id" ] || { echo "No resource id in lifecycle payload" >&2; exit 1; }
docker rm -f "$resource_id" >&2
