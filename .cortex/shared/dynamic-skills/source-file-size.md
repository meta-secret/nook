# Nook Source Architecture Enforcement

Generic source-size and decomposition policy comes from Meta-Cortex
[programming requirements](../../../.meta-cortex/teams/dev-team/docs/programming/source-file-size.md).

## Required actions

Use Nook's repository-wide preflight scanner for the 1,000-line source limit
and inline Rust unit tests. Preserve integration tests. Run it in the authorized
PR-check stage.
Review the chosen architectural decomposition separately from the scanner result.

**Prohibited:** report a passing line count as proof of cohesive architecture.

**Preferred:** report the scanner result and the domain boundary used to split
an oversized module as separate evidence.
