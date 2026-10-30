variable "COMPILER_PROOF_OUTPUT_DIR" {
  default = ""
}

target "_compiler-proof" {
  inherits   = ["_sccache"]
  context    = "infra/sim/compiler-cache"
  dockerfile = "Dockerfile"
  target     = "compiler-result"
  platforms  = ["linux/amd64"]
  contexts = {
    rust-base = "target:rust-base"
  }
}

target "compiler-proof-cold" {
  inherits = ["_compiler-proof"]
  no-cache-filter = [
    "compiler-fixture", "compiler-publisher", "compiler-warm-parent", "compiler-negative-control",
    "compiler-child-a-cache", "compiler-child-a-real",
    "compiler-child-b-cache", "compiler-child-b-real", "compiler-result",
  ]
  output = ["type=local,dest=${COMPILER_PROOF_OUTPUT_DIR}/results/cold"]
}

target "compiler-proof-warm" {
  inherits = ["_compiler-proof"]
  output   = ["type=local,dest=${COMPILER_PROOF_OUTPUT_DIR}/results/warm"]
}

target "compiler-proof-export" {
  inherits = ["_compiler-proof"]
  cache-to = ["type=local,dest=${COMPILER_PROOF_OUTPUT_DIR}/cache,mode=max,oci-mediatypes=true,image-manifest=true"]
  output   = ["type=local,dest=${COMPILER_PROOF_OUTPUT_DIR}/results/export"]
}

target "compiler-proof-import" {
  inherits   = ["_compiler-proof"]
  cache-from = ["type=local,src=${COMPILER_PROOF_OUTPUT_DIR}/cache"]
  output     = ["type=local,dest=${COMPILER_PROOF_OUTPUT_DIR}/results/import"]
}

target "compiler-proof-probe" {
  inherits = ["_compiler-proof"]
  no-cache-filter = [
    "compiler-negative-control",
    "compiler-child-a-cache", "compiler-child-a-real",
    "compiler-child-b-cache", "compiler-child-b-real", "compiler-result",
  ]
  output = ["type=local,dest=${COMPILER_PROOF_OUTPUT_DIR}/results/probe"]
}
