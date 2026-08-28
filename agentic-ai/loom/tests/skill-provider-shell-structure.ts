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
type ClosingRequest = {
  readonly closing: string;
  readonly opening: string;
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
    for (const declaration of line.matchAll(
      /<<(-?)(["']?)([A-Za-z_]\w*)\2/gu,
    )) {
      const delimiter: Delimiter = {
        delimiter: declaration[3] ?? '',
        expands: (declaration[2] ?? '') === '',
        stripTabs: declaration[1] === '-',
      };
      pending.push(delimiter);
    }
    output.push(line.replace(/<<-?["']?[A-Za-z_]\w*["']?/gu, ''));
  }
  if (pending.length > 0) throw new Error('Unterminated shell heredoc.');
  return { source: output.join(''), substitutions };
}

function extractFunctions(inspection: ShellStructureInspection): string {
  const retained = [...inspection.source];
  for (const match of inspection.source.matchAll(
    /\b(?:function\s+([A-Za-z_]\w*)\s*|([A-Za-z_]\w*)\s*\(\s*\)\s*)\{/gu,
  )) {
    const start = (match.index ?? 0) + match[0].length;
    const closingRequest: ClosingRequest = {
      closing: '}',
      opening: '{',
      source: inspection.source,
      start,
    };
    const end = findClosing(closingRequest);
    inspection.functions.set(
      match[1] ?? match[2] ?? '',
      inspection.source.slice(start, end),
    );
    retained.fill(' ', match.index, end + 1);
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
