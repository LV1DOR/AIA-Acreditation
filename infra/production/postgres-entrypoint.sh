#!/bin/sh
set -eu
# The official entrypoint requires root only to prepare volume/key ownership, then drops to postgres.
install -d -o postgres -g postgres -m 0700 /var/lib/postgresql/tls
install -o postgres -g postgres -m 0600 /run/secrets/postgres_key /var/lib/postgresql/tls/server.key
exec /usr/local/bin/docker-entrypoint.sh "$@"
