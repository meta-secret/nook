"use strict";

/** @type {typeof import("node:fs")} */
const fs = process.getBuiltinModule("node:fs");
/** @type {typeof import("node:path")} */
const path = process.getBuiltinModule("node:path");

const accessKey = process.env["INPUT_SCCACHE-ACCESS-KEY"] || "";
const secretKey = process.env["INPUT_SCCACHE-SECRET-KEY"] || "";
const endpoint =
  process.env["INPUT_SCCACHE-ENDPOINT"] || "sccache.dev.nokey.sh";
const bucket = process.env["INPUT_SCCACHE-BUCKET"] || "nook-sccache";
const credentialsPresent = Boolean(accessKey && secretKey);

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
      credentialsPresent
        ? "persistent_credential_available"
        : "credentials_unavailable"
    }`,
    // Secret availability is the whole boundary. A job without the pair
    // cold-compiles and never receives remote-cache access.
    ...(credentialsPresent ? [] : ["SCCACHE_OPTIONAL=1"]),
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

/** Owns the private on-runner files used by the sccache process boundary. */
class CacheCredentialFiles {
  /** @param {string} directory */
  constructor(directory) {
    this.directory = directory;
  }

  /** @param {string} filename @param {string} value @returns {string} */
  write(filename, value) {
    const credentialPath = path.join(this.directory, filename);
    fs.writeFileSync(credentialPath, value, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(credentialPath, 0o600);
    return credentialPath;
  }
}

const credentialFiles = new CacheCredentialFiles(credentialDirectory);
const accessKeyFile = credentialFiles.write("sccache-access-key", accessKey);
const secretKeyFile = credentialFiles.write("sccache-secret-key", secretKey);
delete process.env["INPUT_SCCACHE-ACCESS-KEY"];
delete process.env["INPUT_SCCACHE-SECRET-KEY"];

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
