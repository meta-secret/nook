import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import {
  CompilerKind,
  RepositoryPolicyToolchain,
  ToolchainFailureKind,
  ToolchainMode,
} from '../src/commands/repository-policy-toolchain.ts';

test('streams static unxz output directly to the destination archive', async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'loom-unxz-'));
  const destinationPath = join(temporaryDirectory, 'zig.tar');
  const byteCount = 2 * 1024 * 1024;
  try {
    const toolchain = new RepositoryPolicyToolchain({
      mode: ToolchainMode.Compiler,
      compiler: CompilerKind.Ar,
      args: [],
    });
    const result = toolchain.extractStaticUnxz({
      executable: process.execPath,
      args: ['-e', `process.stdout.write(Buffer.alloc(${byteCount}, 65));`],
      destinationPath,
      label: 'test static unxz extraction',
    });

    expect(result.isOk()).toBe(true);
    expect(await readFile(destinationPath)).toEqual(
      Buffer.alloc(byteCount, 65),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('rejects static unxz output when the decoder exits non-zero', async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'loom-unxz-'));
  const destinationPath = join(temporaryDirectory, 'zig.tar');
  try {
    const toolchain = new RepositoryPolicyToolchain({
      mode: ToolchainMode.Compiler,
      compiler: CompilerKind.Ar,
      args: [],
    });
    const result = toolchain.extractStaticUnxz({
      executable: process.execPath,
      args: [
        '-e',
        'process.stdout.write(Buffer.from("partial")); process.exit(7);',
      ],
      destinationPath,
      label: 'test static unxz extraction',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe(ToolchainFailureKind.Command);
      expect(result.error.message).toContain('non-zero status');
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('translates Rust GNU targets for every rootless Zig compiler wrapper', () => {
  for (const compiler of [CompilerKind.C, CompilerKind.Cxx]) {
    const toolchain = new RepositoryPolicyToolchain({
      mode: ToolchainMode.Compiler,
      compiler,
      args: [],
    });
    const translated = toolchain.translateCompilerArguments({
      args: [
        '--target=x86_64-unknown-linux-gnu',
        '-target=x86_64-unknown-linux-gnu',
        '--target',
        'x86_64-unknown-linux-gnu',
        '-target',
        'x86_64-unknown-linux-gnu',
        '-C',
        'link-arg=-fuse-ld=lld',
      ],
    });

    expect(translated).toEqual([
      '--target=x86_64-linux-gnu',
      '-target=x86_64-linux-gnu',
      '--target',
      'x86_64-linux-gnu',
      '-target',
      'x86_64-linux-gnu',
      '-C',
      'link-arg=-fuse-ld=lld',
    ]);
  }
});

test('keeps non-target arguments and does not invent a target value', () => {
  const toolchain = new RepositoryPolicyToolchain({
    mode: ToolchainMode.Compiler,
    compiler: CompilerKind.Ar,
    args: [],
  });

  expect(
    toolchain.translateCompilerArguments({
      args: ['--target', '-r', 'archive.a', 'object.o'],
    }),
  ).toEqual(['--target', '-r', 'archive.a', 'object.o']);
});
