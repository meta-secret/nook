target "pr-proof-verification" {
  context = "."
  dockerfile = "pr-pipeline.Dockerfile"
  target = "verification"
  output = ["type=cacheonly"]
}
target "pr-proof-tests" {
  inherits = ["pr-proof-verification"]
  target = "tests"
}
target "pr-proof-heavy" {
  inherits = ["pr-proof-verification"]
  target = "result"
}
