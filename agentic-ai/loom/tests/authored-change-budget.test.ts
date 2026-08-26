import { describe, expect, test } from 'bun:test';

import {
  countTextLines,
  summarizeAuthoredNumstat,
} from '../src/lib/authored-change-budget.ts';

describe('authored change budget', () => {
  test('counts authored additions and deletions', () => {
    const numstat = '12\t3\tsrc/domain.ts\0' + '4\t5\ttests/domain.test.ts\0';
    const summary = summarizeAuthoredNumstat(numstat);
    expect(summary.authoredLines).toBe(24);
    expect(summary.unmeasurableAuthoredFiles).toBe(0);
  });

  test('excludes generated and reported-only paths', () => {
    const summary = summarizeAuthoredNumstat(
      [
        '8\t1\tsrc/domain.ts',
        '40\t20\tbun.lock',
        '12\t0\ttests/domain.snap',
        '15\t4\tvendor/library.ts',
        '10\t0\tgenerated/client.ts',
      ].join('\0'),
    );
    expect(summary.authoredLines).toBe(9);
  });

  test('counts untracked text lines with or without a trailing newline', () => {
    expect(countTextLines('one\ntwo\n')).toBe(2);
    expect(countTextLines('one\ntwo')).toBe(2);
    expect(countTextLines('')).toBe(0);
  });
});
