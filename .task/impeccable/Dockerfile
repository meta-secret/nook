FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94

ARG IMPECCABLE_VERSION=3.4.0
ARG IMPECCABLE_SKILL_DIGEST=596c0b6949789a437968b4e9ee8feb126d5d9106afa13b190a8a20fa94b01418

RUN npm install --global --ignore-scripts --no-audit --no-fund "impeccable@${IMPECCABLE_VERSION}" \
    && test "$(impeccable --version)" = "${IMPECCABLE_VERSION}" \
    && npm cache clean --force

RUN mkdir -p /opt/impeccable-project \
    && cd /opt/impeccable-project \
    && impeccable skills install -y --providers=codex --scope=project --no-hooks \
    && test -f .agents/skills/impeccable/SKILL.md \
    && actual_digest="$(find .agents/skills/impeccable -type f -print0 \
      | LC_ALL=C sort -z \
      | xargs -0 sha256sum \
      | sha256sum \
      | cut -d ' ' -f 1)" \
    && test "${actual_digest}" = "${IMPECCABLE_SKILL_DIGEST}"

WORKDIR /workspace

ENTRYPOINT ["impeccable"]
