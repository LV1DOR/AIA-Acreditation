#!/bin/sh
# Operator-only: check both sources even when either one reports a failure.
set -u
dependency=0
containers=0
/usr/bin/docker compose --env-file /etc/aia-accreditation/compose.env -f infra/production/compose.yaml --profile maintenance run --rm --no-deps tools node node_modules/tsx/dist/cli.mjs scripts/monitor.ts /run/operator-secrets/target.json || dependency=$?
/usr/bin/corepack pnpm exec tsx scripts/compose-monitor.ts /etc/aia-accreditation/release-manifest.json || containers=$?
if [ "$dependency" -ne 0 ] || [ "$containers" -ne 0 ]; then exit 1; fi
