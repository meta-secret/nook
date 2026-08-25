# syntax=registry.dev.nokey.sh/docker/dockerfile:1

FROM registry.dev.nokey.sh/oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS dependencies

WORKDIR /opt/nook-source-analysis
COPY agentic-ai/loom/package.json agentic-ai/loom/bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM registry.dev.nokey.sh/oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4

ARG SOURCE_ANALYSIS_BUILD_ID
LABEL dev.nokey.loom.source-analysis.build-id=${SOURCE_ANALYSIS_BUILD_ID}

WORKDIR /opt/nook-source-analysis
COPY --from=dependencies /opt/nook-source-analysis/node_modules/typescript node_modules/typescript

COPY agentic-ai/loom/src/executable-skills/source-policy.ts src/executable-skills/source-policy.ts
COPY agentic-ai/loom/src/executable-skills/source-analysis-codec.ts src/executable-skills/source-analysis-codec.ts
COPY agentic-ai/loom/src/executable-skills/source-analysis-worker.ts src/executable-skills/source-analysis-worker.ts
COPY agentic-ai/loom/tests/fixtures/source-analysis-allocation-bomb.ts acceptance/source-analysis-allocation-bomb.ts
COPY agentic-ai/loom/tests/fixtures/source-analysis-containment-probe.ts acceptance/source-analysis-containment-probe.ts
COPY agentic-ai/loom/tests/fixtures/source-analysis-hang.ts acceptance/source-analysis-hang.ts

ENV NOOK_SEALED_SOURCE_ANALYZER=1
USER 65532:65532
ENTRYPOINT ["bun", "run", "src/executable-skills/source-analysis-worker.ts"]
