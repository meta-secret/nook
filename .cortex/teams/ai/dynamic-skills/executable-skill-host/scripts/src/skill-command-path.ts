export type SkillCommandPathRequest = {
  readonly field: string;
  readonly parent: string;
};

const SIMPLE_FIELD = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

export function skillCommandPath(request: SkillCommandPathRequest): string {
  if (SIMPLE_FIELD.test(request.field)) {
    return request.parent.length === 0
      ? request.field
      : `${request.parent}.${request.field}`;
  }
  return `${request.parent}[${JSON.stringify(request.field)}]`;
}

export function unknownSkillCommandPath(parent: string): string {
  return `${parent}["<unknown-key>"]`;
}
