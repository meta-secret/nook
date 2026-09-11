target "formatter-tools" {
  context = "."
  dockerfile = "Dockerfile"
  platforms = ["linux/amd64"]
}

target "format-export" {
  context = "."
  dockerfile = "ci.Dockerfile"
  target = "format-export"
  platforms = ["linux/amd64"]
  contexts = {
    formatter-tools = "target:formatter-tools"
  }
}
