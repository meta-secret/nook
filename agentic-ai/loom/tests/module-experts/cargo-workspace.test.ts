import { join, resolve } from 'node:path';
import { expect, test } from 'bun:test';

import {
  CargoWorkspaceInventoryKind,
  type CargoWorkspaceInventory,
  type DecodeCargoWorkspaceMetadataArgs,
  CargoWorkspaceMetadata,
} from '../../src/module-experts/cargo-workspace.ts';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');

test('uses Cargo workspace identities instead of manifest text matches', () => {
  const liveManifest = join(
    REPO_ROOT,
    'nook-app/nook-platform/live-crate/Cargo.toml',
  );
  const decoyManifest = join(
    REPO_ROOT,
    'nook-app/nook-platform/retired-crate/Cargo.toml',
  );
  const metadata = {
    packages: [
      { id: 'live 1.0.0', manifest_path: liveManifest },
      { id: 'retired 1.0.0', manifest_path: decoyManifest },
    ],
    workspace_members: ['live 1.0.0'],
  };
  const decodeArgs: DecodeCargoWorkspaceMetadataArgs = {
    repoRoot: REPO_ROOT,
    source: JSON.stringify(metadata),
  };

  const expected: CargoWorkspaceInventory = {
    kind: CargoWorkspaceInventoryKind.Complete,
    roots: ['nook-app/nook-platform/live-crate'],
  };
  expect(CargoWorkspaceMetadata.decode(decodeArgs)).toEqual(expected);
});
