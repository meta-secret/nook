# nook-web

Bun, Vite, and Svelte front end for the Nook monorepo.

Use the Taskfile command surface for app commands. They work from the repo root
or from `nook-app/` because `nook-app/Taskfile.yml` owns the app tasks and the
root `Taskfile.yml` includes them:

```sh
task web:dev
task web:check
task web:build
task web:test:e2e
task web:test:e2e:local
```

Copy `.env.test.example` to `.env.test.local` and set `NOOK_GITHUB_PAT` for GitHub e2e suites.
