# Nook Delivery Model

## Coordination

The active host launches Nook's wrapper of Meta-Cortex Prime. Prime launches
one Team Gizmo. It selects agents from upstream catalogs with Nook project scope.
A Feature Gizmo is Prime acting as feature owner, not another coordinator layer.

```mermaid
flowchart LR
    Host --> Prime["Nook Prime / Meta-Cortex Prime"]
    Prime --> Team["One Nook Team Gizmo / Meta-Cortex Team Gizmo"]
    Team --> Rust["Rust developer + Nook context"]
    Team --> TS["TypeScript developer + Nook context"]
    Team --> Writer["Tech writer + Nook context"]
    Team --> Security["Security agent + Nook context"]
    Team --> Integration["Upstream integration agent"]
    Team --> Operations["Upstream SRE + Nook operations context"]
    Team --> PR["Upstream PR agent + Nook PR Lifecycle context"]
```

**Prohibited:** start an AI Gizmo, a Web Gizmo, and an SRE Gizmo for one feature.

**Preferred:** one Team Gizmo sequences those bounded assignments and returns
combined evidence to Prime. Project-only roles remain until upstream covers them.

## Delivery

Follow the [feature-delivery contract](dev-delivery.md) for exact Nook stages.
For authorized full delivery, Prime starts a feature from freshly fetched main.
Workers operate in assigned scopes. The upstream integration agent merges their
branches into the feature branch and validates the combined result. PR Lifecycle
publishes only the canonical feature branch under Prime's authority.

```mermaid
flowchart LR
    Base["Fresh origin/main"] --> Work["Upstream local feature integration"]
    Work --> PR["Feature PR to main"]
    PR --> Checks["Required checks for current head"]
    Checks --> Decision{"All green?"}
    Decision -- No --> Repair["Complete diagnostics, consolidated repair"]
    Repair --> PR
    Decision -- Yes --> Merge["Authorized squash merge"]
    Merge --> Evidence["Verify merged state and delete remote branch"]
```

**Prohibited:** report a pushed branch or green subset of checks as full delivery.

**Preferred:** report merged-state and cleanup evidence, or the explicit
intermediate result requested by the user. No-check migration work stops at edits.
