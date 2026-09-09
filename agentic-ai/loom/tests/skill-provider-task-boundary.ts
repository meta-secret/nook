import type { ShellWord } from './skill-provider-command-types.ts';

export class SkillProviderTaskBoundaryScenario {
  private constructor(private readonly request: TaskNameRequest) {}

  static isQuotedDynamicTaskName(request: TaskNameRequest): boolean {
    return new SkillProviderTaskBoundaryScenario(request).execute();
  }

  private execute(): boolean {
    const request = this.request;
    const { runtime = 'task', word } = request;
    return (
      (runtime === 'task' || runtime === 'go-task') &&
      word.dynamic &&
      /^"[\s\S]*"$/u.test(word.source) &&
      !word.source.includes('$(') &&
      !word.source.includes('`')
    );
  }
}

type TaskNameRequest = { readonly runtime?: string; readonly word: ShellWord };
