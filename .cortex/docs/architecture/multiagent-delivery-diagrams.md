# Nook Delivery Model

## Coordination

The active host launches Meta-Cortex Prime with Nook project context. Prime
directly selects specialists and independent verifiers from upstream catalogs
with Nook project scope. Prime owns the feature and its delivery outcome.

```mermaid
flowchart LR
    Host --> Prime["Meta-Cortex Prime + Nook context"]
    Prime --> Rust["Rust developer + Nook context"]
    Prime --> TS["TypeScript developer + Nook context"]
    Prime --> Writer["Tech writer + Nook context"]
    Prime --> Security["Security agent + Nook context"]
    Prime --> Verifier["Independent verifier + assigned scope"]
    Prime --> Integration["Upstream integration agent"]
    Prime --> Operations["Upstream SRE + Nook operations context"]
    Prime --> PR["Upstream PR agent + Nook PR operations specification"]
```

**Prohibited:** start an AI Prime, a Web Prime, and an SRE Prime for one feature.

**Preferred:** Prime sequences bounded assignments and evaluates the specialists'
returned evidence. Nook requirements stay in project documents.

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
intermediate result requested by the user. Migration work reaches the PR check
stage unless the user explicitly asks to stop earlier.
