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
} from '../src/pr-steward-events.ts';

const temporaryPaths: string[] = [];
const encoder = new TextEncoder();

function cloudEvent(args: {
  readonly id: string;
  readonly time: string;
  readonly headers: Record<string, string | string[]>;
  readonly body: Record<
    string,
    string | number | Record<string, string | number | Record<string, string>>
  >;
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
      kind: 'github-pr-event',
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

  test('maps issue-comment PR identity without retaining the webhook body', () => {
    const payload = cloudEvent({
      id: 'cloud-event-2',
      time: '2026-09-06T19:01:00Z',
      headers: {
        'X-Github-Event': 'issue_comment',
        'X-Github-Delivery': 'delivery-2',
      },
      body: {
        action: 'created',
        repository: { full_name: 'bynull/nook' },
        issue: { number: 1488, pull_request: { url: 'ignored' } },
        comment: { body: 'must not appear' },
      },
    });
    const event = decodePrStewardEvent(payload);
    expect(event.pullRequest).toBe(1488);
    expect(JSON.stringify(event)).not.toContain('must not appear');
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
});
