import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inspectExecutableSkillDependencies } from '../../executable-skills/repository.ts';
import { LoomFailureCode, loomFailureDetail } from '../../loom-failure.ts';
import {
  UntrustedYamlPropertyPresence,
  asUntrustedYamlNode,
  untrustedYamlProperty,
  type UntrustedYamlNode,
  isRecord,
} from '../guards.ts';

import type { UntrustedYamlPropertyArgs } from '../guards.ts';
import type { LoomFailureDetailArgs } from '../../loom-failure.ts';
export type ManifestDependencies = {
  readonly npmPackages: readonly string[];
  readonly rustCrates: readonly string[];
};

const REPOSITORY_NPM_MANIFESTS = ['agentic-ai/loom/package.json'] as const;

export function scanRepositoryManifests(
  repoRoot: string,
): ManifestDependencies {
  return {
    npmPackages: scanRepositoryNpmPackages(repoRoot),
    rustCrates: readExternalWorkspaceCrates(
      path.join(repoRoot, 'nook-app/nook-platform'),
    ),
  };
}

export function scanRepositoryNpmPackages(repoRoot: string): readonly string[] {
  const names = new Set<string>();
  const inspection = inspectExecutableSkillDependencies(repoRoot);
  if (inspection.findings.length > 0) {
    const failureArgs: LoomFailureDetailArgs = {
      code: LoomFailureCode.ValidationFailed,
      text: `Executable-skill package audit failed: ${JSON.stringify(inspection.findings)}`,
    };
    loomFailureDetail(failureArgs);
  }
  for (const name of inspection.npmPackages) names.add(name);
  for (const manifestPath of REPOSITORY_NPM_MANIFESTS) {
    for (const name of readNpmPackages(path.join(repoRoot, manifestPath))) {
      names.add(name);
    }
  }
  return [...names].sort();
}

function readNpmPackages(packageJsonPath: string): readonly string[] {
  const text = readFileSync(packageJsonPath, 'utf8');
  const json = asUntrustedYamlNode(JSON.parse(text) as UntrustedYamlNode);
  if (!isRecord(json)) {
    return [];
  }
  const names = new Set<string>();
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const blockPropertyArgs: UntrustedYamlPropertyArgs = {
      record: json,
      key: section,
    };
    const blockProperty = untrustedYamlProperty(blockPropertyArgs);
    if (
      blockProperty.presence === UntrustedYamlPropertyPresence.Absent ||
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
  const metadata = asUntrustedYamlNode(
    JSON.parse(new TextDecoder().decode(result.stdout)) as UntrustedYamlNode,
  );
  if (!isRecord(metadata)) {
    const loomFailureDetailArgs3: LoomFailureDetailArgs = {
      code: LoomFailureCode.ValidationFailed,
      text: 'cargo metadata returned an unexpected packages payload',
    };
    loomFailureDetail(loomFailureDetailArgs3);
  }
  const packagesPropertyArgs: UntrustedYamlPropertyArgs = {
    record: metadata,
    key: 'packages',
  };
  const packagesProperty = untrustedYamlProperty(packagesPropertyArgs);
  if (
    packagesProperty.presence === UntrustedYamlPropertyPresence.Absent ||
    !Array.isArray(packagesProperty.value)
  ) {
    const loomFailureDetailArgs2: LoomFailureDetailArgs = {
      code: LoomFailureCode.ValidationFailed,
      text: 'cargo metadata returned an unexpected packages payload',
    };
    loomFailureDetail(loomFailureDetailArgs2);
  }
  const workspaceMembersPropertyArgs: UntrustedYamlPropertyArgs = {
    record: metadata,
    key: 'workspace_members',
  };
  const workspaceMembersProperty = untrustedYamlProperty(
    workspaceMembersPropertyArgs,
  );
  if (
    workspaceMembersProperty.presence ===
      UntrustedYamlPropertyPresence.Absent ||
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
    const idPropertyArgs: UntrustedYamlPropertyArgs = {
      record: pkg,
      key: 'id',
    };
    const idProperty = untrustedYamlProperty(idPropertyArgs);
    if (
      idProperty.presence === UntrustedYamlPropertyPresence.Absent ||
      typeof idProperty.value !== 'string'
    ) {
      continue;
    }
    if (!workspaceMembers.has(idProperty.value)) {
      continue;
    }
    const dependenciesPropertyArgs: UntrustedYamlPropertyArgs = {
      record: pkg,
      key: 'dependencies',
    };
    const dependenciesProperty = untrustedYamlProperty(
      dependenciesPropertyArgs,
    );
    if (
      dependenciesProperty.presence === UntrustedYamlPropertyPresence.Absent ||
      !Array.isArray(dependenciesProperty.value)
    ) {
      continue;
    }
    for (const dep of dependenciesProperty.value) {
      if (!isRecord(dep)) {
        continue;
      }
      const namePropertyArgs: UntrustedYamlPropertyArgs = {
        record: dep,
        key: 'name',
      };
      const nameProperty = untrustedYamlProperty(namePropertyArgs);
      if (
        nameProperty.presence === UntrustedYamlPropertyPresence.Absent ||
        typeof nameProperty.value !== 'string'
      ) {
        continue;
      }
      const pathPropertyArgs: UntrustedYamlPropertyArgs = {
        record: dep,
        key: 'path',
      };
      const pathProperty = untrustedYamlProperty(pathPropertyArgs);
      if (
        pathProperty.presence === UntrustedYamlPropertyPresence.Present &&
        typeof pathProperty.value === 'string'
      ) {
        continue;
      }
      names.add(nameProperty.value);
    }
  }
  return [...names].sort();
}
