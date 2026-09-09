export class ExecutableSkillCommandPath {
  private constructor(private readonly request: SkillCommandPathRequest) {}

  static skillCommandPath(request: SkillCommandPathRequest): string {
    return new ExecutableSkillCommandPath(request).execute();
  }

  private execute(): string {
    const request = this.request;
    if (SIMPLE_FIELD.test(request.field)) {
      return request.parent.length === 0
        ? request.field
        : `${request.parent}.${request.field}`;
    }
    return `${request.parent}[${JSON.stringify(request.field)}]`;
  }

  static unknownSkillCommandPath(parent: string): string {
    return `${parent}["<unknown-key>"]`;
  }
}
export type SkillCommandPathRequest = {
  readonly field: string;
  readonly parent: string;
};

const SIMPLE_FIELD = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
