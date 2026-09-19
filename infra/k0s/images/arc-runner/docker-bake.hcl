variable "ARC_RUNNER_IMAGE" {
  default = "ghcr.io/meta-secret/nook-arc-runner:2.336.0-hooks-v2"
}

target "arc-runner" {
  context    = "."
  dockerfile = "infra/k0s/images/arc-runner/Dockerfile"
  target     = "arc-runner"
  tags       = [ARC_RUNNER_IMAGE]
}

target "arc-runner-hooks-proof" {
  inherits = ["arc-runner"]
  target   = "proof"
  output   = ["type=cacheonly"]
}
