#!/bin/sh
set -eu
# Explicit secret-file loading avoids depending on image entrypoint conventions.
# No xtrace, credentials in command arguments, or license data in environment.
test -s /run/secrets/minio_license
test -r /run/minio-certs/public.crt
test -r /run/minio-certs/private.key
MINIO_ROOT_USER="$(cat /run/secrets/minio_root_user)"
MINIO_ROOT_PASSWORD="$(cat /run/secrets/minio_root_password)"
test -n "$MINIO_ROOT_USER"
test -n "$MINIO_ROOT_PASSWORD"
export MINIO_ROOT_USER MINIO_ROOT_PASSWORD
exec minio "$@"
