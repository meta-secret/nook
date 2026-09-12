import { err, ok, type Result } from 'neverthrow';
import {
  CST,
  Lexer,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  stringify,
  type ParsedNode,
} from 'yaml';

export class ExecutableSkillYaml {
  private constructor(private readonly request: string) {}

  static from(text: string): ExecutableSkillYaml {
    return new ExecutableSkillYaml(text);
  }

  public execute(): SkillYamlParseOutcome {
    const text = this.request;
    try {
      const normalizedText = text.replace(/\r\n?/gu, '\n');
      if (
        !this.skillYamlSourceWithinBounds(normalizedText) ||
        /^%[A-Z]+(?:[ \t]|$)/mu.test(normalizedText)
      ) {
        return err({ message: YAML_SYNTAX_FAILURE });
      }
      const document = parseDocument(normalizedText, YAML_PARSE_OPTIONS);
      if (
        document.errors.length > 0 ||
        document.warnings.length > 0 ||
        document.directives.yaml.explicit ||
        Object.entries(document.directives.tags).some(
          ([handle, prefix]) =>
            handle !== '!!' || prefix !== 'tag:yaml.org,2002:',
        ) ||
        !document.contents
      ) {
        return err({ message: YAML_SYNTAX_FAILURE });
      }
      const astIssue = this.validateSkillYamlAst(document.contents);
      if (astIssue === SkillYamlAstIssue.Reference) {
        return err({ message: YAML_REFERENCE_FAILURE });
      }
      if (astIssue === SkillYamlAstIssue.Unsupported) {
        return err({ message: YAML_SYNTAX_FAILURE });
      }
      const admission = ExecutableSkillYamlAdmission.from(
        document.toJS(YAML_TO_JS_OPTIONS),
      ).execute();
      return admission.isOk()
        ? ok(admission.value)
        : err({ message: YAML_SYNTAX_FAILURE });
    } catch {
      return err({ message: YAML_SYNTAX_FAILURE });
    }
  }

  private skillYamlSourceWithinBounds(source: string): boolean {
    if (UTF8_ENCODER.encode(source).byteLength > SKILL_YAML_DOCUMENT_BYTE_LIMIT)
      return false;
    let depth = 0;
    let nodes = 0;
    let scalarFollows = false;
    let lineStart = true;
    for (const lexeme of new Lexer().lex(source)) {
      const type = CST.tokenType(lexeme);
      const scalarContent = scalarFollows;
      if (scalarFollows) {
        scalarFollows = false;
        if (
          UTF8_ENCODER.encode(lexeme).byteLength > SKILL_YAML_SCALAR_BYTE_LIMIT
        )
          return false;
      }
      if (type === 'scalar') {
        scalarFollows = true;
        nodes += 1;
      } else if (
        type === 'alias' ||
        type === 'single-quoted-scalar' ||
        type === 'double-quoted-scalar'
      ) {
        nodes += 1;
        if (
          UTF8_ENCODER.encode(lexeme).byteLength > SKILL_YAML_SCALAR_BYTE_LIMIT
        )
          return false;
      } else if (type === 'flow-map-start' || type === 'flow-seq-start') {
        nodes += 1;
        depth += 1;
      } else if (type === 'flow-map-end' || type === 'flow-seq-end') {
        depth -= 1;
      } else if (type === 'map-value-ind' || type === 'seq-item-ind') {
        nodes += 1;
      }
      if (
        !scalarContent &&
        lineStart &&
        type === 'space' &&
        lexeme.length >= SKILL_YAML_DEPTH_LIMIT
      )
        return false;
      lineStart = type === 'newline';
      if (nodes > SKILL_YAML_NODE_LIMIT || depth > SKILL_YAML_DEPTH_LIMIT)
        return false;
    }
    return true;
  }

  private validateSkillYamlAst(node: ParsedNode): SkillYamlAstIssue {
    const pending: Array<{
      readonly depth: number;
      readonly node: ParsedNode;
    }> = [{ depth: 0, node }];
    let nodes = 0;
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) return SkillYamlAstIssue.Unsupported;
      nodes += 1;
      if (
        nodes > SKILL_YAML_NODE_LIMIT ||
        current.depth > SKILL_YAML_DEPTH_LIMIT
      )
        return SkillYamlAstIssue.Unsupported;
      const item = current.node;
      if (isAlias(item) || typeof item.anchor === 'string')
        return SkillYamlAstIssue.Reference;
      if (typeof item.tag === 'string') return SkillYamlAstIssue.Unsupported;
      if (isScalar(item)) {
        if (
          typeof item.value !== 'string' &&
          typeof item.value !== 'boolean' &&
          (typeof item.value !== 'number' ||
            !Number.isFinite(item.value) ||
            (Number.isInteger(item.value) && !Number.isSafeInteger(item.value)))
        )
          return SkillYamlAstIssue.Unsupported;
        continue;
      }
      if (isMap(item)) {
        for (const pair of item.items) {
          if (!isScalar(pair.key) || typeof pair.key.value !== 'string') {
            return SkillYamlAstIssue.Unsupported;
          }
          if (!pair.value) return SkillYamlAstIssue.Unsupported;
          const value = { depth: current.depth + 1, node: pair.value };
          const key = { depth: current.depth + 1, node: pair.key };
          pending.push(value, key);
        }
        continue;
      }
      if (isSeq(item)) {
        for (const child of item.items) {
          if (!child) return SkillYamlAstIssue.Unsupported;
          const next = { depth: current.depth + 1, node: child };
          pending.push(next);
        }
        continue;
      }
      return SkillYamlAstIssue.Unsupported;
    }
    return SkillYamlAstIssue.None;
  }
}

/**
 * Boundary-only YAML syntax node. Decode it immediately into a concrete skill
 * request. Never retain it in skill domain state or expose it from actions.
 */
export type UntrustedSkillYamlNode =
  | string
  | number
  | boolean
  | readonly UntrustedSkillYamlNode[]
  | UntrustedSkillYamlMap;

export type UntrustedSkillYamlMap = {
  readonly [key: string]: UntrustedSkillYamlNode;
};

type UntrustedSkillYamlHostContainer =
  readonly unknown[] | Readonly<Record<string, unknown>>;

type SkillYamlAdmissionState = {
  nodes: number;
  readonly seen: Set<UntrustedSkillYamlHostContainer>;
};

type SkillYamlAdmissionRequest = {
  readonly depth: number;
  readonly state: SkillYamlAdmissionState;
  readonly value: unknown;
};

type SkillYamlAdmissionFailure = {
  readonly message: string;
};

type UntrustedSkillYamlMapBuilder = {
  [key: string]: UntrustedSkillYamlNode;
};

export type SkillYamlParseFailure = {
  readonly message: string;
};

export type SkillYamlParseOutcome = Result<
  UntrustedSkillYamlNode,
  SkillYamlParseFailure
>;

const YAML_REFERENCE_FAILURE =
  'YAML anchors and aliases are not supported by executable skills.';

const YAML_SYNTAX_FAILURE = 'Invalid YAML syntax.';

const YAML_STRINGIFY_OPTIONS = {
  aliasDuplicateObjects: false,
  indent: 2,
} as const;

enum SkillYamlAstIssue {
  None = 'none',
  Reference = 'reference',
  Unsupported = 'unsupported',
}

const YAML_PARSE_OPTIONS = {
  prettyErrors: false,
  resolveKnownTags: false,
  schema: 'core',
  strict: true,
  uniqueKeys: true,
} as const;

const YAML_TO_JS_OPTIONS = { maxAliasCount: 0 } as const;

export const SKILL_YAML_NODE_LIMIT = 16_384;

export const SKILL_YAML_DEPTH_LIMIT = 64;

export const SKILL_YAML_SCALAR_BYTE_LIMIT = 1024 * 1024;

const UTF8_ENCODER = new TextEncoder();

const SKILL_YAML_DOCUMENT_BYTE_LIMIT = 4 * 1_024 * 1_024;

export class ExecutableSkillYamlAdmission {
  private constructor(private readonly value: unknown) {}

  static from(value: unknown): ExecutableSkillYamlAdmission {
    return new ExecutableSkillYamlAdmission(value);
  }

  execute(): Result<UntrustedSkillYamlNode, SkillYamlAdmissionFailure> {
    const state: SkillYamlAdmissionState = { nodes: 0, seen: new Set() };
    try {
      return this.admit({ depth: 0, state, value: this.value });
    } catch {
      return this.invalid();
    }
  }

  private admit(
    request: SkillYamlAdmissionRequest,
  ): Result<UntrustedSkillYamlNode, SkillYamlAdmissionFailure> {
    const { depth, state, value } = request;
    state.nodes += 1;
    if (state.nodes > SKILL_YAML_NODE_LIMIT || depth > SKILL_YAML_DEPTH_LIMIT) {
      return this.invalid();
    }
    if (typeof value === 'string') {
      return this.oversizedScalar(value) ? this.invalid() : ok(value);
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) &&
        (!Number.isInteger(value) || Number.isSafeInteger(value))
        ? ok(value)
        : this.invalid();
    }
    if (typeof value === 'boolean') return ok(value);
    if (this.isList(value)) return this.admitList({ depth, state, value });
    if (this.isMap(value)) return this.admitMap({ depth, state, value });
    return this.invalid();
  }

  private admitList(
    request: SkillYamlAdmissionRequest & {
      readonly value: readonly unknown[];
    },
  ): Result<UntrustedSkillYamlNode, SkillYamlAdmissionFailure> {
    const { depth, state, value } = request;
    if (state.seen.has(value)) return this.invalid();
    state.seen.add(value);
    const admitted: UntrustedSkillYamlNode[] = [];
    for (const child of value) {
      const outcome = this.admit({ depth: depth + 1, state, value: child });
      if (outcome.isErr()) return err(outcome.error);
      admitted.push(outcome.value);
    }
    return ok(admitted);
  }

  private admitMap(
    request: SkillYamlAdmissionRequest & {
      readonly value: Readonly<Record<string, unknown>>;
    },
  ): Result<UntrustedSkillYamlNode, SkillYamlAdmissionFailure> {
    const { depth, state, value } = request;
    if (state.seen.has(value)) return this.invalid();
    state.seen.add(value);
    const entries = Object.entries(value);
    state.nodes += entries.length;
    if (state.nodes > SKILL_YAML_NODE_LIMIT) return this.invalid();
    const admitted: UntrustedSkillYamlMapBuilder = {};
    for (const [key, child] of entries) {
      if (this.oversizedScalar(key)) return this.invalid();
      const outcome = this.admit({ depth: depth + 1, state, value: child });
      if (outcome.isErr()) return err(outcome.error);
      Object.defineProperty(admitted, key, {
        configurable: true,
        enumerable: true,
        value: outcome.value,
        writable: true,
      });
    }
    return ok(admitted);
  }

  private invalid(): Result<never, SkillYamlAdmissionFailure> {
    return err({ message: 'Invalid YAML value.' });
  }

  private isList(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
  }

  private isMap(value: unknown): value is Readonly<Record<string, unknown>> {
    return (
      typeof value === 'object' &&
      value instanceof Object &&
      !this.isList(value)
    );
  }

  private oversizedScalar(value: string): boolean {
    return UTF8_ENCODER.encode(value).byteLength > SKILL_YAML_SCALAR_BYTE_LIMIT;
  }
}

/** Validate inert nodes before conversion can coerce keys or emit warnings. */

export type SkillYamlPropertyRequest = {
  readonly key: string;
  readonly map: UntrustedSkillYamlMap;
};

export type SkillYamlProperty =
  | { readonly found: true; readonly value: UntrustedSkillYamlNode }
  | { readonly found: false };

export enum SkillYamlEncodingIssue {
  InvalidValue = 'invalidValue',
  Library = 'library',
  ResponseCapacity = 'responseCapacity',
}
export type SkillYamlEncodingFailure = {
  readonly kind: SkillYamlEncodingIssue;
  readonly message: string;
};
export class ExecutableSkillYamlEncoding<Value> {
  constructor(private readonly value: Value) {}
  execute(): Result<string, SkillYamlEncodingFailure> {
    const admission = ExecutableSkillYamlAdmission.from(this.value).execute();
    if (admission.isErr()) {
      return err({
        kind: SkillYamlEncodingIssue.InvalidValue,
        message: 'Invalid YAML response.',
      });
    }
    try {
      const serialized = stringify(admission.value, YAML_STRINGIFY_OPTIONS);
      return ok(serialized.endsWith('\n') ? serialized : `${serialized}\n`);
    } catch {
      return err({
        kind: SkillYamlEncodingIssue.Library,
        message: 'Invalid YAML response.',
      });
    }
  }
}

export class SkillYamlValue {
  constructor(readonly value: UntrustedSkillYamlNode) {}
  isList(): this is SkillYamlValue & {
    readonly value: readonly UntrustedSkillYamlNode[];
  } {
    return Array.isArray(this.value);
  }
  isMap(): this is SkillYamlValue & { readonly value: UntrustedSkillYamlMap } {
    return (
      typeof this.value === 'object' &&
      this.value instanceof Object &&
      !Array.isArray(this.value)
    );
  }
}
export class ExecutableSkillYamlProperty {
  constructor(private readonly request: SkillYamlPropertyRequest) {}
  execute(): SkillYamlProperty {
    for (const [key, value] of Object.entries(this.request.map)) {
      if (key === this.request.key) return { found: true, value };
    }
    return { found: false };
  }
}
