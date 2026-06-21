variable "DOCKER_IMAGE" {
  default = "nook-build:local"
}

variable "CACHE_FROM" {
  default = ""
}

variable "CACHE_TO" {
  default = ""
}

group "default" {
  targets = ["toolchain"]
}

target "toolchain" {
  context = "."
  dockerfile = "Dockerfile"
  tags = [DOCKER_IMAGE]
  output = ["type=docker"]
  cache-from = CACHE_FROM != "" ? [CACHE_FROM] : []
  cache-to   = CACHE_TO != "" ? [CACHE_TO] : []
}
