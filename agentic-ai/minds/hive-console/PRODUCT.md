# Hive Control Center

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is the trusted Nook operator gradually moving repository work
to Hive. They need to understand what triggered each task, what the current
agent is doing, where work is blocked, and whether intervention is required.

## Product Purpose

The Control Center turns Hive's durable task graph and disposable worker
activity into one comprehensible operational view. Success means an operator
can assess the worker pool and explain any task's current state without reading
Neo4j queries or reconstructing a timeline from Kubernetes logs.

## Positioning

The surface is a projection of Hive's durable task, lease, attempt, dependency,
and sanitized activity state. It is not a generic Kubernetes dashboard and
does not treat ephemeral Pod logs as the system of record.

## Operating Context

Operators use the dashboard during normal task execution, Main-repair delivery,
worker replacement, failure diagnosis, and gradual expansion of Hive-triggered
work. GitHub pull requests, Actions runs, Workbench records, and source
revisions remain delivery evidence.

## Capabilities and Constraints

- The first release is read-only.
- Neo4j credentials and arbitrary graph queries never reach the browser.
- Activity is bounded, sanitized, and excludes secrets, raw command output, and
  model chain-of-thought.
- Worker Pods are disposable; operator history must survive their replacement.
- English and Russian operator copy remain equivalent.

## Evidence on Hand

The repository contains the implemented Hive task graph, worker pool,
coordinator, dispatcher, bounded queue projection, Kubernetes manifests, and
Nook's incumbent semantic color tokens. No operator-dashboard screenshots or
external visual references are treated as product evidence.

## Product Principles

- Explain why work exists before exposing implementation detail.
- Make attention and staleness obvious without alarm fatigue.
- Prefer durable lifecycle facts over inferred status.
- Keep observation useful even when no task is running.
- Add control authority only after displayed state is trustworthy.

## Accessibility & Inclusion

The dashboard must be keyboard operable, responsive at phone and desktop
widths, readable in light and dark system themes, and clear without relying on
color alone.
