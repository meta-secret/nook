import {
  constants,
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { wsconnect } from '@nats-io/nats-core';
import {
  asUntrustedYamlNode,
  isRecord,
  untrustedYamlProperty,
  UntrustedYamlPropertyPresence,
} from './lib/guards.ts';

import type { UntrustedYamlMap, UntrustedYamlNode } from './lib/guards.ts';

export const PR_STEWARD_ENDPOINT = 'wss://events.dev.nokey.sh';
export const PR_STEWARD_SUBJECT = 'default.github-webhook.pr-lifecycle';

export type PrStewardCredential = {
  readonly username: 'pr-steward';
  readonly password: string;
};

export type PrStewardEvent = {
  readonly kind: 'github-pr-event';
  readonly id: string;
  readonly time: string;
  readonly githubEvent: string;
  readonly deliveryId: string;
  readonly action?: string;
  readonly repository?: string;
  readonly pullRequest?: number;
  readonly headSha?: string;
};

function property(args: {
  readonly record: UntrustedYamlMap;
  readonly key: string;
}): UntrustedYamlNode | false {
  const result = untrustedYamlProperty(args);
  return result.presence === UntrustedYamlPropertyPresence.Present
    ? result.value
    : false;
}

function nested(args: {
  readonly record: UntrustedYamlMap;
  readonly path: readonly string[];
}): UntrustedYamlNode | false {
  let current: UntrustedYamlNode = args.record;
  for (const key of args.path) {
    if (!isRecord(current)) return false;
    const next = property({ record: current, key });
    if (next === false) return false;
    current = next;
  }
  return current;
}

function optionalString(value: UntrustedYamlNode | false): string | false {
  return typeof value === 'string' && value.length > 0 ? value : false;
}

function optionalNumber(value: UntrustedYamlNode | false): number | false {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : false;
}

function headerValue(args: {
  readonly headers: UntrustedYamlMap;
  readonly name: string;
}): string | false {
  const value = property({ record: args.headers, key: args.name });
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return false;
}

function pullRequestNumber(body: UntrustedYamlMap): number | false {
  const direct = optionalNumber(
    nested({ record: body, path: ['pull_request', 'number'] }),
  );
  if (direct !== false) return direct;
  const issuePr = nested({ record: body, path: ['issue', 'pull_request'] });
  if (isRecord(issuePr)) {
    return optionalNumber(nested({ record: body, path: ['issue', 'number'] }));
  }
  for (const path of [
    ['check_run', 'pull_requests'],
    ['check_suite', 'pull_requests'],
    ['workflow_run', 'pull_requests'],
  ] as const) {
    const candidates = nested({ record: body, path });
    if (
      Array.isArray(candidates) &&
      candidates.length > 0 &&
      isRecord(candidates[0])
    ) {
      return optionalNumber(property({ record: candidates[0], key: 'number' }));
    }
  }
  return false;
}

function headSha(body: UntrustedYamlMap): string | false {
  for (const path of [
    ['pull_request', 'head', 'sha'],
    ['check_run', 'head_sha'],
    ['check_suite', 'head_sha'],
    ['workflow_run', 'head_sha'],
    ['sha'],
  ] as const) {
    const value = optionalString(nested({ record: body, path }));
    if (value !== false) return value;
  }
  return false;
}

export function decodePrStewardEvent(data: Uint8Array): PrStewardEvent {
  let parsed: UntrustedYamlNode;
  try {
    parsed = asUntrustedYamlNode(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(data),
      ) as UntrustedYamlNode,
    );
  } catch {
    throw new Error('event payload is not valid UTF-8 JSON');
  }
  if (!isRecord(parsed)) throw new Error('event payload must be an object');
  const encodedData = property({ record: parsed, key: 'data_base64' });
  if (
    typeof encodedData !== 'string' ||
    encodedData.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedData)
  ) {
    throw new Error('event envelope is invalid');
  }
  let eventData: UntrustedYamlNode;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(encodedData, 'base64'),
    );
    eventData = asUntrustedYamlNode(JSON.parse(decoded) as UntrustedYamlNode);
  } catch {
    throw new Error('event data is invalid');
  }
  if (!isRecord(eventData)) throw new Error('event data is invalid');
  const headers = property({ record: eventData, key: 'headers' });
  const body = property({ record: eventData, key: 'body' });
  if (!isRecord(headers) || !isRecord(body))
    throw new Error('event data is invalid');

  const id = optionalString(property({ record: parsed, key: 'id' }));
  const time = optionalString(property({ record: parsed, key: 'time' }));
  const githubEvent = headerValue({ headers, name: 'X-Github-Event' });
  const deliveryId = headerValue({ headers, name: 'X-Github-Delivery' });
  if (!id || !time || !githubEvent || !deliveryId)
    throw new Error('event identity is invalid');

  const action = optionalString(property({ record: body, key: 'action' }));
  const repository = optionalString(
    nested({ record: body, path: ['repository', 'full_name'] }),
  );
  const pullRequest = pullRequestNumber(body);
  const sha = headSha(body);
  return {
    kind: 'github-pr-event',
    id,
    time,
    githubEvent,
    deliveryId,
    ...(action === false ? {} : { action }),
    ...(repository === false ? {} : { repository }),
    ...(pullRequest === false ? {} : { pullRequest }),
    ...(sha === false ? {} : { headSha: sha }),
  };
}

export function defaultCredentialPath(): string {
  return join(homedir(), '.nook/events/pr-steward-client.yaml');
}

export function credentialPath(argv: readonly string[]): string {
  if (argv.length > 1) throw new Error('expected at most one credential path');
  const path = argv[0] ?? defaultCredentialPath();
  if (!isAbsolute(path)) throw new Error('credential path must be absolute');
  return path;
}

export function loadCredential(path: string): PrStewardCredential {
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error('credential file cannot be opened securely');
  }
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile())
      throw new Error('credential path must be a regular file');
    if (!process.getuid || stat.uid !== process.getuid())
      throw new Error('credential owner mismatch');
    if ((stat.mode & 0o777) !== 0o600)
      throw new Error('credential mode must be 0600');
    const parsed = asUntrustedYamlNode(
      Bun.YAML.parse(readFileSync(descriptor, 'utf8')) as UntrustedYamlNode,
    );
    if (
      !isRecord(parsed) ||
      Object.keys(parsed).sort().join(',') !== 'password,username'
    ) {
      throw new Error('credential schema is invalid');
    }
    const username = property({ record: parsed, key: 'username' });
    const password = property({ record: parsed, key: 'password' });
    if (
      username !== 'pr-steward' ||
      typeof password !== 'string' ||
      !/^[0-9a-f]{64}$/.test(password)
    ) {
      throw new Error('credential schema is invalid');
    }
    return { username, password };
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('credential '))
      throw cause;
    throw new Error('credential schema is invalid', { cause });
  } finally {
    closeSync(descriptor);
  }
}

async function main(): Promise<void> {
  const credential = loadCredential(credentialPath(process.argv.slice(2)));
  const connection = await wsconnect({
    servers: PR_STEWARD_ENDPOINT,
    user: credential.username,
    pass: credential.password,
    name: `pr-steward-${process.pid}`,
    ignoreClusterUpdates: true,
  });
  const subscription = connection.subscribe(PR_STEWARD_SUBJECT);
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void connection.drain().catch(() => undefined);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    for await (const message of subscription) {
      process.stdout.write(
        `${JSON.stringify(decodePrStewardEvent(message.data))}\n`,
      );
    }
    const closeError = await connection.closed();
    if (closeError) throw new Error('NATS connection closed unexpectedly');
  } finally {
    if (!stopping) await connection.close();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (import.meta.main) {
  main().catch((cause) => {
    const message =
      cause instanceof Error ? cause.message : 'subscription failed';
    process.stderr.write(`PR Steward event subscription failed: ${message}\n`);
    process.exitCode = 1;
  });
}
