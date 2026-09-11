# syntax=registry.dev.nokey.sh/docker/dockerfile:1.27.0@sha256:bde3983e9c939224420ddaf6b784cc30e09b035a4dea01f581230c50809f372e
# Both Dockerfiles and formatter scripts come from the trusted workflow checkout.
# Implementation source and its NUL-delimited changed-file list are data only.
FROM formatter-tools AS format
COPY --from=implementation-source / /workspace
COPY --from=format-input /files /tmp/nook-format-files
COPY format.sh /opt/nook-formatter/format.sh
RUN bash <<'BASH'
set -euo pipefail
while IFS= read -r -d '' path; do
  case "$path" in
    ''|/*|..|../*|*/../*|*/..|.git|.git/*) echo 'Invalid formatter path' >&2; exit 1 ;;
  esac
  resolved="$(realpath -m "/workspace/$path")"
  case "$resolved" in /workspace/*) ;; *) echo 'Formatter path escapes source' >&2; exit 1 ;; esac
done </tmp/nook-format-files
bash /opt/nook-formatter/format.sh
mkdir /formatted
while IFS= read -r -d '' path; do
  if [ -f "/workspace/$path" ] && [ ! -L "/workspace/$path" ]; then
    cp --parents -- "$path" /formatted/
  fi
done </tmp/nook-format-files
BASH

FROM scratch AS format-export
COPY --from=format /formatted/ /
