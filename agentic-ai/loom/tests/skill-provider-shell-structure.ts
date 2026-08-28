export type ShellStructureInspection = {
  readonly functions: Map<string, string>;
  readonly source: string;
};

export type ShellStructure = {
  readonly source: string;
  readonly substitutions: readonly string[];
};

type Delimiter = {
  readonly delimiter: string;
  readonly expands: boolean;
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
    substitutions: heredocs.substitutions,
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
      if (candidate === active.delimiter) pending.shift();
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
      index = compoundEnd;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (
      character === '#' &&
      (index === 0 || /\s/u.test(source[index - 1] ?? ''))
    )
      break;
    if (
      source.slice(index, index + 2) !== '<<' ||
      source[index - 1] === '<' ||
      source[index + 2] === '<'
    )
      continue;
    let cursor = index + 2;
    const stripTabs = source[cursor] === '-';
    if (stripTabs) cursor += 1;
    while (source[cursor] === ' ' || source[cursor] === '\t') cursor += 1;
    const delimiterRequest: DelimiterRequest = { source, start: cursor };
    const parsed = delimiterWord(delimiterRequest);
    if (parsed === false) throw new Error('Shell heredoc has no delimiter.');
    const delimiter: Delimiter = {
      delimiter: parsed.value,
      expands: !parsed.quoted,
      stripTabs,
    };
    delimiters.push(delimiter);
    retained.fill(' ', index, parsed.end);
    index = parsed.end - 1;
  }
  return { delimiters, source: retained.join('') };
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
  for (let index = 0; index < inspection.source.length; index += 1) {
    const character = inspection.source[index] ?? '';
    if (quote) {
      if (character === '\\' && quote === '"') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (
      character === '#' &&
      (index === 0 || /\s/u.test(inspection.source[index - 1] ?? ''))
    ) {
      index = inspection.source.indexOf('\n', index);
      if (index < 0) break;
      continue;
    }
    if (index > 0 && /[A-Za-z0-9_]/u.test(inspection.source[index - 1] ?? ''))
      continue;
    const match =
      /^(?:function\s+([A-Za-z_]\w*)(?:\s*\(\s*\))?|([A-Za-z_]\w*)\s*\(\s*\))\s*\{/u.exec(
        inspection.source.slice(index),
      );
    if (!match) continue;
    const start = (match.index ?? 0) + match[0].length;
    const closingRequest: ClosingRequest = {
      closing: '}',
      opening: '{',
      source: inspection.source,
      start: index + start,
    };
    const end = findClosing(closingRequest);
    inspection.functions.set(
      match[1] ?? match[2] ?? '',
      inspection.source.slice(index + start, end),
    );
    retained.fill(' ', index, end + 1);
    index = end;
  }
  return retained.join('');
}

function findClosing(request: ClosingRequest): number {
  let depth = 1;
  let quote = '';
  for (let index = request.start; index < request.source.length; index += 1) {
    const character = request.source[index] ?? '';
    if (quote.length > 0) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (
      character === '#' &&
      (index === 0 || /\s/u.test(request.source[index - 1] ?? ''))
    ) {
      index = request.source.indexOf('\n', index);
      if (index < 0) break;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === request.opening) depth += 1;
    else if (character === request.closing && --depth === 0) return index;
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
      character === '$' &&
      source[index + 1] === '(' &&
      source[index + 2] !== '('
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
