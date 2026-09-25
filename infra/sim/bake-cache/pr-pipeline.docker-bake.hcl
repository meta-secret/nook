target "pr-proof-verification" {
  context = "."
  dockerfile = "pr-pipeline.Dockerfile"
  target = "verification"
  tags = ["nook-pr-proof-verification:local"]
  output = ["type=image,push=false"]
}
target "pr-proof-tests" {
  inherits = ["pr-proof-verification"]
  target = "coverage-export"
  output = ["type=cacheonly"]
}
target "pr-proof-heavy" {
  inherits = ["pr-proof-verification"]
  target = "result"
}

target "pr-proof-browser" {
  inherits = ["pr-proof-verification"]
  target = "browser-artifacts"
  output = ["type=cacheonly"]
}

group "pr-proof-checks" {
  targets = ["pr-proof-verification", "pr-proof-tests", "pr-proof-heavy", "pr-proof-browser"]
}
