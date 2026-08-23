import { dirname, isAbsolute, relative, resolve } from 'node:path';

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
  readonly packages?: readonly CargoMetadataPackage[];
  readonly workspace_members?: readonly string[];
};

type CargoMetadataPackage = {
  readonly id?: string;
  readonly manifest_path?: string;
};

export type DecodeCargoWorkspaceMetadataArgs = {
  readonly repoRoot: string;
  readonly source: string;
};

export function discoverCargoWorkspace(
  args: DiscoverCargoWorkspaceArgs,
): CargoWorkspaceInventory {
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
  return decodeCargoWorkspaceMetadata(decodeArgs);
}

export function decodeCargoWorkspaceMetadata(
  args: DecodeCargoWorkspaceMetadataArgs,
): CargoWorkspaceInventory {
  let metadata: CargoMetadata;
  try {
    metadata = JSON.parse(args.source) as CargoMetadata;
  } catch {
    return {
      kind: CargoWorkspaceInventoryKind.Failed,
      code: 'invalid-cargo-metadata',
      message: 'Cargo returned malformed workspace metadata.',
    };
  }
  if (
    !Array.isArray(metadata.packages) ||
    !Array.isArray(metadata.workspace_members) ||
    !metadata.workspace_members.every((member) => typeof member === 'string')
  ) {
    return {
      kind: CargoWorkspaceInventoryKind.Failed,
      code: 'invalid-cargo-metadata',
      message: 'Cargo returned incomplete workspace metadata.',
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
