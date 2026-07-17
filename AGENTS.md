# Nook Agent Entry Point

Read [`.cortex/AGENTS.md`](.cortex/AGENTS.md) before making changes in this
repository. It is the system of record for architecture, product context, rules,
and workflows.

## Review guidelines

- Treat violations of [`.cortex/AGENTS.md`](.cortex/AGENTS.md) or its linked
  architecture and workflow rules as P1 findings.
- Treat weakened cryptographic, authentication, authorization, device-identity,
  or vault-storage boundaries as P1 findings, including plaintext secret
  persistence or sensitive data in logs.
- Flag business or validation logic added to TypeScript/Svelte when it belongs
  in `nook-core` and should be exposed through the typed Rust/WASM boundary.
- Require behavior-focused Rust tests for changed domain logic and targeted web
  tests for changed user flows; do not accept e2e coverage as a substitute for
  domain tests.
- Flag authored TypeScript/Svelte `null`, visible inline English instead of the
  shared translation catalogs, and undocumented schema or storage migrations.

## Cursor Cloud specific instructions

This repo is fully Docker-orchestrated: everything (Rust, Bun, Node, wasm tooling)
lives inside Docker images built via `Task` + `docker buildx bake`. The host only
needs Docker and `Task`, which are already installed and persisted in the VM
snapshot. Standard commands live in `README.md` ("Run locally"/"Development") and
the `Taskfile.yml` includes; the notes below are only the non-obvious cloud
caveats discovered during setup.

- **Start the Docker daemon each boot.** There is no systemd here, so `dockerd`
  is not auto-started. Run once per session: `sudo dockerd > /tmp/dockerd.log 2>&1 &`
  then wait until `docker info` succeeds. The daemon is configured with the
  `fuse-overlayfs` storage driver (required in this Firecracker VM; native
  `overlay2` nested mounts fail). If `docker` needs sudo, run
  `sudo chmod 666 /var/run/docker.sock`.
- **Always build with the `nook-builder` buildx builder, not the default one.**
  Export `BUILDX_BUILDER=nook-builder` for every `task` that builds images
  (`setup`, `setup:rust*`, `web:dev`, `ci:*`, etc.). Reason: with the default
  `docker` builder (embedded BuildKit on fuse-overlayfs), the sccache server's
  leftover Unix socket `/tmp/nook-sccache.sock` gets committed into the image
  layer, so the second `cargo chef cook` step fails with
  `sccache: error: Address in use (os error 98)`. The `docker-container` builder
  uses a snapshotter that discards the socket. Create it if missing:
  `docker buildx create --name nook-builder --driver docker-container --driver-opt network=host --bootstrap`.
- **Exception — mkcert HTTPS uses the default builder.** Run `task web:https:setup`
  WITHOUT the `BUILDX_BUILDER` override. It uses plain `docker build` + `docker run`;
  the `docker-container` builder does not `--load` the image into the daemon, so
  `docker run nook-mkcert:local` would fail to find it. The default builder writes
  straight into the daemon and mkcert is a trivial build (no sccache concern).
- **Disk pressure / `no space left on device`.** The `nook-builder` state volume
  accumulates coverage-instrumented Rust snapshots and can grow to ~190 GB,
  filling the disk mid-build (seen during `task setup`). `docker buildx prune`
  usually will not release it. Reclaim by recreating the builder:
  `docker buildx rm nook-builder && docker buildx create --name nook-builder --driver docker-container --driver-opt network=host --bootstrap`.
  This does not remove already-loaded images (e.g. `nook-rust-browser:local`).
- **Run the app:** `BUILDX_BUILDER=nook-builder task web:dev` (after
  `task web:https:setup`) serves https://localhost:5173/ (landing) and
  https://localhost:5173/app/ (unified local vault harness) from a container that
  mounts the repo and rebuilds WASM at startup. Note `web:dev`'s `setup:rust:browser`
  dep re-exports the ~6.7 GB image tarball on each start, so first paint takes a
  few minutes.
- **Fast web lint/test/typecheck without the slim image build:** `docker exec`
  into the running `web:dev` container (`nook-rust-browser:local`) and run
  `cd nook-app/nook-web/nook-web-app && bun run test` / `bun run lint` /
  `bun run check`. This reuses the container's node_modules + built WASM and skips
  the heavy, disk-hungry `task setup` (nook-web:local) build. Rust tests/clippy/
  coverage run inside the image build (`task setup`'s prepare group /
  `task ci:pr:rust`).
- **Manual vault testing needs WebAuthn.** Simple-vault "Standard" protection
  requires a PRF-capable passkey. In a browser without one, enable Chrome
  DevTools' Virtual Authenticator (ctap2, internal transport, resident keys +
  user verification). It lacks PRF, so Nook falls back to a local PIN, which lets
  you create and unlock a Simple vault for manual UI testing.
