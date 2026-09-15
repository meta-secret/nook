import { expect, test } from 'bun:test';
import {
  CompilerKind,
  RepositoryPolicyToolchain,
  ToolchainMode,
} from '../src/commands/repository-policy-toolchain.ts';

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
