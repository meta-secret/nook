target "buildkit-native" {
  context    = "."
  dockerfile = "infra/k0s/images/buildkit/Dockerfile"
  target     = "buildkit"
  tags       = ["nook-buildkit:v0.34.1-nook.2"]
}

target "buildkit-native-tests" {
  inherits = ["buildkit-native"]
  target   = "native-tests"
  tags     = ["nook-buildkit-native-tests:v0.34.1-nook.2"]
}
