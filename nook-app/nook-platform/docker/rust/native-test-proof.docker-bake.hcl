// Proof-only real BuildKit controls. Normal validation never disables cache.
target "_native-test-cold" {
  no-cache-filter = [
    "builder-native-common-test",
    "builder-native-authenticator-test",
    "builder-native-replication-test",
    "builder-native-auth2-test",
    "builder-native-event-log-test",
    "builder-native-companion-test",
    "builder-native-core-test",
  ]
}

target "native-test-cold" {
  inherits = ["native-test-evidence", "_native-test-cold"]
}

target "pr-native-test-cold" {
  inherits = ["pr-rust-verify", "_native-test-cold"]
}

// Import the actual normal branch publication explicitly. This is the same
// persistent worker, so these results do not establish clean-store portability.
native_test_proof_cache_from = [
  "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/${write_cache_repository}/nook-rust-native-source-v4${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
]

target "native-test-import" {
  inherits = ["native-test-evidence"]
  cache-from = native_test_proof_cache_from
}

target "pr-native-test-import" {
  inherits = ["pr-rust-verify"]
  cache-from = native_test_proof_cache_from
}
