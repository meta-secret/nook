import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LoomFailureCode, loomFailureDetail } from '../../loom-failure.ts';
import { isRecord } from '../guards.ts';

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
  const json: unknown = JSON.parse(text);
  if (!isRecord(json)) {
    return [];
  }
  const names = new Set<string>();
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const block = json[section];
    if (!isRecord(block)) {
      continue;
    }
    for (const name of Object.keys(block)) {
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
  const metadata: unknown = JSON.parse(new TextDecoder().decode(result.stdout));
  if (!isRecord(metadata) || !Array.isArray(metadata.packages)) {
    loomFailureDetail({
      code: LoomFailureCode.ValidationFailed,
      text: 'cargo metadata returned an unexpected packages payload',
    });
  }
  if (!Array.isArray(metadata.workspace_members)) {
    loomFailureDetail({
      code: LoomFailureCode.ValidationFailed,
      text: 'cargo metadata returned an unexpected workspace_members payload',
    });
  }
  const workspaceMembers = new Set(
    metadata.workspace_members.filter(
      (entry): entry is string => typeof entry === 'string',
    ),
  );
  const names = new Set<string>();
  for (const pkg of metadata.packages) {
    if (!isRecord(pkg) || typeof pkg.id !== 'string') {
      continue;
    }
    if (!workspaceMembers.has(pkg.id)) {
      continue;
    }
    if (!Array.isArray(pkg.dependencies)) {
      continue;
    }
    for (const dep of pkg.dependencies) {
      if (!isRecord(dep) || typeof dep.name !== 'string') {
        continue;
      }
      if (typeof dep.path === 'string') {
        continue;
      }
      names.add(dep.name);
    }
  }
  return [...names].sort();
}
