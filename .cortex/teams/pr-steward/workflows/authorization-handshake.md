# Pull-Request Authorization Handshake

## Authority

PR Steward executes one bounded operation under a feature Gizmo or dev-manager
packet. The controller owns policy and verdicts. The active harness carries
the packet. It creates no persistent scheduler, journal, or retry service.

Follow [dev delivery](../../../gizmo/architecture/dev-delivery.md).

## Required actions

- **Packet identity**
  - Name the controller, repository, operation, and required evidence.
  - Revision-dependent operations name the expected source SHA.
  - PR operations name the base, head branch, PR number, and expected head.
  - Run operations name the run and attempt.
  - Workbench publication names exact content, destination, and expected blob SHA.
- **Allowed task authority**
  - A feature Gizmo authorizes remote build-only execution and bounded local integration.
  - A dev manager authorizes snapshot publication, slow PR checks, and fast-forward promotion.
  - A landing packet names the feature SHA and assigned local dev checkout.
  - The landing tool verifies positive build evidence and serializes integration.
  - A publication packet names the selected committed local dev snapshot.
  - A promotion packet names the frozen tested SHA and complete slow evidence.
  - Promotion also requires review/security verdicts and remote main ancestry.
- **Credential boundary**
  - The already authorized ADMIN identity may execute guarded publication.
  - This role boundary is policy-enforced rather than credential isolation.
  - A dedicated GitHub App is optional hardening.
  - Required checks remain mandatory regardless of credential capability.

## Procedure

1. Confirm the live repository, revision, and applicable target against the packet.
   - Any mismatch stops the operation.
2. Invoke only the named task or GitHub operation.
   - Shared-branch mutation is limited to the three bounded dev tasks.
   - Tooling enforces locks and revision guards.
3. Return observed SHAs, run identifiers, result URLs, and blockers.
4. Let the controller decide whether a fresh operation is authorized.
5. For promotion, verify remote main equals the tested SHA.
6. Read actual GitHub PR status and return it separately from the ref update.

## Prohibited actions

- Do not infer authority for another SHA, branch, repository, or operation.
- Do not grant Steward general shared-branch Git authority.
- Do not waive checks, security verdicts, or unresolved review findings.
- Do not use automatic administrator fallback after a rejection.
- Do not squash, rebase, force-push, or create a promotion merge commit.
- Do not manually close a PR as a substitute for merged status.
- Do not broaden scope or create a scheduler when an operation fails.

## Evidence

The packet and result must identify the same target. Report protection
rejections visibly. A successful push alone does not establish GitHub PR
completion. The controller owns the final verdict.
