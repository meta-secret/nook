import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LoomFailureCode, loomFailureDetail } from '../../loom-failure.ts';
import {
  ExternalPropertyPresence,
  asExternalValue,
  externalProperty,
  type ExternalValue,
  isRecord,
} from '../guards.ts';

import type { ExternalPropertyArgs } from '../guards.ts';
import type { LoomFailureDetailArgs } from '../../loom-failure.ts';
export type ManifestDependencies = {
  readonly npmPackages: readonly string[];
  readonly rustCrates: readonly string[];
};

export function scanRepositoryManifests(
  repoRoot: string,
): ManifestDependencies {
  return {
    npmPackages: readNpmPackages(
      path.join(repoRoot, 'agentic-ai/loom/package.json'),
    ),
    rustCrates: readExternalWorkspaceCrates(
      path.join(repoRoot, 'nook-app/nook-platform'),
    ),
  };
}

function readNpmPackages(packageJsonPath: string): readonly string[] {
  const text = readFileSync(packageJsonPath, 'utf8');
  const json = asExternalValue(JSON.parse(text) as ExternalValue);
  if (!isRecord(json)) {
    return [];
  }
  const names = new Set<string>();
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const blockPropertyArgs: ExternalPropertyArgs = {
      record: json,
      key: section,
    };
    const blockProperty = externalProperty(blockPropertyArgs);
    if (
      blockProperty.presence === ExternalPropertyPresence.Absent ||
      !isRecord(blockProperty.value)
    ) {
      continue;
    }
    for (const name of Object.keys(blockProperty.value)) {
      if (name.startsWith('@types/')) {
        continue;
      }
      names.add(name);
    }
  }
  return [...names].sort();
}

function readExternalWorkspaceCrates(platformRoot: string): readonly string[] {
  const cargo = Bun.which('cargo');
  if (typeof cargo !== 'string' || cargo.length === 0) {
    const loomFailureDetailArgs5: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailedToStart,
      text: 'cargo is required to scan Rust workspace dependencies',
    };
    loomFailureDetail(loomFailureDetailArgs5);
  }
  const resultArgs = {
    cmd: [cargo, 'metadata', '--format-version', '1'],
    cwd: platformRoot,
    stdout: 'pipe' as const,
    stderr: 'pipe' as const,
  };
  const result = Bun.spawnSync(resultArgs);
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    const loomFailureDetailArgs4: LoomFailureDetailArgs = {
      code: LoomFailureCode.CommandFailed,
      text: `cargo metadata failed while scanning crates: ${stderr}`,
    };
    loomFailureDetail(loomFailureDetailArgs4);
  }
  const metadata = asExternalValue(
    JSON.parse(new TextDecoder().decode(result.stdout)) as ExternalValue,
  );
  if (!isRecord(metadata)) {
    const loomFailureDetailArgs3: LoomFailureDetailArgs = {
      code: LoomFailureCode.ValidationFailed,
      text: 'cargo metadata returned an unexpected packages payload',
    };
    loomFailureDetail(loomFailureDetailArgs3);
  }
  const packagesPropertyArgs: ExternalPropertyArgs = {
    record: metadata,
    key: 'packages',
  };
  const packagesProperty = externalProperty(packagesPropertyArgs);
  if (
    packagesProperty.presence === ExternalPropertyPresence.Absent ||
    !Array.isArray(packagesProperty.value)
  ) {
    const loomFailureDetailArgs2: LoomFailureDetailArgs = {
      code: LoomFailureCode.ValidationFailed,
      text: 'cargo metadata returned an unexpected packages payload',
    };
    loomFailureDetail(loomFailureDetailArgs2);
  }
  const workspaceMembersPropertyArgs: ExternalPropertyArgs = {
    record: metadata,
    key: 'workspace_members',
  };
  const workspaceMembersProperty = externalProperty(
    workspaceMembersPropertyArgs,
  );
  if (
    workspaceMembersProperty.presence === ExternalPropertyPresence.Absent ||
    !Array.isArray(workspaceMembersProperty.value)
  ) {
    const loomFailureDetailArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.ValidationFailed,
      text: 'cargo metadata returned an unexpected workspace_members payload',
    };
    loomFailureDetail(loomFailureDetailArgs);
  }
  const workspaceMembers = new Set(
    workspaceMembersProperty.value.filter(
      (entry): entry is string => typeof entry === 'string',
    ),
  );
  const names = new Set<string>();
  for (const pkg of packagesProperty.value) {
    if (!isRecord(pkg)) {
      continue;
    }
    const idPropertyArgs: ExternalPropertyArgs = { record: pkg, key: 'id' };
    const idProperty = externalProperty(idPropertyArgs);
    if (
      idProperty.presence === ExternalPropertyPresence.Absent ||
      typeof idProperty.value !== 'string'
    ) {
      continue;
    }
    if (!workspaceMembers.has(idProperty.value)) {
      continue;
    }
    const dependenciesPropertyArgs: ExternalPropertyArgs = {
      record: pkg,
      key: 'dependencies',
    };
    const dependenciesProperty = externalProperty(dependenciesPropertyArgs);
    if (
      dependenciesProperty.presence === ExternalPropertyPresence.Absent ||
      !Array.isArray(dependenciesProperty.value)
    ) {
      continue;
    }
    for (const dep of dependenciesProperty.value) {
      if (!isRecord(dep)) {
        continue;
      }
      const namePropertyArgs: ExternalPropertyArgs = {
        record: dep,
        key: 'name',
      };
      const nameProperty = externalProperty(namePropertyArgs);
      if (
        nameProperty.presence === ExternalPropertyPresence.Absent ||
        typeof nameProperty.value !== 'string'
      ) {
        continue;
      }
      const pathPropertyArgs: ExternalPropertyArgs = {
        record: dep,
        key: 'path',
      };
      const pathProperty = externalProperty(pathPropertyArgs);
      if (
        pathProperty.presence === ExternalPropertyPresence.Present &&
        typeof pathProperty.value === 'string'
      ) {
        continue;
      }
      names.add(nameProperty.value);
    }
  }
  return [...names].sort();
}
