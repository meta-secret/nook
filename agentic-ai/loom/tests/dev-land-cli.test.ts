import { expect, test } from 'bun:test';

import { DevCli } from '../src/dev-delivery/dev-cli.ts';

const ORIGIN_MAIN_SHA = 'a'.repeat(40);
const PINNED_LOCAL_DEV_SHA = 'b'.repeat(40);
const FEATURE_BRANCH = 'feature/land';
const DEV_PATH = '/tmp/nook-dev';

test('resolves the branch and base dev:land packet without feature SHA input', () => {
  const names = [
    'DEV_PATH',
    'FEATURE_BRANCH',
    'ORIGIN_MAIN_SHA',
    'PINNED_LOCAL_DEV_SHA',
    'FEATURE_HEAD_SHA',
    'EXPECTED_FEATURE_SHA',
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, {
    DEV_PATH,
    FEATURE_BRANCH,
    ORIGIN_MAIN_SHA,
    PINNED_LOCAL_DEV_SHA,
  });
  delete process.env.FEATURE_HEAD_SHA;
  delete process.env.EXPECTED_FEATURE_SHA;
  try {
    const packet = DevCli.requiredDevLandPacket();
    expect(packet.isOk()).toBe(true);
    if (packet.isErr()) return;
    expect(packet.value.devPath).toBe(DEV_PATH);
    expect(packet.value.featureBranch.value()).toBe(FEATURE_BRANCH);
    expect(packet.value.originMainSha.value()).toBe(ORIGIN_MAIN_SHA);
    expect(packet.value.pinnedLocalDevSha.value()).toBe(PINNED_LOCAL_DEV_SHA);
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (typeof value === 'string') process.env[name] = value;
      else delete process.env[name];
    }
  }
});

test('rejects missing and invalid dev:land branch identity', () => {
  const names = [
    'DEV_PATH',
    'FEATURE_BRANCH',
    'ORIGIN_MAIN_SHA',
    'PINNED_LOCAL_DEV_SHA',
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, {
    DEV_PATH,
    FEATURE_BRANCH,
    ORIGIN_MAIN_SHA,
    PINNED_LOCAL_DEV_SHA,
  });
  try {
    delete process.env.FEATURE_BRANCH;
    const missing = DevCli.requiredDevLandPacket();
    expect(missing.isErr()).toBe(true);
    if (missing.isOk()) return;
    expect(missing.error.message).toContain('FEATURE_BRANCH');

    process.env.FEATURE_BRANCH = 'main';
    const uppercase = DevCli.requiredDevLandPacket();
    expect(uppercase.isErr()).toBe(true);
    if (uppercase.isOk()) return;
    expect(uppercase.error.message).toContain('feature branch');

    process.env.FEATURE_BRANCH = 'feature//land';
    const whitespace = DevCli.requiredDevLandPacket();
    expect(whitespace.isErr()).toBe(true);
    if (whitespace.isOk()) return;
    expect(whitespace.error.message).toContain('Invalid Git branch name');
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (typeof value === 'string') process.env[name] = value;
      else delete process.env[name];
    }
  }
});

test('rejects missing, empty, relative, and NUL-containing dev checkout paths', () => {
  const names = [
    'DEV_PATH',
    'FEATURE_BRANCH',
    'ORIGIN_MAIN_SHA',
    'PINNED_LOCAL_DEV_SHA',
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, {
    DEV_PATH,
    FEATURE_BRANCH,
    ORIGIN_MAIN_SHA,
    PINNED_LOCAL_DEV_SHA,
  });
  try {
    for (const value of [
      undefined,
      '',
      'relative/dev',
      `${DEV_PATH}\u0000dev`,
    ]) {
      if (typeof value === 'string') process.env.DEV_PATH = value;
      else delete process.env.DEV_PATH;
      const packet = DevCli.requiredDevLandPacket();
      expect(packet.isErr()).toBe(true);
      if (packet.isOk()) return;
      expect(packet.error.message).toContain('DEV_PATH');
    }
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (typeof value === 'string') process.env[name] = value;
      else delete process.env[name];
    }
  }
});
