import { resolveWord } from './skill-provider-shell-environment.ts';
import type {
  ShellParseState,
  ShellWord,
  WordEnvironmentRequest,
} from './skill-provider-command-types.ts';

export type AliasRequest = {
  readonly command: ShellWord;
  readonly index: number;
  readonly state: ShellParseState;
  readonly words: readonly ShellWord[];
};

export function applyAliasMutation(request: AliasRequest): boolean {
  if (request.command.value !== 'alias' && request.command.value !== 'unalias')
    return false;
  const aliases = request.words.slice(request.index + 1).map((word) => {
    const resolutionRequest: WordEnvironmentRequest = {
      environment: request.state.environment,
      word,
    };
    return resolveWord(resolutionRequest);
  });
  if (aliases.some((alias) => alias.dynamic))
    throw new Error('Dynamic shell alias mutation is forbidden.');
  if (request.command.value === 'unalias') {
    if (aliases.length === 1 && aliases[0]?.value === '-a')
      request.state.aliases.clear();
    else
      for (const alias of aliases.slice(aliases[0]?.value === '--' ? 1 : 0)) {
        if (alias.value.startsWith('-'))
          throw new Error(`Unsupported unalias option: ${alias.value}`);
        request.state.aliases.delete(alias.value);
      }
  } else
    for (const alias of aliases) {
      if (alias.value === '-p' || /^[A-Za-z_]\w*$/u.test(alias.value)) continue;
      const match = /^([A-Za-z_]\w*)=([\s\S]*)$/u.exec(alias.value);
      if (!match) throw new Error('Invalid shell alias definition.');
      request.state.aliases.set(match[1] ?? '', match[2] ?? '');
    }
  return true;
}

export function aliasInvocationSource(request: AliasRequest): string | false {
  const body = request.state.aliases.get(request.command.value) ?? false;
  return body === false
    ? false
    : [
        body,
        ...request.words.slice(request.index + 1).map((word) => word.source),
      ]
        .filter(Boolean)
        .join(' ');
}
