# syntax=docker/dockerfile:1.4

# Toolchain image: deps + warm target/ + bun deps + playwright. No app source (that lives in
# the nook-web image, docker/nook-web.Dockerfile). All COPY sources below are bake `contexts` (target:<name>)
# wired in the sibling docker/toolchain.docker-bake.hcl:
#   toolchain-web  -> nook-web/Dockerfile   (bun deps + playwright; also the base here)
#   builder-deps   -> nook-core/Dockerfile  (crates.io registry cache)
#   builder-debug  -> nook-core/Dockerfile  (native/coverage target/)
#   builder-wasm   -> nook-wasm/Dockerfile  (wasm32 target/)
# target/ lives at the default in-tree path (/meta-secret/nook/target = WORKDIR); the nook-web image
# COPYs source over the same workdir and reuses this warm target with no recompile of deps.

FROM toolchain-web AS toolchain

COPY --from=builder-deps /usr/local/cargo/registry /usr/local/cargo/registry
COPY --from=builder-debug /meta-secret/nook/target /meta-secret/nook/target
COPY --from=builder-wasm /meta-secret/nook/target/wasm32-unknown-unknown /meta-secret/nook/target/wasm32-unknown-unknown
