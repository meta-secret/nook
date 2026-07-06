# CodeRabbit Agent Workflow

Use CodeRabbit as an extra AI review signal during agent work. It is useful for
finding logic errors, risky edge cases, missing tests, and security smells before
the PR review round-trip gets expensive.

CodeRabbit does **not** replace Nook's required gates:

- `task format` / `task format:check`
- `task check`
- relevant e2e or `task ci:pr`
- app-log inspection for web/e2e failures
- human judgment on architecture and product fit

## Local CLI setup

Install the CLI once per machine:

```bash
curl -fsSL https://cli.coderabbit.ai/install.sh | sh
```

Authenticate before expecting repository-aware reviews:

```bash
coderabbit auth login
coderabbit auth status
```

If startup, auth, git metadata, or service connectivity looks wrong, run:

```bash
coderabbit doctor
```

`cr` is an alias for `coderabbit` when the install has placed it on `PATH`.

## Agent review loop

Run CodeRabbit after a nontrivial implementation is locally coherent and before
the final commit/push:

```bash
coderabbit review --agent --type uncommitted
```

Use `--agent` for AI agents because it emits structured findings with severity,
file path, suggested fix direction, and agent-oriented codegen instructions.
Prefer this loop:

1. Implement the requested change.
2. Run the focused local checks needed to prove the change is not obviously
   broken.
3. Run `coderabbit review --agent --type uncommitted`.
4. Fix `critical` and `major` findings when they are valid. Consider `minor`
   findings when they point to real behavior, tests, security, or maintainability
   concerns. Ignore style nits that conflict with `.cortex`, existing local
   patterns, or the user's requested scope.
5. Re-run CodeRabbit once after meaningful fixes. Stop after two CodeRabbit
   passes unless the user explicitly asks for deeper review cycling.
6. Run the required Nook gates (`task check` minimum, plus e2e/`task ci:pr` when
   warranted), then commit and push.

For small documentation-only, formatting-only, mechanical rename, or trivial
test-expectation changes, CodeRabbit is optional. Do not burn time or rate limit
on reviews that cannot add useful signal.

## Useful scopes

Use the narrowest useful review scope:

```bash
# Current working tree, before commit
coderabbit review --agent --type uncommitted

# Committed branch work
coderabbit review --agent --type committed

# Compare against main explicitly
coderabbit review --agent --base main

# Faster feedback while still actively shaping code
coderabbit review --light

# Re-read the latest local findings without starting a new review
coderabbit review findings
```

The target directory must be an initialized Git repository. When reviewing a
different checkout, use `--dir <path>` only after confirming that path is the
intended repo.

## PR review management

CodeRabbit's GitHub PR review and the local CLI review are different signals.
The local CLI is best before commit/push; GitHub PR commands are best after the
PR exists and the branch changed.

Use PR comments only when CodeRabbit is installed for the repository and the PR
needs GitHub-side review control:

```text
@coderabbitai review
```

Use this after an agent pushed new commits and wants focused feedback on the
latest changes, or when automatic reviews are disabled.

```text
@coderabbitai full review
```

Use this after large rewrites, draft-to-ready transitions, or cross-cutting
changes where CodeRabbit should reassess the whole PR from scratch.

```text
@coderabbitai pause
@coderabbitai resume
```

Pause while an agent is about to push several rapid follow-up commits and resume
when the branch is ready for another review. Do not leave reviews paused when
handing work back to the user.

```text
@coderabbitai approve
```

Use only after CodeRabbit comments have been addressed and the repo is configured
to use CodeRabbit approval/request-changes workflow. This resolves CodeRabbit
threads and asks it to approve; it does not replace green CI or required human
approval.

Avoid `@coderabbitai autofix` unless the user asks for CodeRabbit to directly
write commits. In normal Nook work, agents should read findings, apply fixes
deliberately, run local gates, and keep branch history understandable.

## Completion notes

When CodeRabbit was run, mention the command, the highest severity found, and
which findings were fixed or intentionally ignored. If CodeRabbit could not run
because authentication or rate limits blocked it, say that clearly and continue
with the required Nook validation gates.
