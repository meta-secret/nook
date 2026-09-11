target "rust-dependency-audit" {
  context = "."
  dockerfile = ".github/docker/rust-maintenance.Dockerfile"
  target = "audit-export"
  platforms = ["linux/amd64"]
  contexts = {
    rust-base = "target:rust-base"
    repository-source = "."
  }
  no-cache-filter = ["audit"]
}
