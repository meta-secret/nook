"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const inputNames = [
  "INPUT_CACHE-REDIS-PASSWORD",
  "INPUT_CACHE-CLOUDFLARE-CLIENT-ID",
  "INPUT_CACHE-CLOUDFLARE-CLIENT-SECRET",
];
const [redisPassword, cloudflareClientId, cloudflareClientSecret] = inputNames.map(
  (name) => process.env[name] || "",
);

if (!redisPassword || !cloudflareClientId || !cloudflareClientSecret) {
  process.exit(0);
}

const runnerTemp = process.env.RUNNER_TEMP;
if (!runnerTemp) {
  process.stderr.write("::error::RUNNER_TEMP is required for the persistent Rust cache\n");
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
const cloudflareClientIdFile = writeCredential("cloudflare-client-id", cloudflareClientId);
const cloudflareClientSecretFile = writeCredential(
  "cloudflare-client-secret",
  cloudflareClientSecret,
);

const taskEnvironment = { ...process.env };
for (const inputName of inputNames) {
  delete taskEnvironment[inputName];
}
taskEnvironment.CACHE_REDIS_PASSWORD_FILE = redisPasswordFile;
taskEnvironment.CACHE_CLOUDFLARE_CLIENT_ID_FILE = cloudflareClientIdFile;
taskEnvironment.CACHE_CLOUDFLARE_CLIENT_SECRET_FILE = cloudflareClientSecretFile;

const result = spawnSync("task", ["infra:cache:connect"], {
  cwd: process.env.GITHUB_WORKSPACE || process.cwd(),
  env: taskEnvironment,
  stdio: "inherit",
});

fs.rmSync(cloudflareClientIdFile, { force: true });
fs.rmSync(cloudflareClientSecretFile, { force: true });

if (result.error) {
  process.stderr.write("::error::Could not start the persistent Rust cache task\n");
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status || 1);
}
