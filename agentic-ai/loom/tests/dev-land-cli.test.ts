import { expect, test } from 'bun:test';

import { DevCli } from '../src/dev-delivery/dev-cli.ts';

const ORIGIN_MAIN_SHA = 'a'.repeat(40);
const PINNED_LOCAL_DEV_SHA = 'b'.repeat(40);
const FEATURE_HEAD_SHA = 'c'.repeat(40);
const EXPECTED_FEATURE_SHA = 'd'.repeat(40);
const DEV_PATH = '/tmp/nook-dev';

test('resolves the complete exact dev:land provenance packet', () => {
  const names = [
    'DEV_PATH',
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
    ORIGIN_MAIN_SHA,
    PINNED_LOCAL_DEV_SHA,
    FEATURE_HEAD_SHA,
    EXPECTED_FEATURE_SHA,
  });
  try {
    const packet = DevCli.requiredDevLandPacket();
    expect(packet.isOk()).toBe(true);
    if (packet.isErr()) return;
    expect(packet.value.devPath).toBe(DEV_PATH);
    expect(packet.value.originMainSha.value()).toBe(ORIGIN_MAIN_SHA);
    expect(packet.value.pinnedLocalDevSha.value()).toBe(PINNED_LOCAL_DEV_SHA);
    expect(packet.value.featureHeadSha.value()).toBe(FEATURE_HEAD_SHA);
    expect(packet.value.expectedFeatureSha.value()).toBe(EXPECTED_FEATURE_SHA);
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (typeof value === 'string') process.env[name] = value;
      else delete process.env[name];
    }
  }
});

test('rejects missing and non-canonical dev:land provenance values', () => {
  const names = [
    'DEV_PATH',
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
    ORIGIN_MAIN_SHA,
    PINNED_LOCAL_DEV_SHA,
    FEATURE_HEAD_SHA,
    EXPECTED_FEATURE_SHA,
  });
  try {
    delete process.env.FEATURE_HEAD_SHA;
    const missing = DevCli.requiredDevLandPacket();
    expect(missing.isErr()).toBe(true);
    if (missing.isOk()) return;
    expect(missing.error.message).toContain('FEATURE_HEAD_SHA');

    process.env.FEATURE_HEAD_SHA = FEATURE_HEAD_SHA.toUpperCase();
    const uppercase = DevCli.requiredDevLandPacket();
    expect(uppercase.isErr()).toBe(true);
    if (uppercase.isOk()) return;
    expect(uppercase.error.message).toContain('40-character lowercase');

    process.env.FEATURE_HEAD_SHA = ` ${FEATURE_HEAD_SHA}`;
    const whitespace = DevCli.requiredDevLandPacket();
    expect(whitespace.isErr()).toBe(true);
    if (whitespace.isOk()) return;
    expect(whitespace.error.message).toContain('40-character lowercase');
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
    ORIGIN_MAIN_SHA,
    PINNED_LOCAL_DEV_SHA,
    FEATURE_HEAD_SHA,
    EXPECTED_FEATURE_SHA,
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
