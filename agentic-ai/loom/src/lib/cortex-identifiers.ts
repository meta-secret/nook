import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  asUntrustedYamlNode,
  isRecord,
  type UntrustedYamlNode,
} from './guards.ts';
import {
  validCortexCategoryIdentifier,
  validCortexScopedIdentifier,
} from '../agent-workflow/cortex-references.ts';
import { markdownHeadingFragments } from './cortex-document-structure.ts';

export const CORTEX_IDENTIFIER_REGISTRY_PATH = '.cortex/identifiers.json';
export const CORTEX_IDENTIFIER_SCHEMA_VERSION = 1;

export enum CortexIdentifierKind {
  Category = 'category',
  Document = 'document',
  Item = 'item',
}

export type CortexIdentifierEntry = {
  readonly id: string;
  readonly kind: CortexIdentifierKind;
  readonly categoryId?: string;
  readonly title: string;
  readonly locator: string;
};

export type CortexIdentifierRegistry = {
  readonly schemaVersion: typeof CORTEX_IDENTIFIER_SCHEMA_VERSION;
  readonly entries: readonly CortexIdentifierEntry[];
};

export type CortexIdentifierFinding = {
  readonly file: string;
  readonly message: string;
};

export type CortexIdentifierAudit = {
  readonly registry: CortexIdentifierRegistry | false;
  readonly findings: readonly CortexIdentifierFinding[];
};

type ValidateEntriesArgs = {
  readonly repoRoot: string;
  readonly entries: readonly CortexIdentifierEntry[];
  readonly findings: CortexIdentifierFinding[];
};

type ValidateLocatorArgs = {
  readonly repoRoot: string;
  readonly entry: CortexIdentifierEntry;
  readonly findings: CortexIdentifierFinding[];
};

export function auditCortexIdentifierRegistry(
  repoRoot: string,
): CortexIdentifierAudit {
  const registryPath = path.join(repoRoot, CORTEX_IDENTIFIER_REGISTRY_PATH);
  const findings: CortexIdentifierFinding[] = [];
  if (!existsSync(registryPath)) {
    findings.push(finding('Cortex identifier registry is missing.'));
    return { registry: false, findings };
  }

  let value: UntrustedYamlNode;
  try {
    value = asUntrustedYamlNode(
      JSON.parse(readFileSync(registryPath, 'utf8')) as UntrustedYamlNode,
    );
  } catch {
    findings.push(finding('Cortex identifier registry is not valid JSON.'));
    return { registry: false, findings };
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.entries)
  ) {
    findings.push(finding('Cortex identifier registry schema is invalid.'));
    return { registry: false, findings };
  }

  const entries: CortexIdentifierEntry[] = [];
  for (const [index, candidate] of value.entries.entries()) {
    const decoded = decodeEntry(candidate);
    if (!decoded) {
      findings.push(
        finding(`Cortex identifier entry ${index + 1} is invalid.`),
      );
      continue;
    }
    entries.push(decoded);
  }
  const validationArgs: ValidateEntriesArgs = { repoRoot, entries, findings };
  validateEntries(validationArgs);
  const registry: CortexIdentifierRegistry = {
    schemaVersion: CORTEX_IDENTIFIER_SCHEMA_VERSION,
    entries,
  };
  return { registry, findings };
}

export function cortexIdentifierSet(
  registry: CortexIdentifierRegistry,
): ReadonlySet<string> {
  return new Set(registry.entries.map((entry) => entry.id));
}

export function registeredCortexIdentifiers(
  repoRoot: string,
): ReadonlySet<string> {
  const audit = auditCortexIdentifierRegistry(repoRoot);
  return audit.registry && audit.findings.length === 0
    ? cortexIdentifierSet(audit.registry)
    : new Set<string>();
}

function decodeEntry(value: UntrustedYamlNode): CortexIdentifierEntry | false {
  if (!isRecord(value)) return false;
  const kind = value.kind;
  if (
    !Object.values(CortexIdentifierKind).includes(kind as CortexIdentifierKind)
  ) {
    return false;
  }
  const decodedKind = kind as CortexIdentifierKind;
  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    value.title.trim() === '' ||
    typeof value.locator !== 'string'
  ) {
    return false;
  }
  if (decodedKind === CortexIdentifierKind.Category) {
    if ('categoryId' in value) return false;
    return {
      id: value.id,
      kind: decodedKind,
      title: value.title,
      locator: value.locator,
    };
  }
  if (typeof value.categoryId !== 'string') return false;
  return {
    id: value.id,
    kind: decodedKind,
    categoryId: value.categoryId,
    title: value.title,
    locator: value.locator,
  };
}

function validateEntries(args: ValidateEntriesArgs): void {
  const ids = new Set<string>();
  const locators = new Set<string>();
  const categoryIds = new Set(
    args.entries
      .filter((entry) => entry.kind === CortexIdentifierKind.Category)
      .map((entry) => entry.id),
  );
  for (const entry of args.entries) {
    if (!validEntryIdentifier(entry)) {
      args.findings.push(
        finding(`Cortex identifier ${entry.id} has an invalid shape.`),
      );
    }
    if (ids.has(entry.id)) {
      args.findings.push(
        finding(`Cortex identifier ${entry.id} is duplicated.`),
      );
    }
    if (locators.has(entry.locator)) {
      args.findings.push(
        finding(`Cortex locator ${entry.locator} is duplicated.`),
      );
    }
    ids.add(entry.id);
    locators.add(entry.locator);
    if (
      entry.categoryId &&
      (!categoryIds.has(entry.categoryId) ||
        !entry.id.startsWith(`${entry.categoryId}-`))
    ) {
      args.findings.push(
        finding(`Cortex identifier ${entry.id} has an invalid category.`),
      );
    }
    const locatorArgs: ValidateLocatorArgs = {
      repoRoot: args.repoRoot,
      entry,
      findings: args.findings,
    };
    validateLocator(locatorArgs);
  }
}

function validEntryIdentifier(entry: CortexIdentifierEntry): boolean {
  return entry.kind === CortexIdentifierKind.Category
    ? validCortexCategoryIdentifier(entry.id)
    : validCortexScopedIdentifier(entry.id);
}

function validateLocator(args: ValidateLocatorArgs): void {
  const [relativePath, fragment, ...extra] = args.entry.locator.split('#');
  if (
    extra.length > 0 ||
    !relativePath ||
    !relativePath.startsWith('.cortex/') ||
    !relativePath.endsWith('.md')
  ) {
    args.findings.push(
      finding(`Cortex locator ${args.entry.locator} is invalid.`),
    );
    return;
  }
  const absolutePath = path.resolve(args.repoRoot, relativePath);
  const cortexRoot = `${path.resolve(args.repoRoot, '.cortex')}${path.sep}`;
  if (path.posix.normalize(relativePath) !== relativePath) {
    args.findings.push(
      finding(`Cortex locator ${args.entry.locator} is not canonical.`),
    );
    return;
  }
  if (!absolutePath.startsWith(cortexRoot) || !existsSync(absolutePath)) {
    args.findings.push(
      finding(`Cortex locator ${args.entry.locator} does not exist.`),
    );
    return;
  }
  if (args.entry.kind === CortexIdentifierKind.Item && !fragment) {
    args.findings.push(
      finding(`Cortex item ${args.entry.id} must name a heading fragment.`),
    );
    return;
  }
  if (args.entry.kind !== CortexIdentifierKind.Item && fragment) {
    args.findings.push(
      finding(
        `Cortex ${args.entry.kind} ${args.entry.id} cannot name a heading fragment.`,
      ),
    );
    return;
  }
  if (
    fragment &&
    !markdownHeadingFragments(readFileSync(absolutePath, 'utf8')).has(fragment)
  ) {
    args.findings.push(
      finding(`Cortex locator ${args.entry.locator} has no matching heading.`),
    );
  }
}

function finding(message: string): CortexIdentifierFinding {
  return { file: CORTEX_IDENTIFIER_REGISTRY_PATH, message };
}
