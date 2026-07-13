// Independent Rust/WASM and web/e2e bases. BuildKit prepares both branches in parallel, and the
// final web image consumes only web-base plus small artifacts copied from builder-wasm.
// Each branch uses its own cache refs from nook-app/docker-bake.hcl (platform is always amd64).

target "rust-base" {
  context    = "."
  dockerfile = "nook-app/docker/base.Dockerfile"
  target     = "rust-base"
  platforms  = ["linux/amd64"]
  cache-from = rust_cache_from
  cache-to   = rust_cache_to
}

target "web-base" {
  context    = "."
  dockerfile = "nook-app/docker/base.Dockerfile"
  target     = "web-base"
  platforms  = ["linux/amd64"]
  cache-from = web_cache_from
  cache-to   = web_cache_to
}
