# Infrastructure contracts

This directory contains executable contracts for infrastructure providers,
manifests, container wiring, cache transport, and network recovery. The
owning Taskfiles under `infra/tasks/` invoke these checks directly. GitHub
Actions-only adapters remain under `.github/scripts/`; repository policy that
must run before product setup remains in `preflight/`.
