# GitHub and remote CI adapters

Keep this directory limited to process-bound adapters that are consumed by
GitHub Actions, remote execution, or local debug tooling. Domain contracts live
under `infra/contracts/`, development delivery lives in Loom, and workflow
runtime libraries live under `.github/workflows/lib/`. The Workbench CJS bridge
is the deliberate exception because both Actions and Loom invoke the same
module directly.
