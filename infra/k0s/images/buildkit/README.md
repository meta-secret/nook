# BuildKit native cache patch

This derivative changes only the daemon binary in the official rootless
BuildKit 0.34.1 image. It retains the image's user, entrypoint, rootless helpers,
buildctl, filesystem layout, and configuration defaults. No deployment manifest
selects this image automatically.

## Immutable inputs

| Input                                   | Identity                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------- |
| Official BuildKit 0.34.1 source archive | SHA256 `0f7d4a765b273359d0752aa1c8a309606578fd0db42e71f0fc5de845d3b1139b` |
| Go 1.26.8 Bookworm image index          | SHA256 `dc9ad6c05acc7a88e5b71bde60a5fe3bd4b9f0db209011711b464107438a8107` |
| Official rootless runtime image index   | SHA256 `f68752a5a94acfcdad2d07867b7075601a421638e17fc5f28efc1c814d0c4f89` |
| Three-file production patch             | SHA256 `06f395c676539fc545deb3d5fe7af146af1de2346d23191e6a9637f793082985` |

The source archive comes from the official release tag and is verified by its
checksum. It contains no Git checkout; the binary reports the patch checksum
as its revision, without claiming an upstream commit. Version
`v0.34.1-nook.2` distinguishes it from the official daemon and the earlier
`nook.1` derivative.

## Native behavior

The patch defers temporary compression leases until conversion is needed.
Matching materialized blobs still repair persistent leases, resources, and both
directions of GC links. Targeted content-label updates are skipped only when
their existing values match. Unrelated labels remain intact.

The vendored containerd `AddResource` implementation checks for an existing
empty resource entry inside the same writable transaction. A duplicate rolls
back a transaction it owns, avoiding durable writes and mutation callbacks.
Caller-owned transactions keep their other writes, commit/rollback behavior,
and callbacks. Missing resources still commit normally; invalid resources and
nonempty values retain their prior error or normalization behavior.

Size metadata commits, Force, codecs, export modes, durability, and fsync remain
unchanged. A local 64-layer imported matching-Zstd comparison against `nook.1`
reduced measured daemon write bytes by 42.34%, with identical cache records and
OCI output. This bounded result does not establish a production performance
gain or prove the cause of an earlier timeout or OOM.

## Local build and validation

Run `task infra:buildkit:test` for the native regression and existing cache/GC
tests. The test image compiles the test-only patch separately; it runs with no
network or host/shared-state mounts. Linux mount tests require a privileged,
disposable local container, which has a 15-minute test deadline and owned
container cleanup. This task is unavailable inside ARC or GitHub Actions.

Run `task infra:buildkit:build` to load the derivative image locally. Both paths
use vendored Go dependencies and the pinned toolchain. The daemon uses the
upstream BuildKit build tags; tests compile the native metadata and cache packages. Neither
task pushes an image, modifies an existing daemon, or selects a
production deployment.

After the owning release decision, publish with `task infra:buildkit:publish
BUILDKIT_IMAGE=registry.dev.nokey.sh/nook/buildkit:v0.34.1-nook.2-<full-source-commit>`.
This builds the same daemon target for `linux/amd64`, uses existing Docker
registry authentication, and retains native Buildx digest metadata in a private
temporary directory. Use a new source-commit tag for each derivative release;
the task does not publish `latest` or overwrite an official image alias.
Production pin selection and an original-volume canary remain separate release
actions. Image downgrade after new writes is unproven.
