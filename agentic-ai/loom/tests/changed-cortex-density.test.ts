import { execFileSync } from 'node:child_process';
import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';
import { lintChangedCortexDensity } from '../src/lib/changed-cortex-density.ts';

const REMOVE_OPTIONS = { force: true, recursive: true } as const;

test('limits pre-push density enforcement to changed Cortex Markdown', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'changed-cortex-density-'));
  try {
    const cortexRoot = path.join(repoRoot, '.cortex');
    const directoryOptions = { recursive: true } as const;
    mkdirSync(cortexRoot, directoryOptions);
    writeFileSync(
      path.join(cortexRoot, 'legacy.md'),
      'Legacy prose has one rule and another rule and another rule and another rule and another rule and another rule and remains dense enough to fail the writer policy when inspected.\n',
    );
    const initArgs: GitArgs = { arguments: ['init', '-q'], repoRoot };
    git(initArgs);
    const addArgs: GitArgs = {
      arguments: ['add', '--', '.cortex/legacy.md'],
      repoRoot,
    };
    git(addArgs);
    const commitArgs: GitArgs = {
      repoRoot,
      arguments: [
        '-c',
        'user.name=Nook',
        '-c',
        'user.email=nook@example.invalid',
        'commit',
        '-qm',
        'fixture baseline',
      ],
    };
    git(commitArgs);
    const revisionArgs: GitArgs = {
      arguments: ['rev-parse', 'HEAD'],
      repoRoot,
    };
    const baseSha = git(revisionArgs).trim();

    writeFileSync(
      path.join(cortexRoot, 'legacy.md'),
      [
        'Legacy prose has one rule and another rule and another rule and another rule and another rule and another rule and remains dense enough to fail the writer policy when inspected.',
        '',
        '- Recheck the current change.',
      ].join('\n'),
    );

    writeFileSync(
      path.join(cortexRoot, 'changed.md'),
      [
        '- Require the successor branch and the open pull request and the recorded',
        '  predecessor and the frozen base SHA and the containment proof before claim.',
      ].join('\n'),
    );
    const lintArgs = { baseSha, repoRoot };
    const report = lintChangedCortexDensity(lintArgs);
    expect(report.checkedPaths).toEqual([
      '.cortex/changed.md',
      '.cortex/legacy.md',
    ]);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(
      report.findings.every((finding) => finding.file === '.cortex/changed.md'),
    ).toBe(true);
  } finally {
    rmSync(repoRoot, REMOVE_OPTIONS);
  }
});

type GitArgs = {
  readonly arguments: readonly string[];
  readonly repoRoot: string;
};

function git(args: GitArgs): string {
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: args.repoRoot,
    encoding: 'utf8',
  };
  return execFileSync('git', [...args.arguments], options);
}
