export enum SkillCliInvocationKind {
  RequestYaml = 'requestYaml',
  ToolsList = 'toolsList',
  UsageError = 'usageError',
}

export type SkillCliInvocation =
  | { readonly kind: SkillCliInvocationKind.ToolsList }
  | {
      readonly kind: SkillCliInvocationKind.RequestYaml;
      readonly requestYaml: string;
    }
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
  if (typeof token !== 'string' || token === '--tools-list') {
    return request.argv.length <= 1
      ? { kind: SkillCliInvocationKind.ToolsList }
      : {
          kind: SkillCliInvocationKind.UsageError,
          message: 'Expected --tools-list without additional arguments.',
        };
  }
  const requestYamlPrefix = '--request-yaml=';
  if (
    !token.startsWith(requestYamlPrefix) ||
    token.length === requestYamlPrefix.length ||
    request.argv.length !== 1
  ) {
    return {
      kind: SkillCliInvocationKind.UsageError,
      message: 'Expected exactly one --request-yaml=<strict-yaml> argument.',
    };
  }
  return {
    kind: SkillCliInvocationKind.RequestYaml,
    requestYaml: token.slice(requestYamlPrefix.length),
  };
}
