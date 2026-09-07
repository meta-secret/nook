import type { ShellWord } from './skill-provider-command-types.ts';

type TaskNameRequest = { readonly runtime?: string; readonly word: ShellWord };

export function isQuotedDynamicTaskName(request: TaskNameRequest): boolean {
  const { runtime = 'task', word } = request;
  return (
    (runtime === 'task' || runtime === 'go-task') &&
    word.dynamic &&
    /^"[\s\S]*"$/u.test(word.source) &&
    !word.source.includes('$(') &&
    !word.source.includes('`')
  );
}
