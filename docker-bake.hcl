variable "DOCKER_IMAGE" {
  default = "nook-build:local"
}

group "default" {
  targets = ["toolchain"]
}

target "toolchain" {
  context = "."
  dockerfile = "Dockerfile"
  tags = [DOCKER_IMAGE]
}
