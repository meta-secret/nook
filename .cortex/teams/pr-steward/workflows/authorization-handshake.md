# Pull-Request Authorization Handshake

Gizmo Prime authorizes each PR Steward operation through an ephemeral active
harness handoff. The handoff is not a scheduler, journal, retry queue, or
second delivery state machine.

## Required actions

1. **Send one operation packet.** Gizmo names the repository, target, requested
   operation, current scope, and required evidence.
   - PR operations include the base ref, branch, PR number, and expected head.
   - Repository or workflow-run operations name the repository or run identity.
     Do not invent a PR or head when neither applies.
   - Workbench publication names the exact parent-authored source, destination,
     commit message, and expected blob SHA when replacing a mutable record.
   - GitHub-backed Task, Loom, and script invocations require the same packet.
   - A reactive observation packet covers one check-observation iteration.
     It includes initial, relevant-event, and five-minute-inactivity snapshots.
     This permits no mutation or readiness verdict.
2. **Confirm the live target.** PR Steward verifies the named target before
   acting. For PR operations, re-read the pull request and exact head.
   - A mismatch is a blocker. PR Steward never infers authority for a new
     head, branch, repository, or operation.
3. **Perform the named operation.** PR Steward returns the observed head SHA,
   result, URLs or run identifiers, and any blocker.
4. **Evaluate the result.** Gizmo interprets technical findings, routes
   implementation work, and decides the next operation.
5. **Send a separate merge packet.** The packet names the exact head.
   It confirms that readiness evidence is complete.
   It confirms that required checks and deployments are complete.
   It confirms that review dispositions are complete.
   It confirms that functional and security verdicts are complete.
6. **Send a separate admin-merge packet for the path-excluded route.** Gizmo
   may use this route only when the pull-request path policy intentionally
   excludes the ruleset-required preview deployment.
   - The packet records the path-policy evidence.
   - The packet records that every applicable exact-head check passed.
   - The packet records a passing `task pr:ready PR=<number>` result.
   - The packet records that no applicable check, deployment, or review is
     failed or unresolved.
7. **Recheck merge preconditions.** PR Steward compares the live remote state
   with the merge packet.
   - Any mismatch stops the merge and returns a blocker.
   - An admin packet must still prove the path exclusion and every condition
     in step 6.
8. **Verify merge completion.** After the authorized squash merge, PR Steward
   reports the remote merge state and resulting commit to Gizmo.

## Prohibited actions

- PR Steward must not treat a prior packet as permission for a new operation.
- PR Steward must not merge because a check appears green while another
  required precondition is unresolved.
- PR Steward must not use `--admin` when an applicable check, deployment, or
  review is failed or unresolved.
- PR Steward must not invent a preview deployment or treat an absent
  deployment as path-excluded without packet evidence.
- PR Steward must not classify review findings or waive functional or security
  acceptance.
- PR Steward must not persist packet state or schedule later work.

## Validation

The packet and returned evidence identify the same repository and target.
Revision-dependent operations identify one exact head.
Every mutation has an explicit parent authorization.
An admin merge has a separate packet with path-policy evidence.
Gizmo retains the readiness, merge, and completion verdicts.
