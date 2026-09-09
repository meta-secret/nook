export class ExecutableSkillCommandPath {
  private constructor(private readonly request: SkillCommandPathRequest) {}

  static from(request: SkillCommandPathRequest): ExecutableSkillCommandPath {
    return new ExecutableSkillCommandPath(request);
  }

  public execute(): string {
    const request = this.request;
    if (SIMPLE_FIELD.test(request.field)) {
      return request.parent.length === 0
        ? request.field
        : `${request.parent}.${request.field}`;
    }
    return `${request.parent}[${JSON.stringify(request.field)}]`;
  }
}
export type SkillCommandPathRequest = {
  readonly field: string;
  readonly parent: string;
};

const SIMPLE_FIELD = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

export class UnknownSkillCommandPath {
  constructor(private readonly parent: string) {}
  execute(): string {
    return `${this.parent}["<unknown-key>"]`;
  }
}
