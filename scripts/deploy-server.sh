#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/deploy-server.sh --host user@server [options]

Options:
  --host TARGET              SSH target, for example nolan@192.168.1.10.
  --app NAME                 App name under /data and /dockers. Default: animeongaku.
  --docker-root PATH         Remote docker root. Default: /dockers.
  --data-root PATH           Remote data root. Default: /data.
  --env-file PATH            Copy this local env file to remote .env.
  --allow-default-env        Allow deploy when remote .env is missing.
  --skip-build               Run compose up without --build.
  --dry-run                  Show sync/deploy actions without applying them.
  --health-timeout SECONDS   Health wait timeout. Default: 90.
USAGE
}

quote_sh() {
  printf "'%s'" "${1//\'/\'\"\'\"\'}"
}

ssh_target=""
app_name="animeongaku"
remote_docker_root="/dockers"
remote_data_root="/data"
env_file=""
allow_default_env=0
skip_build=0
dry_run=0
health_timeout=90

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host) ssh_target="${2:?}"; shift 2 ;;
    --app) app_name="${2:?}"; shift 2 ;;
    --docker-root) remote_docker_root="${2:?}"; shift 2 ;;
    --data-root) remote_data_root="${2:?}"; shift 2 ;;
    --env-file) env_file="${2:?}"; shift 2 ;;
    --allow-default-env) allow_default_env=1; shift ;;
    --skip-build) skip_build=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    --health-timeout) health_timeout="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -z "$ssh_target" ]; then
  echo "--host is required." >&2
  usage >&2
  exit 2
fi
if [ -n "$env_file" ] && [ ! -f "$env_file" ]; then
  echo "Env file does not exist: $env_file" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
server_dir="$repo_root/server"
remote_docker_dir="$remote_docker_root/$app_name"
remote_data_dir="$remote_data_root/$app_name"
remote_archive="/tmp/$app_name-deploy.tgz"

remote_prepare="
set -eu
case $(quote_sh "$remote_docker_dir") in
  $(quote_sh "${remote_docker_root%/}")/*) ;;
  *) echo \"Refusing to deploy outside $remote_docker_root: $remote_docker_dir\" >&2; exit 2 ;;
esac
mkdir -p $(quote_sh "$remote_docker_dir") $(quote_sh "$remote_data_dir/media") $(quote_sh "$remote_data_dir/postgres")
"

if [ "$dry_run" -eq 1 ]; then
  echo "Dry run: would prepare remote directories:"
  echo "$remote_prepare"
else
  ssh "$ssh_target" "$remote_prepare"
fi

if command -v rsync >/dev/null 2>&1; then
  rsync_args=(
    -az
    --delete
    --exclude node_modules/
    --exclude dist/
    --exclude artifacts/
    --exclude .env
    --exclude '.env.*'
    --exclude test/
    --exclude vitest.config.ts
  )
  if [ "$dry_run" -eq 1 ]; then
    rsync_args+=(--dry-run --itemize-changes)
  fi
  rsync "${rsync_args[@]}" "$server_dir/" "$ssh_target:$remote_docker_dir/"
else
  archive_path="${TMPDIR:-/tmp}/$app_name-deploy.tgz"
  tar -czf "$archive_path" -C "$server_dir" \
    Dockerfile docker-compose.yml docker-compose.lan.yml package.json package-lock.json \
    tsconfig.json drizzle src .dockerignore .env.example README.md
  if [ "$dry_run" -eq 1 ]; then
    echo "Dry run: would upload $archive_path to $ssh_target:$remote_archive and extract into $remote_docker_dir"
  else
    scp "$archive_path" "$ssh_target:$remote_archive"
    ssh "$ssh_target" "
set -eu
cd $(quote_sh "$remote_docker_dir")
rm -rf src drizzle dist
tar -xzf $(quote_sh "$remote_archive")
rm -f $(quote_sh "$remote_archive")
"
  fi
  rm -f "$archive_path"
fi

if [ -n "$env_file" ]; then
  if [ "$dry_run" -eq 1 ]; then
    echo "Dry run: would copy $env_file to $ssh_target:$remote_docker_dir/.env"
  else
    scp "$env_file" "$ssh_target:$remote_docker_dir/.env"
  fi
fi

build_flag="--build"
if [ "$skip_build" -eq 1 ]; then
  build_flag=""
fi

remote_deploy="
set -eu
cd $(quote_sh "$remote_docker_dir")
export ONGAKU_DATA_ROOT=$(quote_sh "$remote_data_dir")
if [ ! -f .env ] && [ \"$allow_default_env\" != \"1\" ]; then
  echo \"Missing $remote_docker_dir/.env. Pass --env-file <path> once, or use --allow-default-env intentionally.\" >&2
  exit 3
fi
if docker compose version >/dev/null 2>&1; then
  DC=\"docker compose\"
elif command -v docker-compose >/dev/null 2>&1; then
  DC=\"docker-compose\"
else
  echo \"Docker Compose is not installed on the remote host.\" >&2
  exit 4
fi
\$DC -p $(quote_sh "$app_name") -f docker-compose.yml -f docker-compose.lan.yml config >/dev/null
\$DC -p $(quote_sh "$app_name") -f docker-compose.yml -f docker-compose.lan.yml up -d $build_flag
healthcheck() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1
  else
    wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1
  fi
}
if [ \"$health_timeout\" -gt 0 ]; then
  deadline=\$((\$(date +%s) + $health_timeout))
  until healthcheck; do
    if [ \"\$(date +%s)\" -ge \"\$deadline\" ]; then
      echo \"Health check failed after ${health_timeout}s\" >&2
      \$DC -p $(quote_sh "$app_name") -f docker-compose.yml -f docker-compose.lan.yml ps >&2
      \$DC -p $(quote_sh "$app_name") -f docker-compose.yml -f docker-compose.lan.yml logs --tail=80 api >&2
      exit 5
    fi
    sleep 2
  done
fi
\$DC -p $(quote_sh "$app_name") -f docker-compose.yml -f docker-compose.lan.yml ps
"

if [ "$dry_run" -eq 1 ]; then
  echo "Dry run: would run remote deploy:"
  echo "$remote_deploy"
else
  ssh "$ssh_target" "$remote_deploy"
fi
