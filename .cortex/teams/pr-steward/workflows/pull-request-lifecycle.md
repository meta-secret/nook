# Pull-Request Lifecycle

PR Steward performs the mechanical pull-request lifecycle after Gizmo Prime
has prepared a coherent exact head and supplied an operation packet.

## Outcome

The named pull-request operation completes against the packet's exact head.
PR Steward returns observable evidence or a bounded blocker.

## Inputs

- one repository and base ref;
- one branch and pull-request number;
- one expected head SHA;
- one named operation; and
- the evidence that Gizmo requires.

## Procedure

1. **Confirm the live target.** Re-read the pull request and compare the live
   repository, base, branch, number, and head with the packet.
   - Stop and report a blocker when any identity or head differs.
2. **Update pull-request metadata.** Create or update the title and
   description from the parent packet.
   - Keep the metadata faithful to the current diff and canonical pull-request
     contract.
3. **Observe review state.** Request the authorized review path and collect
   submitted review bodies, inline conversations, top-level comments, and
   unresolved threads.
   - Return the complete observed set without deciding whether a finding is
     technically valid or in scope.
4. **Observe validation state.** Collect failed checks, running checks,
   deployments, mergeability, and bounded wait outcomes for the exact head.
   - A selected successful job does not hide another required running or
     failed result.
5. **Retrigger named validation.** Dispatch only the exact-head validation
   operation named by Gizmo.
   - A retrigger does not authorize a new head or a new validation scope.
6. **Collect readiness evidence.** Run the read-only readiness evidence
   command when Gizmo requests it.
   - Return the command result as evidence. Gizmo decides readiness.
7. **Execute authorized merge.** Recheck the separate merge packet and run
   `gh pr merge <number> --squash` only when every named remote precondition
   still matches.
8. **Verify the remote result.** Confirm the pull request is merged and return
   the resulting commit, URL, run identifiers, and observed head.

## Failure handling

- A missing packet is a blocker for the named operation.
- A stale head or identity mismatch is a blocker for the named operation.
- An unavailable remote result is a blocker for the named operation.
- A failed required check is a blocker for the named operation.
- A missing deployment is a blocker for the named operation.
- An unresolved review thread is a blocker for the named operation.
- Report the smallest useful evidence for the blocker.
- Do not invent a retry, broaden the operation, or create a fallback path.
- Gizmo decides whether to route a correction, issue a fresh packet, or stop.

## Validation

- Every external mutation used the packet's repository, pull request, and
  exact head.
- Review and check observations were returned without technical adjudication.
- Bounded waits stayed inside the active task.
- A merge result is a verified squash merge when merge was authorized.
