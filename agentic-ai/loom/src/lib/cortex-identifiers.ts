import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
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
import {
  markdownHeadingFragments,
  normalizedCortexMarkdown,
} from '../../../../.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/src/cortex-document-structure.ts';

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
  readonly authority: string;
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

export type AuditCortexIdentifierStabilityArgs = {
  readonly current: CortexIdentifierRegistry;
  readonly published: CortexIdentifierRegistry;
};

export type RegisteredCortexIdentifiersAtCommitArgs = {
  readonly repoRoot: string;
  readonly sourceCommit: string;
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

export function decodeCortexIdentifierRegistry(
  serialized: string,
): CortexIdentifierRegistry | false {
  let value: UntrustedYamlNode;
  try {
    value = asUntrustedYamlNode(JSON.parse(serialized) as UntrustedYamlNode);
  } catch {
    return false;
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== CORTEX_IDENTIFIER_SCHEMA_VERSION ||
    !Array.isArray(value.entries)
  ) {
    return false;
  }
  const entries = value.entries.map(decodeEntry);
  if (entries.some((entry) => entry === false)) return false;
  return {
    schemaVersion: CORTEX_IDENTIFIER_SCHEMA_VERSION,
    entries: entries.filter(
      (entry): entry is CortexIdentifierEntry => entry !== false,
    ),
  };
}

export function auditCortexIdentifierStability(
  args: AuditCortexIdentifierStabilityArgs,
): readonly CortexIdentifierFinding[] {
  const currentById = new Map(
    args.current.entries.map((entry) => [entry.id, entry]),
  );
  return args.published.entries.flatMap((publishedEntry) => {
    const currentEntry = currentById.get(publishedEntry.id);
    if (!currentEntry) {
      return [
        finding(
          `Published Cortex identifier ${publishedEntry.id} was removed; retain its assignment or an explicit tombstone.`,
        ),
      ];
    }
    if (
      currentEntry.kind !== publishedEntry.kind ||
      currentEntry.categoryId !== publishedEntry.categoryId ||
      currentEntry.authority !== publishedEntry.authority
    ) {
      return [
        finding(
          `Published Cortex identifier ${publishedEntry.id} was reassigned to a different authority.`,
        ),
      ];
    }
    return [];
  });
}

export function registeredCortexIdentifiers(
  repoRoot: string,
): ReadonlySet<string> {
  const audit = auditCortexIdentifierRegistry(repoRoot);
  return audit.registry && audit.findings.length === 0
    ? cortexIdentifierSet(audit.registry)
    : new Set<string>();
}

export function registeredCortexIdentifiersAtCommit(
  args: RegisteredCortexIdentifiersAtCommitArgs,
): ReadonlySet<string> {
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: args.repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  };
  try {
    const checkoutCommit = execFileSync('git', ['rev-parse', 'HEAD'], options)
      .trim()
      .toLowerCase();
    if (checkoutCommit !== args.sourceCommit.toLowerCase()) {
      return new Set<string>();
    }
    const cortexChanges = execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=all', '--', '.cortex'],
      options,
    );
    if (cortexChanges.trim() !== '') return new Set<string>();
    return registeredCortexIdentifiers(args.repoRoot);
  } catch {
    return new Set<string>();
  }
}

export function publishedCortexIdentifiersAtCommit(
  args: RegisteredCortexIdentifiersAtCommitArgs,
): ReadonlySet<string> {
  if (!/^[0-9a-f]{40}$/u.test(args.sourceCommit)) return new Set<string>();
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: args.repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  };
  try {
    execFileSync(
      'git',
      ['cat-file', '-e', `${args.sourceCommit}^{commit}`],
      options,
    );
    const serialized = execFileSync(
      'git',
      ['show', `${args.sourceCommit}:${CORTEX_IDENTIFIER_REGISTRY_PATH}`],
      options,
    );
    const registry = decodeCortexIdentifierRegistry(serialized);
    if (!registry) return new Set<string>();
    const ids = new Set<string>();
    const authorities = new Set<string>();
    for (const entry of registry.entries) {
      if (ids.has(entry.id) || authorities.has(entry.authority)) {
        return new Set<string>();
      }
      ids.add(entry.id);
      authorities.add(entry.authority);
    }
    return ids;
  } catch {
    return new Set<string>();
  }
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
    typeof value.authority !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{1,63}$/u.test(value.authority) ||
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
      authority: value.authority,
      title: value.title,
      locator: value.locator,
    };
  }
  if (typeof value.categoryId !== 'string') return false;
  return {
    id: value.id,
    kind: decodedKind,
    authority: value.authority,
    categoryId: value.categoryId,
    title: value.title,
    locator: value.locator,
  };
}

function validateEntries(args: ValidateEntriesArgs): void {
  const ids = new Set<string>();
  const locators = new Set<string>();
  const authorities = new Set<string>();
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
    if (authorities.has(entry.authority)) {
      args.findings.push(
        finding(`Cortex authority ${entry.authority} is duplicated.`),
      );
    }
    ids.add(entry.id);
    locators.add(entry.locator);
    authorities.add(entry.authority);
    if (
      entry.kind !== CortexIdentifierKind.Category &&
      (!entry.categoryId ||
        !categoryIds.has(entry.categoryId) ||
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
  const locatorSegments = relativePath?.split('/') ?? [];
  if (
    extra.length > 0 ||
    !relativePath ||
    !relativePath.startsWith('.cortex/') ||
    !relativePath.endsWith('.md') ||
    locatorSegments.includes('.session') ||
    locatorSegments.includes('scripts') ||
    locatorSegments.includes('node_modules')
  ) {
    args.findings.push(
      finding(`Cortex locator ${args.entry.locator} is invalid.`),
    );
    return;
  }
  const realRepoRoot = realpathSync(args.repoRoot);
  const absolutePath = path.resolve(realRepoRoot, relativePath);
  const cortexRoot = `${realpathSync(path.resolve(realRepoRoot, '.cortex'))}${path.sep}`;
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
  const locatorStat = lstatSync(absolutePath);
  if (locatorStat.isSymbolicLink() || !locatorStat.isFile()) {
    args.findings.push(
      finding(
        `Cortex locator ${args.entry.locator} does not name a regular Cortex document.`,
      ),
    );
    return;
  }
  const realTarget = realpathSync(absolutePath);
  if (!realTarget.startsWith(cortexRoot)) {
    args.findings.push(
      finding(`Cortex locator ${args.entry.locator} escapes the Cortex root.`),
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
    !markdownHeadingFragments(
      normalizedCortexMarkdown({
        relativePath,
        content: readFileSync(absolutePath, 'utf8'),
      }),
    ).has(fragment)
  ) {
    args.findings.push(
      finding(`Cortex locator ${args.entry.locator} has no matching heading.`),
    );
  }
}

function finding(message: string): CortexIdentifierFinding {
  return { file: CORTEX_IDENTIFIER_REGISTRY_PATH, message };
}
