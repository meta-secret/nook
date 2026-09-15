# Pull-Request Authorization Handshake

## Authority

Delivery Pipeline Team Gizmo dispatches PR Lifecycle Agent for one bounded operation
under a feature Gizmo or dev-manager packet. The controller owns policy and
verdicts. The active harness carries the packet. It creates no persistent
scheduler, journal, or retry service.

Follow [dev delivery](../../../../gizmo-prime/architecture/dev-delivery.md).

## Trust boundary

The active Codex thread and harness are a trusted orchestration environment.
The packet is a typed scope and authority description, not an untrusted wire
message. The child trusts the named parent and the parent trusts the child's
typed result. Neither side encrypts, signs, issues a one-shot capability,
persists a receipt, tracks anti-forgery/replay state, or introduces a second
agent to re-prove that handoff.

Checks below apply to the requested operation and real external state: the
live repository, branch, commit, PR, run, GitHub result, credential boundary,
artifact, publication, or promotion target. They do not authenticate another
agent in the same thread.

## Required actions

- **Packet identity**
  - Name the controller, repository, operation, and required evidence.
  - Revision-dependent operations name the expected source SHA when a manager
    packet freezes a validation or promotion snapshot.
  - PR operations name the base, head branch, and PR number; the current head
    is re-resolved before each operation and recorded as evidence.
  - Run operations name the run and attempt.
  - Workbench publication names exact content, destination, and expected blob SHA.
- **Parent and controller**
  - Delivery Pipeline Team Gizmo is the execution parent.
  - The feature Gizmo or Dev Manager remains the policy controller named in
    the packet.
  - Team Gizmo may translate packet shape but may not add authority.
- **Allowed task authority**
  - Gizmo Prime authorizes the canonical feature branch name; Delivery
    Pipeline routes that packet to PR Lifecycle, which re-fetches and resolves
    the latest committed head for the required branch push and remote
    build-only execution.
  - A Feature Gizmo authorizes bounded local integration after it receives the
    resulting evidence.
  - A dev manager authorizes snapshot publication, slow PR checks, and fast-forward promotion.
  - A landing packet names only the canonical feature branch. The landing
    implementation discovers any existing local `dev` checkout from canonical
    Git worktree metadata and resolves all synchronization refs internally;
    caller path and SHA fields are not accepted.
  - The landing tool verifies positive build evidence for the current branch
    head and serializes integration.
  - A publication packet names the selected committed local dev snapshot.
  - A promotion packet names the frozen tested SHA and complete slow evidence.
  - Promotion also requires review/security verdicts and remote main ancestry.
- **Credential boundary**
  - The already authorized ADMIN identity may execute guarded publication.
  - This role boundary is policy-enforced rather than credential isolation.
  - A dedicated GitHub App is optional hardening.
  - Required checks remain mandatory regardless of credential capability.

## Procedure

1. Confirm the live repository, branch or frozen revision, and applicable target
   against the packet. A feature branch advance is followed by re-resolving its
   latest committed head; another repository or target stops the operation.
2. Invoke only the named task or GitHub operation.
   - Shared-branch mutation is limited to the three bounded dev tasks.
   - Tooling enforces locks and revision guards.
3. Return observed SHAs, run identifiers, result URLs, and blockers to Team
   Gizmo in one terminal handoff.
4. Let the policy controller decide whether a fresh operation is authorized.
5. For promotion, verify remote main equals the tested SHA.
6. Read actual GitHub PR status and return it separately from the ref update.

## Prohibited actions

- Do not infer authority for another branch, repository, or operation. Feature
  SHAs are observations unless a manager packet explicitly freezes a snapshot.
- Do not push a temporary leaf or Team Gizmo branch. Do not invoke `task
  remote` or `workflow_dispatch` while checked out on a temporary branch.
- Do not grant PR Lifecycle Agent general shared-branch Git authority.
- Do not waive checks, security verdicts, or unresolved review findings.
- Do not use automatic administrator fallback after a rejection.
- Do not squash, rebase, force-push, or create a promotion merge commit.
- Do not manually close a PR as a substitute for merged status.
- Do not broaden scope or create a scheduler when an operation fails.

## Evidence

The trusted packet and typed result identify the same target so the controller
can correlate the operation without independently re-verifying the child.
Report protection
rejections visibly. A successful push alone does not establish GitHub PR
completion. Team Gizmo forwards the evidence. The controller owns the final
verdict.
