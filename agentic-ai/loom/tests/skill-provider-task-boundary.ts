import type { ShellWord } from './skill-provider-command-types.ts';

export function isQuotedDynamicTaskName(
  word: ShellWord,
  runtime = 'task',
): boolean {
  return (
    (runtime === 'task' || runtime === 'go-task') &&
    word.dynamic &&
    /^"[\s\S]*"$/u.test(word.source) &&
    !word.source.includes('$(') &&
    !word.source.includes('`')
  );
}
