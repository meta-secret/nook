# Multiagent Delivery Visual Model

## Status and authority

This document is the mandatory first read and primary end-to-end explanation
for multiagent delivery. Every Feature Gizmo, Team Agent, reviewer, PR Steward,
Dev Manager, and repair Gizmo reads it completely before acting in the
workflow.

These diagrams define stage ownership, boundaries, feedback loops, and
exact-SHA handoffs. After identifying the current level and role, follow the
canonical [dev delivery contract](dev-delivery.md) for detailed authorization,
evidence, and failure rules when a diagram omits an operational edge case.

Flowcharts show lifecycle and retry behavior. Sequence diagrams show component
communication without duplicating every retry. At each higher level, the
previous level becomes one component.

## Mandatory Gizmo invocation gate

Every implementation or delivery run must begin with an invocation of Gizmo
Prime. Gizmo Prime must dispatch the required bounded Team Agents through the
active Gizmo harness before any worker-executable implementation, repair,
review, validation, external check, GitHub operation, local landing, dev
validation, or main-promotion work proceeds. Delegation is mandatory even when
the work appears small or its file scopes are disjoint.

If Gizmo Prime or the Team Agent harness is missing or unavailable, the run is
failed closed. Stop all implementation, validation, GitHub, and landing work
and report the blocker. Direct execution by a non-Gizmo root, including an
ordinary Codex task, thread, cloud task, or external agent, is not a fallback
and cannot substitute for Gizmo dispatch.

## Delivery overview

```mermaid
flowchart LR
    Feature["Feature Gizmo<br/>and Team Agents"]
    Checks["External checks"]
    Parallel["Parallel Feature Gizmos"]
    Dev["Local dev integration"]
    Validation["Dev Manager validation"]
    Main["origin/main"]

    Feature --> Checks --> Parallel --> Dev --> Validation --> Main
```

## Level 1: Feature Gizmo and Team Agents

The Feature Gizmo owns planning, delegation, review, team-commit integration,
and feedback routing. Team Agents work in isolated child worktrees. Code review
and remote type safety appear here as one external-check boundary.

### Flow

```mermaid
flowchart LR
    Request([Feature requested])
    GizmoPlan["Gizmo:<br/>planning"]
    Teams["Team Agents"]
    GizmoManagement["Gizmo:<br/>reviews and merges team commits"]
    Checks["External checks"]
    Green{"Green?"}
    Feedback["Gizmo:<br/>routes feedback to responsible team"]
    Ready([Feature ready])

    Request --> GizmoPlan --> Teams --> GizmoManagement --> Checks --> Green
    Green -- No --> Feedback --> GizmoPlan
    Green -- Yes --> Ready
```

### Component communication

```mermaid
sequenceDiagram
    autonumber

    box Feature worktree
        participant Gizmo as gizmo:feature-a
        participant Code as team:code-dev
        participant Web as team:web-dev
    end

    box External checks
        participant Checks as external:feature-checks
    end

    Gizmo->>Gizmo: Plan complete feature
    Gizmo->>Code: Assign Rust and domain work
    Gizmo->>Web: Assign web work

    par Rust and domain work
        Code->>Code: Work in isolated child worktree
        Code-->>Gizmo: Committed Rust SHA
    and Web work
        Web->>Web: Work in isolated child worktree
        Web-->>Gizmo: Committed web SHA
    end

    Gizmo->>Gizmo: Inspect and merge Team Agent commits
    Gizmo->>Gizmo: Push exact integrated SHA
    Gizmo->>Checks: Validate exact SHA
    Checks-->>Gizmo: Green result or feedback

    Note over Gizmo,Checks: Failed checks restart the Level 1 flow
```

## Level 2: External feature checks

This level expands `external:feature-checks`. Review and remote compilation are
separate checks internally, but they return one exact-SHA verdict to the Feature
Gizmo. The remote task is build-only: it does not run tests, coverage, e2e, or
preflight.

### Flow

```mermaid
flowchart LR
    Gizmo["Feature Gizmo:<br/>submits exact SHA"]
    Review["Code review"]
    Accepted{"Accepted?"}
    TypeSafety["Remote type-safety check"]
    Green{"Green?"}
    Feedback["Feature Gizmo:<br/>receives check feedback"]
    Ready([Verified feature SHA])

    Gizmo --> Review --> Accepted
    Accepted -- No --> Feedback --> Gizmo
    Accepted -- Yes --> TypeSafety --> Green
    Green -- No --> Feedback
    Green -- Yes --> Ready
```

### Component communication

```mermaid
sequenceDiagram
    autonumber

    box Feature implementation
        participant Feature as gizmo:feature-a-and-teams
    end

    box External feature checks
        participant Review as check:code-review
        participant Steward as team:pr-steward
        participant Build as remote:build-compile
    end

    box Feature delivery
        participant Delivery as feature:verified
    end

    Feature->>Review: Review exact feature SHA
    Review-->>Feature: Accepted SHA or findings
    Feature->>Steward: Authorize build:compile for accepted SHA
    Steward->>Build: Dispatch build-only task
    Build-->>Steward: Exact-SHA compilation result
    Steward-->>Feature: Green evidence or diagnostics
    Feature->>Delivery: Deliver green exact SHA

    Note over Feature,Build: Any failure returns to Level 1
```

## Level 3: Parallel feature development

Every feature has an independent Gizmo, feature branch, worktree, Team Agents,
and external-check loop. No feature PR or global feature scheduler coordinates
them.

### Flow

```mermaid
flowchart LR
    Requests([Feature requests])
    GizmoA["Gizmo:<br/>feature A"]
    GizmoB["Gizmo:<br/>feature B"]
    GizmoC["Gizmo:<br/>feature C"]
    Dev["Local dev integration"]

    Requests --> GizmoA --> Dev
    Requests --> GizmoB --> Dev
    Requests --> GizmoC --> Dev
```

### Component communication

```mermaid
sequenceDiagram
    autonumber

    box Feature requests
        participant Users as users
    end

    box Parallel feature delivery
        participant A as gizmo:feature-a
        participant B as gizmo:feature-b
        participant C as gizmo:feature-c
    end

    box Local integration
        participant Landing as local:dev-landing
    end

    par Feature A
        Users->>A: Implement feature A
        A->>A: Complete Levels 1 and 2
        A-->>Landing: Authorize dev:land for green SHA A
    and Feature B
        Users->>B: Implement feature B
        B->>B: Complete Levels 1 and 2
        B-->>Landing: Authorize dev:land for green SHA B
    and Feature C
        Users->>C: Implement feature C
        C->>C: Complete Levels 1 and 2
        C-->>Landing: Authorize dev:land for green SHA C
    end
```

## Level 4: Local dev integration

Git is the coordination layer. Each Feature Gizmo authorizes its own bounded
`dev:land`; PR Steward executes the ordinary merge under the serialized local
integration task. There is no feature PR and no publication of `dev` here.

### Flow

```mermaid
flowchart LR
    Gizmo["Feature Gizmo:<br/>verified SHA"]
    Landing["PR Steward:<br/>runs dev:land"]
    Result{"Git result"}
    Retry["Feature Gizmo:<br/>retries landing"]
    Resolve["Feature Gizmo and teams:<br/>reconcile with local dev"]
    Checks["External checks"]
    Dev["Local dev:<br/>updated"]
    Complete([Feature complete])

    Gizmo --> Landing --> Result
    Result -- Lock busy --> Retry --> Landing
    Result -- Conflict --> Resolve --> Checks --> Landing
    Result -- Success --> Dev --> Complete
```

### Component communication

```mermaid
sequenceDiagram
    autonumber

    box Parallel Feature Gizmos
        participant A as gizmo:feature-a
        participant B as gizmo:feature-b
    end

    box Serialized local integration
        participant Steward as team:pr-steward
        participant Git as task:dev-land
        participant Dev as branch:local-dev
    end

    box Dev lifecycle
        participant Manager as agent:dev-manager
    end

    par Independent landing requests
        A->>Steward: Authorize dev:land for green SHA A
    and
        B->>Steward: Authorize dev:land for green SHA B
    end

    Steward->>Git: Merge SHA A under integration lock
    Git->>Dev: Advance local dev
    Git-->>Steward: Feature SHA and resulting dev SHA
    Steward-->>A: Landing evidence

    Steward->>Git: Merge SHA B under integration lock
    Git->>Dev: Advance local dev
    Git-->>Steward: Feature SHA and resulting dev SHA
    Steward-->>B: Landing evidence

    Dev-->>Manager: New local dev snapshot available

    Note over A,Git: Lock retries and conflict repair follow the Level 4 flow
```

## Level 5: Dev validation and main promotion

The manually started Dev Manager is the sole owner of dev publication, slow
validation, repair delegation, readiness, and promotion. PR Steward performs
only manager-authorized mechanics. Local `dev` may continue receiving features
while the published `origin/dev` SHA remains frozen for its validation cycle.

### Flow

```mermaid
flowchart LR
    Dev["Local dev:<br/>new commits"]
    Select["Dev Manager:<br/>selects snapshot"]
    Publish["Dev Manager:<br/>invokes dev:publish"]
    PR["Dev PR Manager:<br/>creates or updates dev to main PR"]
    Checks["GitHub:<br/>full slow checks"]
    Green{"Green?"}
    Fix["Dev Manager:<br/>starts repair Gizmo"]
    Promote["Dev Manager:<br/>invokes dev:promote"]
    Main([Main updated])

    Dev --> Select --> Publish --> PR --> Checks --> Green
    Green -- No --> Fix --> Dev
    Green -- Yes --> Promote --> Main
```

### Component communication

```mermaid
sequenceDiagram
    autonumber

    box Local feature integration
        participant Dev as branch:local-dev
    end

    box Dev management
        participant Manager as agent:dev-manager
        participant Repair as gizmo:repair-dev
    end

    box Authorized mechanics
        participant Steward as team:pr-steward
    end

    box GitHub validation and promotion
        participant OriginDev as origin:dev
        participant PR as PR:dev-to-main
        participant CI as full:slow-checks
        participant Main as origin:main
    end

    Dev-->>Manager: Committed local dev snapshot available
    Manager->>OriginDev: Invoke dev:publish for selected SHA
    Manager->>PR: Invoke dev:pr-manager
    PR->>PR: Create or update the single dev-to-main PR
    PR->>CI: Validate captured dev SHA
    CI-->>Steward: Exact-SHA check evidence
    Steward-->>Manager: Validation result

    Manager->>Repair: On failure, repair current local dev
    Repair->>Dev: Land repair through Levels 1 through 4

    Manager->>Main: Invoke dev:promote after approval
    Main-->>Manager: Confirm remote main equality
    Manager->>PR: Verify actual merged state

    Note over Dev,OriginDev: Local dev may advance while origin/dev is frozen
    Note over OriginDev,Main: Squash, rebase, and promotion merge commits are prohibited
```

## Delivery invariants

- A Feature Gizmo exits Level 1 only with resolved required review findings and
  green remote compilation evidence for the exact final feature SHA.
- Feature-stage remote execution is build-only. Full tests belong only to the
  Dev Manager's dev-to-main PR.
- Team Agents mutate isolated child worktrees and return committed iterations.
- Feature Gizmos never publish `dev` or `main`.
- Feature Gizmos and Team Agents never create or update pull requests.
- `dev:land` serializes shared local-dev mutations and never creates a feature
  PR.
- `dev:pr-manager` is the sole pull-request creation/update path and operates
  only on the manager-selected `origin/dev` snapshot.
- The Dev Manager freezes each published `origin/dev` SHA for its validation
  cycle while newer features may continue landing locally.
- Promotion fast-forwards `main` to the exact fully validated dev SHA.
- Squash, rebase, force-push, and promotion merge commits are prohibited.
