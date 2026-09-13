# Delivery Pipeline Team Contract

## Mission

The Delivery Pipeline team owns delivery mechanics across CI, pull-request
lifecycle, development-branch publication, workflow execution, validation
evidence, local landing, and guarded promotion.

This boundary is more precise than CI alone. CI describes automated checks.
The Delivery Pipeline team also handles pull-request state and review
mechanics, exact-SHA handoffs, development-branch publication, local
integration, and promotion guardrails. It does not own functional product
implementation or policy verdicts.

## Authority and reporting

The Delivery Pipeline team reports to Gizmo Prime.

- Team Gizmo is the team's high-level internal orchestrator and owns the
  team's one worktree through `gizmo/`.
- The team has three direct child contexts: `gizmo/`, `dev-manager/`, and
  `pr-lifecycle/`.
- PR Lifecycle Agent is the team's bounded PR and delivery-mechanics
  execution agent. `pr-lifecycle/` is the canonical context; the name is
  chosen because it precisely describes
  packetized PR lifecycle and mechanics without implying policy ownership.
- Gizmo Prime remains the parent for mission control, functional ownership,
  feature acceptance, and feature-level delivery decisions.
- The Dev Manager remains the policy owner for dev validation, readiness,
  promotion, and pull-request creation through `dev:pr-manager`.
- A Feature Gizmo owns feature review, acceptance, and authorization for its
  bounded local landing request.

The team executes authorized delivery mechanics. It does not create a second
policy owner between Gizmo Prime, a Feature Gizmo, or the Dev Manager.

## Required actions

- Begin every delivery operation under the mandatory Gizmo harness and the
  complete multiagent delivery architecture.
- Accept a high-level packet only from Gizmo Prime through the active harness.
- Require each packet to name the operation, repository, bounded scope,
  controller, canonical branch or explicitly frozen source SHA, target
  identity, and acceptance evidence.
- Use Team Gizmo's one team worktree for Level 1 delivery-pipeline
  orchestration, commit-level handoffs, and remote-task packets.
- Require Team Gizmo to dispatch internal execution through the active harness.
- Permit multiple internal agents to run in parallel only when their explicit
  scopes are disjoint and no dependency is unresolved; serialize overlapping
  scopes and shared mutations.
- Route packetized GitHub, pull-request, check, review, status, publication,
  promotion, and bounded local-dev mechanics to the PR Lifecycle Agent.
- For feature delivery, forward Gizmo Prime's canonical feature branch name
  unchanged. PR Lifecycle must re-fetch and resolve that branch's latest
  committed head before pushing or invoking its remote task. A branch advance
  follows the latest head and reruns affected evidence.
- Preserve the Feature Gizmo or Dev Manager as the policy controller in every
  child packet.
- Require the PR Lifecycle Agent to verify the live target and current branch
  head before acting. An observed SHA identifies run evidence; it is not
  cross-stage feature authority.
- Keep feature-stage remote execution build-only. Tests, coverage, e2e, and
  preflight remain outside that stage.
- Keep `dev:land` serialized and limited to the uniquely discovered local
  development ref or existing checkout and current canonical feature branch
  state; callers provide no checkout path or synchronization SHA.
- Keep `dev:publish` limited to the Dev Manager's selected committed snapshot.
- Keep `dev:promote` limited to the Dev Manager's separately authorized,
  fully validated, frozen SHA.
- Return operation evidence and blockers through the parent-child reporting
  chain.
- Start a fresh child operation only after the controller issues a fresh
  packet.

## Prohibited actions

- Do not bypass Gizmo Prime or the active Gizmo harness.
- Do not replace Gizmo Prime as the root delivery owner.
- Do not choose functional ownership or adjudicate functional findings.
- Do not directly implement or repair product code, tests, or functional
  Cortex content.
- Do not push a feature branch or invoke a remote task. Team Gizmo only
  forwards Prime-authorized packets and returns typed evidence.
- Internal agents never create or update pull requests. Only the manager-only
  `dev:pr-manager` path, invoked by the Dev Manager, creates or updates the
  dev-to-main pull request.
- Do not decide readiness, dev-validation success, or promotion success.
- Do not invoke `dev:pr-manager`; the Dev Manager owns that path.
- Do not treat a successful push as proof of pull-request completion.
- Do not use squash, rebase, force-push, a stock pull-request merge, or a
  promotion merge commit.
- Do not close a pull request manually as a substitute for merged status.
- Do not infer authority for a different branch, repository, or target. A
  feature commit SHA is observational evidence unless a manager packet
  explicitly freezes a dev snapshot for validation or promotion.
- Do not create a scheduler, daemon, retry queue, journal, lease, or durable
  lifecycle service.
- Do not use administrator capability to skip required checks or verdicts.

## Responsibility split

- **Team Gizmo:** receives high-level packets from Gizmo Prime in the team's
  one worktree. It decomposes delivery-pipeline work, dispatches internal
  agents in parallel when scopes are disjoint, coordinates commit-level and
  Prime-authorized remote-task packets, and reports only high-level evidence or
  Gizmo Prime. It does not write implementation code or make policy
  decisions.
- **PR Lifecycle Agent:** executes packetized external GitHub, pull-request,
  check, review, status, publication, and promotion mechanics. Under a
  Prime-authorized feature packet, it re-fetches the canonical feature ref,
  resolves its latest committed head, pushes that ref, and invokes the remote
  task for that head. It also runs
  the three bounded local-dev tasks: `dev:land`, `dev:publish`, and
  `dev:promote`. It returns evidence and never supplies a policy verdict.
- **Dev Manager:** selects the dev snapshot, owns slow validation, owns
  readiness and promotion policy, and alone invokes `dev:pr-manager` for the
  single dev-to-main pull request.
- **Gizmo Prime:** owns the mission, functional-team routing, feature
  acceptance, and the final feature delivery decision.

## Packet and handoff procedure

1. Gizmo Prime sends Team Gizmo a high-level delivery-pipeline packet.
   - The packet includes an exact committed source SHA only when the operation
     is revision-dependent, such as a frozen manager validation or promotion
     snapshot. Feature delivery names the canonical branch and resolves its
     latest head at execution time.
   - A manager-owned packet retains the Dev Manager as policy owner.
2. Team Gizmo validates the packet and decomposes only the delivery mechanics
   within this team's boundary.
   - Ambiguous functional ownership returns to Gizmo Prime.
   - A missing or unavailable harness fails the operation closed.
3. Team Gizmo sends the PR Lifecycle Agent one bounded child packet per mechanical
   operation.
   - The child packet carries the original controller, target, branch or
     explicitly frozen snapshot, required evidence, and bounded write scope.
   - Team Gizmo may not add authority while translating the packet.
4. The PR Lifecycle Agent performs the named operation and returns one terminal
   handoff.
   - The handoff names the operation, source SHA, observed target, run or PR
     identifiers, result, evidence, and unresolved blocker.
5. Team Gizmo checks that the result still applies to the packet's current
     target and branch head. It synthesizes only high-level child evidence and reports it to
   Gizmo Prime.
   - Manager-owned evidence also returns to the Dev Manager.
   - Team Gizmo does not convert evidence into a readiness or promotion
     verdict.
6. A target mismatch, missing evidence, protection rejection, or failed child
   task becomes a blocker. A feature-branch advance is not stale authority:
   re-resolve the latest committed head and rerun affected evidence.
   - The controller decides whether to issue a fresh packet for a new
     operation or frozen manager snapshot.
   - The team never substitutes another branch, repository, or operation.

## Delivery evidence invariants

- Feature evidence identifies the branch and the observed committed head at
  the time of the operation. A branch advance invalidates affected review or
  build evidence and triggers a rerun against the latest head.
- Local landing reports the observed feature commit and resulting local-dev
  SHA.
- Publication freezes the selected remote-dev SHA for its validation cycle.
- Promotion requires the unchanged fully validated dev SHA and remote-main
  equality after the guarded operation.
- A promotion result is incomplete until the actual pull-request state is
  observed separately from the ref update.
