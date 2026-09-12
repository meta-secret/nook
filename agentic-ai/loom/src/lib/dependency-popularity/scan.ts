import { err, ok, type Result } from 'neverthrow';
import type { ExecutableRepositoryFailure } from '../../executable-skills/repository.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ExecutableSkillCheckout } from '../../executable-skills/repository.ts';
import { LoomFailureCode } from '../../loom-failure.ts';
import {
  UntrustedYamlPropertyPresence,
  type UntrustedYamlNode,
  UntrustedYamlBoundary,
} from '../guards.ts';

import type { UntrustedYamlPropertyArgs } from '../guards.ts';
import type { LoomFailureDetailArgs } from '../../loom-failure.ts';
export type ManifestDependencies = {
  readonly npmPackages: readonly string[];
  readonly rustCrates: readonly string[];
};

/** Owns the repository dependency inventory registry and its capability transitions. */
export class RepositoryDependencyInventory {
  constructor(private readonly repoRoot: string) {}
  private static readonly REPOSITORY_NPM_MANIFESTS = [
    'agentic-ai/loom/package.json',
  ] as const;

  scanRepositoryManifests(): Result<ManifestDependencies, ManifestFailure> {
    const npmPackages = this.scanRepositoryNpmPackages();
    if (npmPackages.isErr()) return err(npmPackages.error);
    const rustCrates = this.readExternalWorkspaceCrates(
      path.join(this.repoRoot, 'nook-app/nook-platform'),
    );
    if (rustCrates.isErr()) return err(rustCrates.error);
    return ok({ npmPackages: npmPackages.value, rustCrates: rustCrates.value });
  }

  scanRepositoryNpmPackages(): Result<readonly string[], ManifestFailure> {
    const repoRoot = this.repoRoot;
    const names = new Set<string>();
    const inspection = new ExecutableSkillCheckout(
      repoRoot,
    ).inspectDependencies();
    if (inspection.isErr()) return err(inspection.error);
    if (inspection.value.findings.length > 0) {
      const failureArgs: LoomFailureDetailArgs = {
        code: LoomFailureCode.ValidationFailed,
        text: `Executable-skill package audit failed: ${JSON.stringify(inspection.value.findings)}`,
      };
      return err({ code: failureArgs.code, message: failureArgs.text });
    }
    for (const name of inspection.value.npmPackages) names.add(name);
    for (const manifestPath of RepositoryDependencyInventory.REPOSITORY_NPM_MANIFESTS) {
      const packages = this.readNpmPackages(path.join(repoRoot, manifestPath));
      if (packages.isErr()) return err(packages.error);
      for (const name of packages.value) names.add(name);
    }
    return ok([...names].sort());
  }

  private readNpmPackages(
    packageJsonPath: string,
  ): Result<readonly string[], ManifestFailure> {
    const document = new ManifestDocument(packageJsonPath).read();
    if (document.isErr()) return err(document.error);
    const json = document.value;
    if (!UntrustedYamlBoundary.isRecord(json)) {
      return ok([]);
    }
    const names = new Set<string>();
    for (const section of ['dependencies', 'devDependencies'] as const) {
      const blockPropertyArgs: UntrustedYamlPropertyArgs = {
        record: json,
        key: section,
      };
      const blockProperty = UntrustedYamlBoundary.property(blockPropertyArgs);
      if (
        blockProperty.presence === UntrustedYamlPropertyPresence.Absent ||
        !UntrustedYamlBoundary.isRecord(blockProperty.value)
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
    return ok([...names].sort());
  }

  private readExternalWorkspaceCrates(
    platformRoot: string,
  ): Result<readonly string[], ManifestFailure> {
    const cargo = Bun.which('cargo');
    if (typeof cargo !== 'string' || cargo.length === 0) {
      const loomFailureDetailArgs5: LoomFailureDetailArgs = {
        code: LoomFailureCode.CommandFailedToStart,
        text: 'cargo is required to scan Rust workspace dependencies',
      };
      return err({
        code: loomFailureDetailArgs5.code,
        message: loomFailureDetailArgs5.text,
      });
    }
    const resultArgs = {
      cmd: [cargo, 'metadata', '--format-version', '1'],
      cwd: platformRoot,
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    };
    let result: ReturnType<typeof Bun.spawnSync>;
    try {
      result = Bun.spawnSync(resultArgs);
    } catch {
      return err({
        code: LoomFailureCode.CommandFailedToStart,
        message: 'cargo metadata failed to start',
      });
    }
    if (result.exitCode !== 0) {
      const stderr = new TextDecoder().decode(result.stderr).trim();
      const loomFailureDetailArgs4: LoomFailureDetailArgs = {
        code: LoomFailureCode.CommandFailed,
        text: `cargo metadata failed while scanning crates: ${stderr}`,
      };
      return err({
        code: loomFailureDetailArgs4.code,
        message: loomFailureDetailArgs4.text,
      });
    }
    const decoded = new ManifestJson(
      new TextDecoder().decode(result.stdout),
    ).decode();
    if (decoded.isErr()) return err(decoded.error);
    const metadata = decoded.value;
    if (!UntrustedYamlBoundary.isRecord(metadata)) {
      const loomFailureDetailArgs3: LoomFailureDetailArgs = {
        code: LoomFailureCode.ValidationFailed,
        text: 'cargo metadata returned an unexpected packages payload',
      };
      return err({
        code: loomFailureDetailArgs3.code,
        message: loomFailureDetailArgs3.text,
      });
    }
    const packagesPropertyArgs: UntrustedYamlPropertyArgs = {
      record: metadata,
      key: 'packages',
    };
    const packagesProperty =
      UntrustedYamlBoundary.property(packagesPropertyArgs);
    if (
      packagesProperty.presence === UntrustedYamlPropertyPresence.Absent ||
      !Array.isArray(packagesProperty.value)
    ) {
      const loomFailureDetailArgs2: LoomFailureDetailArgs = {
        code: LoomFailureCode.ValidationFailed,
        text: 'cargo metadata returned an unexpected packages payload',
      };
      return err({
        code: loomFailureDetailArgs2.code,
        message: loomFailureDetailArgs2.text,
      });
    }
    const workspaceMembersPropertyArgs: UntrustedYamlPropertyArgs = {
      record: metadata,
      key: 'workspace_members',
    };
    const workspaceMembersProperty = UntrustedYamlBoundary.property(
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
      return err({
        code: loomFailureDetailArgs.code,
        message: loomFailureDetailArgs.text,
      });
    }
    const workspaceMembers = new Set(
      workspaceMembersProperty.value.filter(
        (entry): entry is string => typeof entry === 'string',
      ),
    );
    const names = new Set<string>();
    for (const pkg of packagesProperty.value) {
      if (!UntrustedYamlBoundary.isRecord(pkg)) {
        continue;
      }
      const idPropertyArgs: UntrustedYamlPropertyArgs = {
        record: pkg,
        key: 'id',
      };
      const idProperty = UntrustedYamlBoundary.property(idPropertyArgs);
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
      const dependenciesProperty = UntrustedYamlBoundary.property(
        dependenciesPropertyArgs,
      );
      if (
        dependenciesProperty.presence ===
          UntrustedYamlPropertyPresence.Absent ||
        !Array.isArray(dependenciesProperty.value)
      ) {
        continue;
      }
      for (const dep of dependenciesProperty.value) {
        if (!UntrustedYamlBoundary.isRecord(dep)) {
          continue;
        }
        const namePropertyArgs: UntrustedYamlPropertyArgs = {
          record: dep,
          key: 'name',
        };
        const nameProperty = UntrustedYamlBoundary.property(namePropertyArgs);
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
        const pathProperty = UntrustedYamlBoundary.property(pathPropertyArgs);
        if (
          pathProperty.presence === UntrustedYamlPropertyPresence.Present &&
          typeof pathProperty.value === 'string'
        ) {
          continue;
        }
        names.add(nameProperty.value);
      }
    }
    return ok([...names].sort());
  }
}

export type ManifestFailure =
  | ExecutableRepositoryFailure
  | {
      readonly code: LoomFailureCode;
      readonly message: string;
    };
class ManifestDocument {
  constructor(private readonly filePath: string) {}
  read(): Result<UntrustedYamlNode, ManifestFailure> {
    let text: string;
    try {
      text = readFileSync(this.filePath, 'utf8');
    } catch {
      return err({
        code: LoomFailureCode.FileReadFailed,
        message: `Cannot read dependency manifest: ${this.filePath}`,
      });
    }
    return new ManifestJson(text).decode();
  }
}
class ManifestJson {
  constructor(private readonly text: string) {}
  decode(): Result<UntrustedYamlNode, ManifestFailure> {
    try {
      return ok(
        UntrustedYamlBoundary.fromHost(
          JSON.parse(this.text) as UntrustedYamlNode,
        ),
      );
    } catch {
      return err({
        code: LoomFailureCode.ValidationFailed,
        message: 'Dependency manifest JSON is invalid',
      });
    }
  }
}
