#!/bin/sh
# Sustituye ${API_UPSTREAM} en el template y arranca nginx.
set -eu
envsubst '${API_UPSTREAM}' < /etc/nginx/templates/nginx.conf.template > /etc/nginx/conf.d/default.conf
exec "$@"
