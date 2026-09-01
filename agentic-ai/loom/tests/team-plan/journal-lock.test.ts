import { expect, test } from 'bun:test';

import { teamPlanLinuxNamespaceLockRecoverable } from '../../src/team-plan/journal-lock.ts';

test('recovers terminated namespaces without stealing live siblings', () => {
  const currentMachineIdentity = 'current-host:boot-1:pid:[101]';
  const recoverable = (request: {
    readonly ownerIdentity: string;
    readonly liveNamespaces?: ReadonlySet<string>;
  }) =>
    teamPlanLinuxNamespaceLockRecoverable({
      currentMachineIdentity,
      liveNamespaces: request.liveNamespaces ?? new Set(),
      ownerIdentity: request.ownerIdentity,
    });
  expect(
    recoverable({
      ownerIdentity: 'current-host:boot-1:pid:[202]:start-ticks:303',
    }),
  ).toBe(true);
  expect(
    recoverable({
      ownerIdentity: 'renamed-host:boot-1:pid:[202]:start-ticks:303',
    }),
  ).toBe(true);
  expect(
    recoverable({
      ownerIdentity: 'renamed-host:boot-1:pid:[202]:start-ticks:303',
      liveNamespaces: new Set(['pid:[202]']),
    }),
  ).toBe(false);
  expect(
    recoverable({
      ownerIdentity: 'current-host:foreign-boot:pid:[202]:start-ticks:303',
    }),
  ).toBe(true);
  expect(
    recoverable({
      ownerIdentity: 'foreign-host:foreign-boot:pid:[202]:start-ticks:303',
    }),
  ).toBe(false);
});
