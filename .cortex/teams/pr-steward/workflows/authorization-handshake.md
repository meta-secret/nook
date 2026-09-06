# Pull-Request Authorization Handshake

Gizmo Prime authorizes each PR Steward operation through an ephemeral active
harness handoff. The handoff is not a scheduler, journal, retry queue, or
second delivery state machine.

## Required actions

1. **Send one operation packet.** Gizmo names the repository, base ref,
   branch, pull-request number, expected head SHA, current scope, requested
   operation, and required evidence.
2. **Confirm the live target.** PR Steward re-reads the pull request and exact
   head before acting.
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
6. **Recheck merge preconditions.** PR Steward compares the live remote state
   with the merge packet.
   - Any mismatch stops the merge and returns a blocker.
7. **Verify merge completion.** After the authorized squash merge, PR Steward
   reports the remote merge state and resulting commit to Gizmo.

## Prohibited actions

- PR Steward must not treat a prior packet as permission for a new operation.
- PR Steward must not merge because a check appears green while another
  required precondition is unresolved.
- PR Steward must not classify review findings or waive functional or security
  acceptance.
- PR Steward must not persist packet state or schedule later work.

## Validation

The packet and the returned evidence identify one pull request and one exact
head.
Every mutation has an explicit parent authorization.
Gizmo retains the readiness, merge, and completion verdicts.
