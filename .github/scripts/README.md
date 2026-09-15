# GitHub and remote CI adapters

Keep this directory limited to process-bound adapters that are consumed by
GitHub Actions, remote execution, or local debug tooling, plus focused tests of
those adapters. Language-native infrastructure contracts live under
`infra/contracts/`; infrastructure shell is not stored there. Development
delivery lives in Loom, and workflow runtime libraries live under
`.github/workflows/lib/`. The Workbench CJS bridge is the deliberate exception
because both Actions and Loom invoke the same module directly.
