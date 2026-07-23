"use strict";

const fs = require("node:fs");
const path = require("node:path");

const inputName = "INPUT_CACHE-REDIS-PASSWORD";
const redisPassword = process.env[inputName] || "";

const githubEnvironmentPath = process.env.GITHUB_ENV;
if (!githubEnvironmentPath) {
  process.stderr.write(
    "::error::GITHUB_ENV is required for Rust cache selection\n",
  );
  process.exit(1);
}

fs.appendFileSync(
  githubEnvironmentPath,
  [
    "NOOK_SCCACHE_BACKEND=direct_compile",
    `NOOK_SCCACHE_BACKEND_REASON=${
      redisPassword ? "persistent_credential_available" : "credentials_unavailable"
    }`,
    "",
  ].join("\n"),
);
if (!redisPassword) {
  process.exit(0);
}

const runnerTemp = process.env.RUNNER_TEMP;
if (!runnerTemp) {
  process.stderr.write(
    "::error::RUNNER_TEMP is required for the persistent Rust cache\n",
  );
  process.exit(1);
}

const credentialDirectory = path.join(runnerTemp, "nook-cache-credentials");
fs.mkdirSync(credentialDirectory, { recursive: true, mode: 0o700 });
fs.chmodSync(credentialDirectory, 0o700);

function writeCredential(filename, value) {
  const credentialPath = path.join(credentialDirectory, filename);
  fs.writeFileSync(credentialPath, value, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(credentialPath, 0o600);
  return credentialPath;
}

const redisPasswordFile = writeCredential("redis-password", redisPassword);
delete process.env[inputName];
fs.appendFileSync(
  githubEnvironmentPath,
  [
    "SCCACHE_REDIS_MODE=external",
    `SCCACHE_REDIS_PASSWORD_FILE=${redisPasswordFile}`,
    "NOOK_SCCACHE_BACKEND=remote",
    "NOOK_SCCACHE_BACKEND_REASON=persistent_tls_service",
    "",
  ].join("\n"),
);
