import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decodePrStewardEvent,
  loadCredential,
  parsePrStewardInvocation,
  PrStewardEventKind,
  writeAssignedEvents,
} from '../src/pr-steward-events.ts';
import type { UntrustedYamlMap } from '../src/lib/guards.ts';

const temporaryPaths: string[] = [];
const encoder = new TextEncoder();

function cloudEvent(args: {
  readonly id: string;
  readonly time: string;
  readonly headers: Record<string, string | string[]>;
  readonly body: UntrustedYamlMap;
}): Uint8Array {
  const eventData = JSON.stringify({ headers: args.headers, body: args.body });
  return encoder.encode(
    JSON.stringify({
      id: args.id,
      time: args.time,
      data_base64: Buffer.from(eventData).toString('base64'),
    }),
  );
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0))
    rmSync(path, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'nook-pr-events-'));
  temporaryPaths.push(path);
  return path;
}

describe('PR Steward credentials', () => {
  test('accepts only the infrastructure-owned exact credential shape', () => {
    const path = join(temporaryDirectory(), 'client.yaml');
    writeFileSync(path, `username: pr-steward\npassword: ${'a'.repeat(64)}\n`);
    chmodSync(path, 0o600);
    expect(loadCredential(path)).toEqual({
      username: 'pr-steward',
      password: 'a'.repeat(64),
    });
  });

  test('rejects broad modes and extra fields', () => {
    const path = join(temporaryDirectory(), 'client.yaml');
    writeFileSync(
      path,
      `username: pr-steward\npassword: ${'a'.repeat(64)}\nextra: true\n`,
    );
    chmodSync(path, 0o644);
    expect(() => loadCredential(path)).toThrow('credential mode must be 0600');
    chmodSync(path, 0o600);
    expect(() => loadCredential(path)).toThrow('credential schema is invalid');
  });

  test('rejects symbolic links', () => {
    const directory = temporaryDirectory();
    const target = join(directory, 'target.yaml');
    const link = join(directory, 'client.yaml');
    writeFileSync(
      target,
      `username: pr-steward\npassword: ${'a'.repeat(64)}\n`,
    );
    chmodSync(target, 0o600);
    symlinkSync(target, link);
    expect(() => loadCredential(link)).toThrow(
      'credential file cannot be opened securely',
    );
  });

  test('requires one positive PR and an absolute optional config', () => {
    expect(parsePrStewardInvocation(['--pr', '1492'])).toMatchObject({
      pullRequest: 1492,
    });
    expect(() => parsePrStewardInvocation(['--pr', '0'])).toThrow(
      'positive integer',
    );
    expect(() =>
      parsePrStewardInvocation(['--pr', '1492', '--config', 'relative']),
    ).toThrow('absolute');
  });
});

describe('PR Steward event codec', () => {
  test('emits the minimal typed pull-request envelope', () => {
    const payload = cloudEvent({
      id: 'cloud-event-1',
      time: '2026-09-06T19:00:00Z',
      headers: {
        'X-Github-Event': ['pull_request'],
        'X-Github-Delivery': ['delivery-1'],
      },
      body: {
        action: 'synchronize',
        repository: { full_name: 'bynull/nook' },
        pull_request: { number: 1488, head: { sha: 'abc123' } },
      },
    });
    expect(decodePrStewardEvent(payload)).toEqual({
      kind: PrStewardEventKind.GithubPrEvent,
      id: 'cloud-event-1',
      time: '2026-09-06T19:00:00Z',
      githubEvent: 'pull_request',
      deliveryId: 'delivery-1',
      action: 'synchronize',
      repository: 'bynull/nook',
      pullRequest: 1488,
      headSha: 'abc123',
    });
  });

  test('rejects messages without GitHub delivery identity', () => {
    const payload = cloudEvent({
      id: 'cloud-event-3',
      time: '2026-09-06T19:02:00Z',
      headers: {},
      body: {},
    });
    expect(() => decodePrStewardEvent(payload)).toThrow(
      'event identity is invalid',
    );
  });

  test('keeps concurrent Gizmo subscriptions scoped to their assigned PR', async () => {
    const payload = (pullRequest: number): Uint8Array =>
      cloudEvent({
        id: `event-${pullRequest}`,
        time: '2026-09-06T19:03:00Z',
        headers: {
          'X-Github-Event': 'pull_request',
          'X-Github-Delivery': `delivery-${pullRequest}`,
        },
        body: {
          pull_request: { number: pullRequest, head: { sha: 'abc123' } },
        },
      });
    const allMessages = [payload(1488), payload(1492)];
    const stream = async function* (): AsyncIterable<{ data: Uint8Array }> {
      for (const data of allMessages) yield { data };
    };
    const pr1488: string[] = [];
    const pr1492: string[] = [];
    await Promise.all([
      writeAssignedEvents({
        messages: stream(),
        pullRequest: 1488,
        write: (line) => pr1488.push(line),
      }),
      writeAssignedEvents({
        messages: stream(),
        pullRequest: 1492,
        write: (line) => pr1492.push(line),
      }),
    ]);
    expect(pr1488).toHaveLength(1);
    expect(JSON.parse(pr1488[0]!).pullRequest).toBe(1488);
    expect(pr1492).toHaveLength(1);
    expect(JSON.parse(pr1492[0]!).pullRequest).toBe(1492);
  });
});
