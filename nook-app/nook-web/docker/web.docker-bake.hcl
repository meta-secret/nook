// Web/e2e bases. Independent of the Rust toolchain lineage.

target "web-base" {
  context    = "."
  dockerfile = "nook-app/nook-web/docker/web.Dockerfile"
  target     = "web-base"
  platforms  = ["linux/amd64"]
}

target "web-e2e-base" {
  context    = "."
  dockerfile = "nook-app/nook-web/docker/web.Dockerfile"
  target     = "web-e2e-base"
  platforms  = ["linux/amd64"]
}
