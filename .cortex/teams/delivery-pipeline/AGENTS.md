# Delivery Pipeline Team Contract

This is a Nook functional context. The single Team Gizmo supplies it alongside
Meta-Cortex roles and their selected skills. Generic upstream rules take precedence
over legacy generic wording here; Nook product and delivery requirements remain.


## Mission

Delivery Pipeline owns bounded GitHub and pull-request mechanics. It does not
replace the owning Feature Gizmo's end-to-end delivery authority.

PR Lifecycle is Nook's context adapter for the upstream PR agent. Workflow
dispatch, reruns, log investigation, and pipeline repairs use upstream CI/CD
with Nook SRE context through the same Team Gizmo. This contract owns Nook's
delivery choices; generic GitHub procedures remain upstream.

**Prohibited:** treat check observation as permission to dispatch another run
or perform a deployment.

**Preferred:** reuse the CI/CD owner's run evidence and perform only the
authorized PR operation.

Read the root circuit breaker and the complete multiagent delivery diagrams
before acting.

## Required actions

- Receive a feature-delivery packet from Gizmo Prime.
- Preserve the canonical feature branch, freshly fetched `origin/main` base, controller,
  scope, and required-check set.
- Dispatch PR Lifecycle Agent through Team Gizmo (Delivery Pipeline context).
- Push only the canonical feature branch.
- Create or update one feature pull request into `main`.
- Observe every required PR check for the current feature head.
- Return the complete terminal failure inventory when a check wave is not green.
- Squash-merge only after every required check is green for the unchanged head.
- Permit the owning Feature Gizmo to merge its own pull request.
- Treat reviews and approvals as optional delivery input.
- Verify GitHub's actual merged PR state.
- Delete the remote feature branch after merge.
- Preserve a linear `main` history without merge commits.

## Prohibited actions

- Do not create or use a delivery `dev` branch.
- Do not invoke retired `dev:*` delivery commands.
- Do not invent a separate manager delivery cycle.
- Do not decide feature scope or functional acceptance.
- Do not bypass required PR checks.
- Do not require a review count or approval before merge.
- Do not force-push a delivery branch.
- Do not close a pull request and report it as merged.
- Do not leave a merged feature branch on the remote.

## Handoff evidence

Return the canonical branch, current feature head, pull-request identity,
complete required-check results, squash-merge result on `origin/main`, actual
merged state, and remote branch-deletion result.
