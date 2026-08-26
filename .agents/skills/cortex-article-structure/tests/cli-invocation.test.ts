import { describe, expect, test } from 'bun:test';
import {
  parseSkillCliInvocation,
  SkillCliInvocationKind,
  type ParseSkillCliInvocationRequest,
} from '../../skill-cli-invocation.ts';

describe('skill CLI invocation', () => {
  test('uses action discovery for help and empty invocation', () => {
    const emptyRequest: ParseSkillCliInvocationRequest = { argv: [] };
    const helpRequest: ParseSkillCliInvocationRequest = { argv: ['--help'] };
    expect(parseSkillCliInvocation(emptyRequest).kind).toBe(
      SkillCliInvocationKind.Help,
    );
    expect(parseSkillCliInvocation(helpRequest).kind).toBe(
      SkillCliInvocationKind.Help,
    );
  });

  test('accepts one YAML file and the tools-list default', () => {
    const fileRequest: ParseSkillCliInvocationRequest = {
      argv: ['request.yaml'],
    };
    const defaultRequest: ParseSkillCliInvocationRequest = {
      argv: ['--default', 'toolsList'],
    };
    const expectedFileInvocation = {
      kind: SkillCliInvocationKind.RequestFile,
      requestPath: 'request.yaml',
    } as const;
    expect(parseSkillCliInvocation(fileRequest)).toEqual(
      expectedFileInvocation,
    );
    expect(parseSkillCliInvocation(defaultRequest).kind).toBe(
      SkillCliInvocationKind.DefaultToolsList,
    );
  });

  test('rejects positional action parameters', () => {
    const request: ParseSkillCliInvocationRequest = {
      argv: ['audit', '--path', '.cortex'],
    };
    expect(parseSkillCliInvocation(request).kind).toBe(
      SkillCliInvocationKind.UsageError,
    );
  });
});
