// Web/e2e bases. Independent of the Rust toolchain lineage.
// Intended to move next to the web workspace when that directory layout lands.

target "web-base" {
  context    = "."
  dockerfile = "nook-app/docker/web.Dockerfile"
  target     = "web-base"
  platforms  = ["linux/amd64"]
}

target "web-e2e-base" {
  context    = "."
  dockerfile = "nook-app/docker/web.Dockerfile"
  target     = "web-e2e-base"
  platforms  = ["linux/amd64"]
}
