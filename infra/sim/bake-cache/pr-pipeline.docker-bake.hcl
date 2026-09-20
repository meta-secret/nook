target "pr-proof-verification" {
  context = "."
  dockerfile = "pr-pipeline.Dockerfile"
  target = "verification"
  tags = ["nook-pr-proof-verification:local"]
  output = ["type=image,push=false"]
}
target "pr-proof-tests" {
  inherits = ["pr-proof-verification"]
  target = "tests"
}
target "pr-proof-heavy" {
  inherits = ["pr-proof-verification"]
  target = "result"
}
