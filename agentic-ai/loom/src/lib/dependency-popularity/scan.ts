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
    const blockProperty = externalProperty({ record: json, key: section });
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
    loomFailureDetail({
      code: LoomFailureCode.CommandFailedToStart,
      text: 'cargo is required to scan Rust workspace dependencies',
    });
  }
  const result = Bun.spawnSync({
    cmd: [cargo, 'metadata', '--format-version', '1'],
    cwd: platformRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    loomFailureDetail({
      code: LoomFailureCode.CommandFailed,
      text: `cargo metadata failed while scanning crates: ${stderr}`,
    });
  }
  const metadata = asExternalValue(
    JSON.parse(new TextDecoder().decode(result.stdout)) as ExternalValue,
  );
  if (!isRecord(metadata)) {
    loomFailureDetail({
      code: LoomFailureCode.ValidationFailed,
      text: 'cargo metadata returned an unexpected packages payload',
    });
  }
  const packagesProperty = externalProperty({
    record: metadata,
    key: 'packages',
  });
  if (
    packagesProperty.presence === ExternalPropertyPresence.Absent ||
    !Array.isArray(packagesProperty.value)
  ) {
    loomFailureDetail({
      code: LoomFailureCode.ValidationFailed,
      text: 'cargo metadata returned an unexpected packages payload',
    });
  }
  const workspaceMembersProperty = externalProperty({
    record: metadata,
    key: 'workspace_members',
  });
  if (
    workspaceMembersProperty.presence === ExternalPropertyPresence.Absent ||
    !Array.isArray(workspaceMembersProperty.value)
  ) {
    loomFailureDetail({
      code: LoomFailureCode.ValidationFailed,
      text: 'cargo metadata returned an unexpected workspace_members payload',
    });
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
    const idProperty = externalProperty({ record: pkg, key: 'id' });
    if (
      idProperty.presence === ExternalPropertyPresence.Absent ||
      typeof idProperty.value !== 'string'
    ) {
      continue;
    }
    if (!workspaceMembers.has(idProperty.value)) {
      continue;
    }
    const dependenciesProperty = externalProperty({
      record: pkg,
      key: 'dependencies',
    });
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
      const nameProperty = externalProperty({ record: dep, key: 'name' });
      if (
        nameProperty.presence === ExternalPropertyPresence.Absent ||
        typeof nameProperty.value !== 'string'
      ) {
        continue;
      }
      const pathProperty = externalProperty({ record: dep, key: 'path' });
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
