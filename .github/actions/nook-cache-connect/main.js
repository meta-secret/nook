"use strict";

/** @type {typeof import("node:fs")} */
const fs = process.getBuiltinModule("node:fs");
/** @type {typeof import("node:path")} */
const path = process.getBuiltinModule("node:path");
/** @type {typeof import("node:crypto")} */
const crypto = process.getBuiltinModule("node:crypto");

const accessKey = process.env["INPUT_SCCACHE-ACCESS-KEY"] || "";
const secretKey = process.env["INPUT_SCCACHE-SECRET-KEY"] || "";
const endpoint =
  process.env["INPUT_SCCACHE-ENDPOINT"] || "sccache.dev.nokey.sh";
const bucket = process.env["INPUT_SCCACHE-BUCKET"] || "nook-sccache";
const credentialsPresent = Boolean(accessKey && secretKey);
const capabilityProbe =
  process.env["INPUT_SCCACHE-CAPABILITY-PROBE"] || "none";
const credentialClass =
  process.env["INPUT_SCCACHE-CREDENTIAL-CLASS"] || "unspecified";
if (!["none", "write_capable", "read_only"].includes(capabilityProbe)) {
  process.stderr.write(
    "::error::sccache-capability-probe must be none, write_capable, or read_only\n",
  );
  process.exit(1);
}
if (capabilityProbe !== "none" && !credentialsPresent) {
  process.stderr.write(
    "::error::sccache capability verification requires credentials\n",
  );
  process.exit(1);
}
if (!["write_capable", "read_only", "unspecified"].includes(credentialClass)) {
  process.stderr.write(
    "::error::sccache-credential-class must be write_capable, read_only, or unspecified\n",
  );
  process.exit(1);
}
if (capabilityProbe !== "none" && credentialClass !== capabilityProbe) {
  process.stderr.write(
    "::error::sccache capability probe must match credential_class\n",
  );
  process.exit(1);
}

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
    // Hosted jobs without SeaweedFS credentials (forks, release, arbitrary-ref)
    // cold-compile. Local `task sccache:ensure` fails closed without them; mark
    // those CI paths as an explicit cold-compile exception.
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

/** @param {string} filename @param {string} value @returns {string} */
function writeCredential(filename, value) {
  const credentialPath = path.join(credentialDirectory, filename);
  fs.writeFileSync(credentialPath, value, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(credentialPath, 0o600);
  return credentialPath;
}

const accessKeyFile = writeCredential("sccache-access-key", accessKey);
const secretKeyFile = writeCredential("sccache-secret-key", secretKey);
delete process.env["INPUT_SCCACHE-ACCESS-KEY"];
delete process.env["INPUT_SCCACHE-SECRET-KEY"];

const endpointUrl = endpoint.startsWith("https://")
  ? endpoint
  : `https://${endpoint}`;

class S3CacheCapabilityProbe {
  static records = [];
  static recordPath = "";

  static hmac(key, value, encoding) {
    return crypto.createHmac("sha256", key).update(value).digest(encoding);
  }

  static signingKey(secret, date) {
    const dateKey = this.hmac(`AWS4${secret}`, date);
    const regionKey = this.hmac(dateKey, "auto");
    const serviceKey = this.hmac(regionKey, "s3");
    return this.hmac(serviceKey, "aws4_request");
  }

  static sanitized(value, fallback) {
    const candidate = String(value || "").slice(0, 128);
    return /^[A-Za-z0-9+/=_-]+$/.test(candidate) ? candidate : fallback;
  }

  static encodePath(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  }

  static xmlValue(document, element) {
    const match = document.match(new RegExp(`<${element}>([^<]*)</${element}>`));
    if (!match) {
      return "";
    }
    return match[1]
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&apos;", "'");
  }

  static record(operation, status, awsCode, requestId) {
    const entry = {
      operation,
      status,
      aws_code: awsCode,
      request_id: requestId,
    };
    this.records.push(entry);
    fs.writeFileSync(this.recordPath, `${JSON.stringify(this.records)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    process.stdout.write(
      `NOOK_SCCACHE_CAPABILITY ${JSON.stringify(entry)}\n`,
    );
  }

  static async boundedBody(response, limit) {
    if (!response.body) {
      return "";
    }
    const reader = response.body.getReader();
    const chunks = [];
    let remaining = limit;
    while (remaining > 0) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const bounded = value.subarray(0, remaining);
      chunks.push(Buffer.from(bounded));
      remaining -= bounded.byteLength;
      if (bounded.byteLength < value.byteLength || remaining === 0) {
        await reader.cancel();
        break;
      }
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  static async request(
    endpoint,
    credentials,
    operation,
    method,
    objectKey = "",
    options = {},
  ) {
    const now = new Date();
    const requestBody = options.body || "";
    const payloadHash = crypto
      .createHash("sha256")
      .update(requestBody)
      .digest("hex");
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const bucketPath = this.encodePath(credentials.bucket);
    const keyPath = objectKey
      .split("/")
      .filter(Boolean)
      .map((segment) => this.encodePath(segment))
      .join("/");
    const canonicalUri = `/${bucketPath}${keyPath ? `/${keyPath}` : ""}`;
    const canonicalQuery = options.query || "";
    const canonicalHeaders = [
      `host:${endpoint.host}`,
      `x-amz-content-sha256:${payloadHash}`,
      `x-amz-date:${amzDate}`,
    ].join("\n");
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      "",
      signedHeaders,
      payloadHash,
    ].join("\n");
    const scope = `${date}/auto/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");
    const signature = crypto
      .createHmac("sha256", this.signingKey(credentials.secretKey, date))
      .update(stringToSign)
      .digest("hex");
    let response;
    try {
      const requestUrl = new URL(canonicalUri, endpoint);
      requestUrl.search = canonicalQuery;
      response = await fetch(requestUrl, {
        method,
        ...(requestBody ? { body: requestBody } : {}),
        headers: {
          Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": amzDate,
          ...(options.range ? { Range: options.range } : {}),
        },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      this.record(operation, 0, "transport_error", "unavailable");
      throw new Error(`sccache ${operation} capability request failed`);
    }
    let boundedBody = "";
    if (options.captureBody || !response.ok) {
      boundedBody = await this.boundedBody(response, 16_384);
    } else if (options.consumeBody) {
      await this.boundedBody(response, 2);
    }
    const requestId = this.sanitized(
      response.headers.get("x-amz-request-id") ||
        response.headers.get("x-amz-id-2"),
      "unavailable",
    );
    const awsCode = this.sanitized(
      response.headers.get("x-amz-error-code") ||
        this.xmlValue(boundedBody, "Code"),
      response.ok ? "OK" : `HTTP_${response.status}`,
    );
    this.record(operation, response.status, awsCode, requestId);
    if (!response.ok && !options.allowFailure) {
      throw new Error(`sccache ${operation} capability request was denied`);
    }
    return { body: boundedBody, ok: response.ok, status: response.status };
  }

  static async runWriteCapable(endpoint, credentials) {
    const probeKey = `health/gha-publish-${crypto.randomUUID()}`;
    await this.request(endpoint, credentials, "head_bucket", "HEAD");
    let putCompleted = false;
    try {
      await this.request(endpoint, credentials, "put_object", "PUT", probeKey, {
        body: "nook-cache-capability\n",
      });
      putCompleted = true;
      await this.request(endpoint, credentials, "get_object", "GET", probeKey, {
        consumeBody: true,
        range: "bytes=0-0",
      });
      await this.request(endpoint, credentials, "head_object", "HEAD", probeKey);
    } finally {
      if (putCompleted) {
        await this.request(
          endpoint,
          credentials,
          "delete_object",
          "DELETE",
          probeKey,
        );
      }
    }
  }

  static async runReadOnly(endpoint, credentials) {
    await this.request(endpoint, credentials, "head_bucket", "HEAD");
    const listing = await this.request(
      endpoint,
      credentials,
      "list_object",
      "GET",
      "",
      { captureBody: true, query: "list-type=2&max-keys=1" },
    );
    const existingKey = this.xmlValue(listing.body, "Key");
    if (!existingKey) {
      this.record("get_object", 0, "empty_bucket", "unavailable");
      throw new Error("sccache read-only capability requires an existing object");
    }
    await this.request(endpoint, credentials, "get_object", "GET", existingKey, {
      consumeBody: true,
      range: "bytes=0-0",
    });
    const deniedKey = `health/gha-read-only-${crypto.randomUUID()}`;
    const denied = await this.request(
      endpoint,
      credentials,
      "put_object_denied",
      "PUT",
      deniedKey,
      { allowFailure: true, body: "nook-cache-capability\n" },
    );
    if (denied.ok) {
      await this.request(
        endpoint,
        credentials,
        "delete_unexpected_object",
        "DELETE",
        deniedKey,
      );
      throw new Error("sccache read-only identity unexpectedly accepted PutObject");
    }
    if (denied.status !== 401 && denied.status !== 403) {
      throw new Error("sccache read-only PutObject denial was not authoritative");
    }
  }

  static async run(endpointValue, credentials, capabilityClass) {
    this.recordPath = path.join(runnerTemp, "nook-sccache-capability.json");
    const parsedEndpoint = new URL(endpointValue);
    if (parsedEndpoint.protocol !== "https:") {
      throw new Error("sccache write capability endpoint must use HTTPS");
    }
    if (capabilityClass === "write_capable") {
      await this.runWriteCapable(parsedEndpoint, credentials);
    } else {
      await this.runReadOnly(parsedEndpoint, credentials);
    }
  }
}

const capability =
  capabilityProbe !== "none"
    ? S3CacheCapabilityProbe.run(
        endpointUrl,
        { accessKey, secretKey, bucket },
        capabilityProbe,
      )
    : Promise.resolve();

process.stdout.write(
  `NOOK_SCCACHE_CREDENTIAL ${JSON.stringify({ credential_class: credentialClass })}\n`,
);
capability
  .then(() => {
    fs.appendFileSync(
      githubEnvironmentPath,
      [
        "SCCACHE_S3_MODE=external",
        `SCCACHE_S3_ACCESS_KEY_FILE=${accessKeyFile}`,
        `SCCACHE_S3_SECRET_KEY_FILE=${secretKeyFile}`,
        `SCCACHE_ENDPOINT=${endpointUrl}`,
        `SCCACHE_BUCKET=${bucket}`,
        `NOOK_SCCACHE_CREDENTIAL_CLASS=${credentialClass}`,
        "NOOK_SCCACHE_BACKEND=remote",
        "NOOK_SCCACHE_BACKEND_REASON=persistent_s3_service",
        "",
      ].join("\n"),
    );
  })
  .catch(() => {
    process.stderr.write("::error::sccache capability verification failed\n");
    process.exitCode = 1;
  });
