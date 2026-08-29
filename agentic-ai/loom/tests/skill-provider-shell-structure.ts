import { isShellCommentStart } from './skill-provider-shell-tokenizer.ts';

export type ShellStructureInspection = {
  readonly functions: Map<string, string>;
  readonly source: string;
};

export type ShellStructure = {
  readonly source: string;
  readonly substitutions: readonly string[];
};

type Delimiter = {
  body: string;
  readonly delimiter: string;
  readonly expands: boolean;
  readonly shellInput: boolean;
  readonly stripTabs: boolean;
};
type StrippedHeredocs = {
  readonly source: string;
  readonly substitutions: readonly string[];
};
type HeredocLine = {
  readonly delimiters: readonly Delimiter[];
  readonly source: string;
};
type ClosingRequest = {
  readonly closing: string;
  readonly opening: string;
  readonly source: string;
  readonly start: number;
};
type DelimiterRequest = {
  readonly source: string;
  readonly start: number;
};

export function shellStructure(
  inspection: ShellStructureInspection,
): ShellStructure {
  const heredocs = stripHeredocs(inspection.source);
  const functionInspection: ShellStructureInspection = {
    ...inspection,
    source: heredocs.source,
  };
  const source = extractFunctions(functionInspection);
  return {
    source,
    substitutions: [
      ...heredocs.substitutions,
      ...compoundSubstitutions(heredocs.source),
    ],
  };
}

function stripHeredocs(source: string): StrippedHeredocs {
  const output: string[] = [];
  const pending: Delimiter[] = [];
  const substitutions: string[] = [];
  for (const line of source.match(/[^\n]*(?:\n|$)/gu) ?? []) {
    const active = pending[0];
    if (active) {
      const candidate = (
        active.stripTabs ? line.replace(/^\t+/u, '') : line
      ).replace(/\n$/u, '');
      if (candidate === active.delimiter) {
        if (active.shellInput) substitutions.push(active.body);
        pending.shift();
      } else if (active.shellInput) active.body += line;
      else if (active.expands)
        substitutions.push(...shellSubstitutionBodies(line));
      output.push(line.endsWith('\n') ? '\n' : '');
      continue;
    }
    const declaration = heredocLine(line);
    pending.push(...declaration.delimiters);
    output.push(declaration.source);
  }
  if (pending.length > 0)
    throw new Error(`Unterminated shell heredoc: ${pending[0]?.delimiter}`);
  return { source: output.join(''), substitutions };
}

function heredocLine(source: string): HeredocLine {
  const retained = [...source];
  const delimiters: Delimiter[] = [];
  let quote = '';
  let wordActive = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (quote) {
      if (character === '\\' && quote === '"') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    const compoundRequest: DelimiterRequest = { source, start: index };
    const compoundEnd = shellCompoundEnd(compoundRequest);
    if (compoundEnd !== false) {
      wordActive = true;
      index = compoundEnd;
      continue;
    }
    if (character === '"' || character === "'") {
      wordActive = true;
      quote = character;
      continue;
    }
    if (character === '\\') {
      wordActive = true;
      index += 1;
      continue;
    }
    if (isShellCommentStart([source, index, wordActive])) break;
    if (
      source.slice(index, index + 2) !== '<<' ||
      source[index - 1] === '<' ||
      source[index + 2] === '<'
    ) {
      wordActive = /\s/u.test(character) ? false : !';&|()'.includes(character);
      continue;
    }
    let cursor = index + 2;
    const stripTabs = source[cursor] === '-';
    if (stripTabs) cursor += 1;
    while (source[cursor] === ' ' || source[cursor] === '\t') cursor += 1;
    const delimiterRequest: DelimiterRequest = { source, start: cursor };
    const parsed = delimiterWord(delimiterRequest);
    if (parsed === false) throw new Error('Shell heredoc has no delimiter.');
    const delimiter: Delimiter = {
      body: '',
      delimiter: parsed.value,
      expands: !parsed.quoted,
      shellInput:
        /(?:^|[;&|]\s*)(?:bash|sh|source)\b[^#\n]*<</u.test(source) ||
        /(?:^|[;&|]\s*)\.\s+[^#\n]*<</u.test(source) ||
        /<<[^|\n]*\|\s*(?:bash|sh)\b/u.test(source),
      stripTabs,
    };
    delimiters.push(delimiter);
    wordActive = true;
    retained.fill(' ', index, parsed.end);
    index = parsed.end - 1;
  }
  return { delimiters, source: retained.join('') };
}

function compoundSubstitutions(source: string): readonly string[] {
  const substitutions: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (
      !['[[', '((', '$(('].some((opening) => source.startsWith(opening, index))
    )
      continue;
    const request: DelimiterRequest = { source, start: index };
    const end = shellCompoundEnd(request);
    if (end === false) continue;
    substitutions.push(
      ...shellSubstitutionBodies(source.slice(index, end + 1)),
    );
    index = end;
  }
  return substitutions;
}

function shellCompoundEnd(request: DelimiterRequest): number | false {
  const opening =
    request.source.slice(request.start, request.start + 3) === '$(('
      ? '$(('
      : request.source.slice(request.start, request.start + 2);
  const closing =
    opening === '$((' || opening === '((' ? '))' : opening === '[[' ? ']]' : '';
  if (!closing) return false;
  const end = request.source.indexOf(closing, request.start + opening.length);
  if (end < 0) throw new Error('Unterminated shell compound region.');
  return end + closing.length - 1;
}

type DelimiterWord = {
  readonly end: number;
  readonly quoted: boolean;
  readonly value: string;
};

function delimiterWord(request: DelimiterRequest): DelimiterWord | false {
  let value = '';
  let quote = '';
  let quoted = false;
  let index = request.start;
  for (; index < request.source.length; index += 1) {
    const character = request.source[index] ?? '';
    if (quote) {
      if (character === quote) quote = '';
      else if (character === '\\' && quote === '"') {
        quoted = true;
        index += 1;
        value += request.source[index] ?? '';
      } else value += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      quoted = true;
      continue;
    }
    if (character === '\\') {
      quoted = true;
      index += 1;
      value += request.source[index] ?? '';
      continue;
    }
    if (/\s/u.test(character) || ';&|()<>'.includes(character)) break;
    value += character;
  }
  if (quote) throw new Error('Unterminated shell heredoc delimiter quote.');
  return value ? { end: index, quoted, value } : false;
}

function extractFunctions(inspection: ShellStructureInspection): string {
  const retained = [...inspection.source];
  let quote = '';
  let wordActive = false;
  for (let index = 0; index < inspection.source.length; index += 1) {
    const character = inspection.source[index] ?? '';
    if (quote) {
      if (character === '\\' && quote === '"') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      wordActive = true;
      quote = character;
      continue;
    }
    if (character === '\\') {
      wordActive = true;
      index += 1;
      continue;
    }
    if (isShellCommentStart([inspection.source, index, wordActive])) {
      index = inspection.source.indexOf('\n', index);
      if (index < 0) break;
      wordActive = false;
      continue;
    }
    if (/\s/u.test(character) || ';&|()'.includes(character)) {
      wordActive = false;
      continue;
    }
    if (wordActive) continue;
    const match =
      /^(?:function\s+([A-Za-z_]\w*)(?:\s*\(\s*\))?|([A-Za-z_]\w*)\s*\(\s*\))\s*\{/u.exec(
        inspection.source.slice(index),
      );
    if (!match) {
      wordActive = true;
      continue;
    }
    const start = (match.index ?? 0) + match[0].length;
    const closingRequest: ClosingRequest = {
      closing: '}',
      opening: '{',
      source: inspection.source,
      start: index + start,
    };
    const end = findClosing(closingRequest);
    const name = match[1] ?? match[2] ?? '';
    const body = inspection.source.slice(index + start, end);
    const previous = inspection.functions.get(name);
    inspection.functions.set(name, previous ? `${previous}\n${body}` : body);
    retained.fill(' ', index, end + 1);
    wordActive = true;
    index = end;
  }
  return retained.join('');
}

function findClosing(request: ClosingRequest): number {
  let depth = 1;
  let quote = '';
  let wordActive = false;
  for (let index = request.start; index < request.source.length; index += 1) {
    const character = request.source[index] ?? '';
    if (quote.length > 0) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (isShellCommentStart([request.source, index, wordActive])) {
      index = request.source.indexOf('\n', index);
      if (index < 0) break;
      wordActive = false;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      wordActive = true;
    } else if (character === '\\') {
      wordActive = true;
      index += 1;
    } else {
      if (character === request.opening) depth += 1;
      else if (character === request.closing && --depth === 0) return index;
      wordActive = /\s/u.test(character) ? false : !';&|()'.includes(character);
    }
  }
  throw new Error(
    `Unterminated shell ${request.opening}${request.closing} structure.`,
  );
}

export function shellSubstitutionBodies(source: string): readonly string[] {
  const bodies: string[] = [];
  let quote = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (quote === "'") {
      if (character === "'") quote = '';
      continue;
    }
    if (character === "'") {
      quote = character;
      continue;
    }
    if (character === '"') {
      quote = quote === '"' ? '' : '"';
      continue;
    }
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (
      ((character === '$' && source[index + 2] !== '(') ||
        character === '<' ||
        character === '>') &&
      source[index + 1] === '('
    ) {
      const start = index + 2;
      const closingRequest: ClosingRequest = {
        closing: ')',
        opening: '(',
        source,
        start,
      };
      const end = findClosing(closingRequest);
      bodies.push(source.slice(start, end));
      index = end;
      continue;
    }
    if (character === '`') {
      const end = source.indexOf('`', index + 1);
      if (end < 0) throw new Error('Unterminated shell backtick substitution.');
      bodies.push(source.slice(index + 1, end));
      index = end;
    }
  }
  return bodies;
}
