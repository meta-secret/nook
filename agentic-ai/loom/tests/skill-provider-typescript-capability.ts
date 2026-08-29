import ts from 'typescript';

export enum SubprocessCallKind {
  Bun = 'bun',
  Exec = 'exec',
  ExecFile = 'execFile',
  Fork = 'fork',
  Namespace = 'namespace',
  RunCommand = 'runCommand',
  Spawn = 'spawn',
}

export const CHILD_PROCESS_CALLS = new Map<string, SubprocessCallKind>([
  ['spawn', SubprocessCallKind.Spawn],
  ['spawnSync', SubprocessCallKind.Spawn],
  ['execFile', SubprocessCallKind.ExecFile],
  ['execFileSync', SubprocessCallKind.ExecFile],
  ['exec', SubprocessCallKind.Exec],
  ['execSync', SubprocessCallKind.Exec],
  ['fork', SubprocessCallKind.Fork],
]);

export type TaggedTemplateText = {
  readonly dynamic: boolean;
  readonly value: string;
};

export type BunShellTemplateRequest = {
  readonly bunShadowed: boolean;
  readonly evaluate: (expression: ts.Expression) => TaggedTemplateText;
  readonly tagged: ts.TaggedTemplateExpression;
};

export type SerializedSubprocessCommand = {
  readonly shellSource: boolean;
  readonly words: readonly TaggedTemplateText[];
};

export function bunShellTemplateCommand(
  request: BunShellTemplateRequest,
): string | false {
  const tag = request.tagged.tag;
  if (
    request.bunShadowed ||
    !ts.isPropertyAccessExpression(tag) ||
    !ts.isIdentifier(tag.expression) ||
    tag.expression.text !== 'Bun' ||
    tag.name.text !== '$'
  )
    return false;
  const template = request.tagged.template;
  if (ts.isNoSubstitutionTemplateLiteral(template)) return template.text;
  let command = template.head.text;
  for (const span of template.templateSpans) {
    const value = request.evaluate(span.expression);
    if (value.dynamic)
      throw new Error('Dynamic Bun.$ subprocess shell source is forbidden.');
    command += shellQuote(value.value) + span.literal.text;
  }
  return command;
}

export function staticMemberAccess(
  expression: ts.Expression,
): readonly [ts.Expression, string] | false {
  if (ts.isPropertyAccessExpression(expression))
    return [expression.expression, expression.name.text];
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isStringLiteral(expression.argumentExpression)
  )
    return [expression.expression, expression.argumentExpression.text];
  return false;
}

export function serializeSubprocessCommand(
  command: SerializedSubprocessCommand,
): string {
  if (command.shellSource) return command.words[0]?.value ?? '';
  return command.words
    .map((word) => {
      const escaped = word.value.replaceAll("'", "'\\''");
      return word.dynamic ? `"\${DYNAMIC:-${escaped}}"` : `'${escaped}'`;
    })
    .join(' ');
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
