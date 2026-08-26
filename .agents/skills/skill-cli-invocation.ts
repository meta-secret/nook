export enum SkillCliInvocationKind {
  Help = 'help',
  RequestFile = 'requestFile',
  DefaultToolsList = 'defaultToolsList',
  UsageError = 'usageError',
}

export type SkillCliInvocation =
  | { readonly kind: SkillCliInvocationKind.Help }
  | {
      readonly kind: SkillCliInvocationKind.RequestFile;
      readonly requestPath: string;
    }
  | { readonly kind: SkillCliInvocationKind.DefaultToolsList }
  | {
      readonly kind: SkillCliInvocationKind.UsageError;
      readonly message: string;
    };

export type ParseSkillCliInvocationRequest = {
  readonly argv: readonly string[];
};

export function parseSkillCliInvocation(
  request: ParseSkillCliInvocationRequest,
): SkillCliInvocation {
  const token = request.argv.at(0);
  if (typeof token !== 'string' || token === 'help' || token === '--help') {
    return { kind: SkillCliInvocationKind.Help };
  }
  if (token === '--default') {
    if (request.argv.length === 2 && request.argv.at(1) === 'toolsList') {
      return { kind: SkillCliInvocationKind.DefaultToolsList };
    }
    return {
      kind: SkillCliInvocationKind.UsageError,
      message: 'Expected skills --default toolsList.',
    };
  }
  if (request.argv.length !== 1) {
    return {
      kind: SkillCliInvocationKind.UsageError,
      message: 'Expected exactly one request YAML path argument.',
    };
  }
  return { kind: SkillCliInvocationKind.RequestFile, requestPath: token };
}
