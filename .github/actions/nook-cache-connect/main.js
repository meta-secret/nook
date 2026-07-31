"use strict";

const fs = require("node:fs");
const path = require("node:path");

const accessKeyInput = "INPUT_SCCACHE-ACCESS-KEY";
const secretKeyInput = "INPUT_SCCACHE-SECRET-KEY";
const endpointInput = "INPUT_SCCACHE-ENDPOINT";
const bucketInput = "INPUT_SCCACHE-BUCKET";

const accessKey = process.env[accessKeyInput] || "";
const secretKey = process.env[secretKeyInput] || "";
const endpoint = process.env[endpointInput] || "sccache.dev.nokey.sh";
const bucket = process.env[bucketInput] || "nook-sccache";
const credentialsPresent = Boolean(accessKey && secretKey);

const githubEnvironmentPath = process.env.GITHUB_ENV;
if (!githubEnvironmentPath) {
  process.stderr.write(
    "::error::GITHUB_ENV is required for Rust cache selection\n",
  );
  process.exit(1);
}

const hostedDelivery =
  process.env.GITHUB_ACTIONS === "true" || process.env.NOOK_ENV === "ci";
const missingCredentialReason = hostedDelivery
  ? "hosted_secret_free_by_design"
  : "credentials_unavailable";

fs.appendFileSync(
  githubEnvironmentPath,
  [
    "NOOK_SCCACHE_BACKEND=direct_compile",
    `NOOK_SCCACHE_BACKEND_REASON=${
      credentialsPresent
        ? "persistent_credential_available"
        : missingCredentialReason
    }`,
    "",
  ].join("\n"),
);
if (!credentialsPresent) {
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

const accessKeyFile = writeCredential("sccache-access-key", accessKey);
const secretKeyFile = writeCredential("sccache-secret-key", secretKey);
delete process.env[accessKeyInput];
delete process.env[secretKeyInput];

const endpointUrl = endpoint.startsWith("https://")
  ? endpoint
  : `https://${endpoint}`;

fs.appendFileSync(
  githubEnvironmentPath,
  [
    "SCCACHE_S3_MODE=external",
    `SCCACHE_S3_ACCESS_KEY_FILE=${accessKeyFile}`,
    `SCCACHE_S3_SECRET_KEY_FILE=${secretKeyFile}`,
    `SCCACHE_ENDPOINT=${endpointUrl}`,
    `SCCACHE_BUCKET=${bucket}`,
    "NOOK_SCCACHE_BACKEND=remote",
    "NOOK_SCCACHE_BACKEND_REASON=persistent_s3_service",
    "",
  ].join("\n"),
);
