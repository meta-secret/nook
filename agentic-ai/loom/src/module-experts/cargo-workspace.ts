import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { UntrustedYamlBoundary } from '../lib/guards.ts';

export class CargoWorkspaceDiscovery {
  private constructor(private readonly request: DiscoverCargoWorkspaceArgs) {}
  static discover(args: DiscoverCargoWorkspaceArgs): CargoWorkspaceInventory {
    return new CargoWorkspaceDiscovery(args).execute();
  }
  private execute(): CargoWorkspaceInventory {
    const args = this.request;
    const cargo = Bun.which('cargo');
    if (!cargo) {
      return {
        kind: CargoWorkspaceInventoryKind.Failed,
        code: 'cargo-metadata-unavailable',
        message: 'Cargo is required to resolve production Rust modules.',
      };
    }
    const spawnArgs = {
      cmd: [
        cargo,
        'metadata',
        '--format-version',
        '1',
        '--no-deps',
        '--locked',
        '--offline',
        '--manifest-path',
        resolve(args.repoRoot, args.manifestPath),
      ],
      cwd: args.repoRoot,
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    };
    const result = Bun.spawnSync(spawnArgs);
    if (result.exitCode !== 0) {
      return {
        kind: CargoWorkspaceInventoryKind.Failed,
        code: 'cargo-metadata-failed',
        message: 'Cargo could not resolve the locked offline Rust workspace.',
      };
    }
    const decodeArgs: DecodeCargoWorkspaceMetadataArgs = {
      repoRoot: args.repoRoot,
      source: new TextDecoder().decode(result.stdout),
    };
    return CargoWorkspaceMetadata.decode(decodeArgs);
  }
}

export class CargoWorkspaceMetadata {
  private constructor(
    private readonly request: DecodeCargoWorkspaceMetadataArgs,
  ) {}
  static decode(
    args: DecodeCargoWorkspaceMetadataArgs,
  ): CargoWorkspaceInventory {
    return new CargoWorkspaceMetadata(args).execute();
  }
  private static parse(source: string): CargoMetadata {
    const node = UntrustedYamlBoundary.fromJson(JSON.parse(source));
    if (!UntrustedYamlBoundary.isRecord(node))
      throw new Error('Invalid Cargo metadata.');
    const packagesNode = node.packages;
    const workspaceMembersNode = node.workspace_members;
    if (
      !packagesNode ||
      !workspaceMembersNode ||
      !UntrustedYamlBoundary.isList(packagesNode) ||
      !UntrustedYamlBoundary.isList(workspaceMembersNode)
    )
      throw new Error('Invalid Cargo metadata.');
    const packages: CargoMetadataPackage[] = [];
    for (const candidate of packagesNode) {
      if (
        !UntrustedYamlBoundary.isRecord(candidate) ||
        typeof candidate.id !== 'string' ||
        typeof candidate.manifest_path !== 'string'
      )
        throw new Error('Invalid Cargo package.');
      packages.push({
        id: candidate.id,
        manifest_path: candidate.manifest_path,
      });
    }
    const workspace_members: string[] = [];
    for (const member of workspaceMembersNode) {
      if (typeof member !== 'string')
        throw new Error('Invalid Cargo workspace member.');
      workspace_members.push(member);
    }
    return { packages, workspace_members };
  }
  private execute(): CargoWorkspaceInventory {
    const args = this.request;
    let metadata: CargoMetadata;
    try {
      metadata = CargoWorkspaceMetadata.parse(args.source);
    } catch {
      return {
        kind: CargoWorkspaceInventoryKind.Failed,
        code: 'invalid-cargo-metadata',
        message: 'Cargo returned malformed workspace metadata.',
      };
    }
    const packagesById = new Map<string, CargoMetadataPackage>();
    for (const cargoPackage of metadata.packages) {
      if (
        typeof cargoPackage.id === 'string' &&
        typeof cargoPackage.manifest_path === 'string'
      ) {
        packagesById.set(cargoPackage.id, cargoPackage);
      }
    }
    const platformRoot = resolve(args.repoRoot, 'nook-app/nook-platform');
    const roots = new Set<string>();
    for (const member of metadata.workspace_members) {
      const cargoPackage = packagesById.get(member);
      if (!cargoPackage?.manifest_path) {
        return {
          kind: CargoWorkspaceInventoryKind.Failed,
          code: 'invalid-cargo-metadata',
          message: 'Cargo omitted a workspace package manifest.',
        };
      }
      const packageRoot = dirname(cargoPackage.manifest_path);
      const platformRelative = relative(platformRoot, packageRoot);
      const repoRelative = relative(args.repoRoot, packageRoot);
      if (
        platformRelative.length === 0 ||
        platformRelative.startsWith('..') ||
        isAbsolute(platformRelative) ||
        repoRelative.startsWith('..') ||
        isAbsolute(repoRelative)
      ) {
        return {
          kind: CargoWorkspaceInventoryKind.Failed,
          code: 'escaping-cargo-workspace-member',
          message: 'A Cargo workspace member escapes the platform module root.',
        };
      }
      roots.add(repoRelative);
    }
    return {
      kind: CargoWorkspaceInventoryKind.Complete,
      roots: [...roots].sort(),
    };
  }
}

export enum CargoWorkspaceInventoryKind {
  Complete = 'complete',
  Failed = 'failed',
}

export type CargoWorkspaceInventory =
  | {
      readonly kind: CargoWorkspaceInventoryKind.Complete;
      readonly roots: readonly string[];
    }
  | {
      readonly kind: CargoWorkspaceInventoryKind.Failed;
      readonly code: string;
      readonly message: string;
    };

export type DiscoverCargoWorkspaceArgs = {
  readonly repoRoot: string;
  readonly manifestPath: string;
};

type CargoMetadata = {
  readonly packages: readonly CargoMetadataPackage[];
  readonly workspace_members: readonly string[];
};

type CargoMetadataPackage = {
  readonly id: string;
  readonly manifest_path: string;
};

export type DecodeCargoWorkspaceMetadataArgs = {
  readonly repoRoot: string;
  readonly source: string;
};
