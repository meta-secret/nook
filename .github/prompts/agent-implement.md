You are implementing a task for the Nook monorepo via the **coding-bro** workflow.

## Task

${AGENT_TASK}

## Context

- Repository: ${GITHUB_REPOSITORY}
- Workflow run id: ${GITHUB_RUN_ID}
- Implementation branch (harness commits here — do not git): `${AGENT_BRANCH}`

Read `.cortex/AGENTS.md` and `.cortex/workflows/coding-bro.md` before making changes.

## CI toolchain (Docker)

The job runs `task setup` before you start (sealed **nook-web:local**). You run inside the
**nook-ci-agent** container with the repo bind-mounted and the host Docker socket mounted
(`/var/run/docker.sock` — sibling containers, not Docker-in-Docker). Prefer `task check` /
`task ci:pr` so validation uses the host daemon and the sealed nook-web image.
Use the repository Task targets for Docker validation; do not replace them with hand-written
`docker run` commands. The Task targets provide the bind-mount paths and git metadata required
by sibling containers on GitHub-hosted runners.

## Steps

1. Understand the task fully. Prefer the issue/prompt scope; do not expand into unrelated refactors.
2. **Always run prepare first** before verify, build, or e2e when those gates are needed (wasm must exist or `svelte-check` fails):
   ```bash
   task ci:pr:prepare
   ```
   Or the lighter path when only static checks apply: follow coding-bro local validation (`task check`).
3. Implement the change end-to-end in the working tree. Match existing conventions and package boundaries in `.cortex/ARCHITECTURE.md` / `.cortex/rules.md`.
4. Validate locally where practical (prefer cached Docker over cold remote CI):
   - Minimum: `task check`
   - When web/vault/sync flows change: `WASM_BUILD_MODE=prod task ci:pr` or scoped e2e via `E2E_SPEC=… task web:test:e2e:file`
5. If part of the request is too large, risky, blocked, or out of scope, follow `.cortex/workflows/issues.md` (update/create issues) rather than silently dropping work.

## Rules

- Do **not** run any `git` commands — the harness commits and pushes `${AGENT_BRANCH}` after you finish.
- Do **not** create or merge a PR — GitHub Actions opens the PR for explicit review and merge authorization.
- Do **not** commit secrets, `.env`, or credentials.
- Keep the diff focused on the requested task.
- Follow `.cortex/rules.md` (squash merge only; never kill Docker daemon — only stop containers).
