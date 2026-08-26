# Team-Oriented Development

## Purpose

Route Nook implementation through the `dev-core`, `sre`, and `web-dev` ownership boundaries.

Use this skill whenever a request touches code, scripts, infrastructure, tests, or Cortex owned by one or more engineering teams.

## Preferred pattern

1. Read [Engineering team ownership](../architecture/team-ownership.md).
2. Classify every functional unit before assigning files.
3. Delegate each independently bounded unit to its team agent when available.
4. Keep every team agent inside its declared code and Cortex scope.
5. Route cross-team dependencies through the delivery owner.
6. Require each team to implement its own tests, Cortex updates, and review fixes.
7. Keep shared files and lifecycle mutations in the parent-owned join.
8. Follow [Team-oriented development](../workflows/team-oriented-development.md) for execution and validation.

## Scope

This skill does not replace module ownership, internal API review, or subagent evidence rules.

- Use module experts inside the selected team when a production module boundary changes.
- Use the internal API expert when a contract crosses modules or teams.
- Follow the universal subagent workflow for baselines, isolation, views, and joins.

## Validation

Confirm that every changed path has one team owner and that no team agent crossed its declared boundary.
