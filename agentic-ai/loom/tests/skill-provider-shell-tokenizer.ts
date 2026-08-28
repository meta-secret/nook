import {
  ShellSeparator,
  type ShellToken,
  type ShellWord,
} from './skill-provider-command-types.ts';

const MAX_TOKENS = 4_096;

export function isShellCommentStart([source, index]: readonly [
  string,
  number,
]): boolean {
  const previous = source[index - 1] ?? '';
  return (
    source[index] === '#' &&
    (index === 0 || /\s/u.test(previous) || ';&|()'.includes(previous))
  );
}

export function tokenizeShell(source: string): readonly ShellToken[] {
  const tokens: ShellToken[] = [];
  let value = '';
  let raw = '';
  let quote = '';
  let dynamic = false;
  let dataParenthesisDepth = 0;
  const pushWord = (): void => {
    if (raw.length === 0) return;
    const word: ShellWord = { source: raw, value, dynamic };
    tokens.push(word);
    value = '';
    raw = '';
    dynamic = false;
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    const compoundClosing =
      quote.length === 0 && source.slice(index, index + 2) === '(('
        ? '))'
        : quote.length === 0 && source.slice(index, index + 2) === '[['
          ? ']]'
          : '';
    if (compoundClosing) {
      pushWord();
      const end = source.indexOf(compoundClosing, index + 2);
      if (end < 0) throw new Error('Unterminated shell compound region.');
      index = end + 1;
      continue;
    }
    if (character === '$' && source[index + 1] === '(') {
      let depth = 1;
      let nestedQuote = '';
      raw += '$(';
      value += '$(';
      dynamic = true;
      index += 2;
      for (; index < source.length && depth > 0; index += 1) {
        const nested = source[index] ?? '';
        raw += nested;
        value += nested;
        if (nestedQuote.length > 0) {
          if (
            nested === '\\' &&
            nestedQuote === '"' &&
            index + 1 < source.length
          ) {
            index += 1;
            raw += source[index] ?? '';
            value += source[index] ?? '';
          } else if (nested === nestedQuote) nestedQuote = '';
        } else if (nested === '"' || nested === "'") nestedQuote = nested;
        else if (nested === '(') depth += 1;
        else if (nested === ')') depth -= 1;
      }
      if (depth > 0)
        throw new Error('Unterminated shell command substitution.');
      index -= 1;
      continue;
    }
    if (dataParenthesisDepth > 0) {
      raw += character;
      value += character;
      if (character === '(') dataParenthesisDepth += 1;
      if (character === ')') dataParenthesisDepth -= 1;
      if (character === '$' || character === '`') dynamic = true;
      continue;
    }
    if (quote.length > 0) {
      raw += character;
      if (quote === '"' && character === '\\' && index + 1 < source.length) {
        const escaped = source[index + 1] ?? '';
        raw += escaped;
        value += escaped;
        index += 1;
        continue;
      }
      if (character === quote) {
        quote = '';
        continue;
      }
      value += character;
      if (quote === '"' && (character === '$' || character === '`'))
        dynamic = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      raw += character;
      continue;
    }
    if (isShellCommentStart([source, index])) {
      while (index + 1 < source.length && source[index + 1] !== '\n')
        index += 1;
      continue;
    }
    if (character === '\\' && source[index + 1] === '\n') {
      index += 1;
      continue;
    }
    if (character === '\\' && index + 1 < source.length) {
      raw += character + (source[index + 1] ?? '');
      value += source[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (character === '(' && /^[A-Za-z_][A-Za-z0-9_]*\+?=$/u.test(raw)) {
      raw += character;
      value += character;
      dataParenthesisDepth = 1;
      continue;
    }
    if (/\s/u.test(character) || ';&|()'.includes(character)) {
      pushWord();
      if (';&|()'.includes(character) || character === '\n') {
        const pair = source.slice(index, index + 2);
        if (pair === '&&' || pair === '||' || pair === ';;') index += 1;
        tokens.push(
          (pair === '&&' || pair === '||' || pair === ';;'
            ? pair
            : character) as ShellSeparator,
        );
      }
      continue;
    }
    raw += character;
    value += character;
    if (character === '$' || character === '`') dynamic = true;
  }
  if (quote.length > 0) throw new Error('Unterminated shell quote.');
  if (dataParenthesisDepth > 0)
    throw new Error('Unterminated shell data region.');
  pushWord();
  if (tokens.length > MAX_TOKENS)
    throw new Error('Shell token count exceeds its bound.');
  return tokens;
}
