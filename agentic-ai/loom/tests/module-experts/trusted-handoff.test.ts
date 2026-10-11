import { expect, test } from 'bun:test';

import { ModuleExpertCommandParser } from '../../src/module-experts/cli.ts';
import { StructuralExpertCommandLine } from '../../src/structural-experts/cli.ts';

test('rejects retired named-expert invocation entrypoints', () => {
  const invocation = [
    'invoke',
    '--request',
    '/tmp/request.json',
    '--working-directory',
    '/tmp/repository',
  ] as const;
  expect(ModuleExpertCommandParser.parse(invocation)).toBe(false);
  expect(StructuralExpertCommandLine.parse(invocation)).toBe(false);
});
