import { execFileSync } from 'node:child_process';
import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';
import { lintChangedCortexDensity } from '../src/lib/changed-cortex-density.ts';

const REMOVE_OPTIONS = { force: true, recursive: true } as const;

test('limits enforcement to affected prose in changed Cortex Markdown', () => {
  const fixtureArgs: CreateFixtureArgs = {
    prefix: 'changed-cortex-density-',
    files: [
      {
        relativePath: '.cortex/legacy.md',
        content:
          'Legacy prose has one rule and another rule and another rule and another rule and another rule and another rule and remains dense enough to fail the writer policy when inspected.\n',
      },
    ],
  };
  const fixture = createFixture(fixtureArgs);
  try {
    writeFileSync(
      path.join(fixture.repoRoot, '.cortex/legacy.md'),
      [
        'Legacy prose has one rule and another rule and another rule and another rule and another rule and another rule and remains dense enough to fail the writer policy when inspected.',
        '',
        '- Recheck the current change.',
      ].join('\n'),
    );
    writeFileSync(
      path.join(fixture.repoRoot, '.cortex/changed.md'),
      [
        '- Require the successor branch and the open pull request and the recorded',
        '  predecessor and the frozen base SHA and the containment proof before claim.',
      ].join('\n'),
    );
    const reportArgs: LintFixtureArgs = {
      baseSha: fixture.baseSha,
      repoRoot: fixture.repoRoot,
    };
    const report = lintFixture(reportArgs);
    expect(report.checkedPaths).toEqual([
      '.cortex/changed.md',
      '.cortex/legacy.md',
    ]);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(
      report.findings.every((finding) => finding.file === '.cortex/changed.md'),
    ).toBe(true);
  } finally {
    rmSync(fixture.repoRoot, REMOVE_OPTIONS);
  }
});

test('checks a paragraph merged by a deletion-only hunk', () => {
  const fixtureArgs: CreateFixtureArgs = {
    prefix: 'deleted-cortex-separator-',
    files: [
      {
        relativePath: '.cortex/merged.md',
        content: [
          'The workflow checks the successor branch and the open pull request and the frozen base SHA',
          '',
          'and the predecessor metadata and the containment proof and the delivery state before claim.',
        ].join('\n'),
      },
    ],
  };
  const fixture = createFixture(fixtureArgs);
  try {
    writeFileSync(
      path.join(fixture.repoRoot, '.cortex/merged.md'),
      [
        'The workflow checks the successor branch and the open pull request and the frozen base SHA',
        'and the predecessor metadata and the containment proof and the delivery state before claim.',
      ].join('\n'),
    );
    const reportArgs: LintFixtureArgs = {
      baseSha: fixture.baseSha,
      repoRoot: fixture.repoRoot,
    };
    const report = lintFixture(reportArgs);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings[0]?.file).toBe('.cortex/merged.md');
  } finally {
    rmSync(fixture.repoRoot, REMOVE_OPTIONS);
  }
});

test('preserves rename ancestry and checks edits made during a rename', () => {
  const fixtureArgs: CreateFixtureArgs = {
    prefix: 'renamed-cortex-density-',
    files: [
      {
        relativePath: '.cortex/legacy.md',
        content:
          'Legacy prose has one rule and another rule and another rule and another rule and another rule and another rule and remains dense enough to fail the writer policy when inspected.\n',
      },
    ],
  };
  const fixture = createFixture(fixtureArgs);
  try {
    const moveArgs: GitArgs = {
      arguments: ['mv', '.cortex/legacy.md', '.cortex/renamed.md'],
      repoRoot: fixture.repoRoot,
    };
    git(moveArgs);
    const reportArgs: LintFixtureArgs = {
      baseSha: fixture.baseSha,
      repoRoot: fixture.repoRoot,
    };
    const pureRename = lintFixture(reportArgs);
    expect(pureRename.checkedPaths).toEqual(['.cortex/renamed.md']);
    expect(pureRename.findings).toEqual([]);

    writeFileSync(
      path.join(fixture.repoRoot, '.cortex/renamed.md'),
      [
        'Legacy prose has one rule and another rule and another rule and another rule and another rule and another rule and remains dense enough to fail the writer policy when inspected.',
        '',
        '- Require the successor branch and the open pull request and the predecessor metadata and the frozen base SHA and the containment proof before claim.',
      ].join('\n'),
    );
    const editedRename = lintFixture(reportArgs);
    expect(editedRename.findings.length).toBeGreaterThan(0);
    expect(editedRename.findings.every((finding) => finding.line === 3)).toBe(
      true,
    );
  } finally {
    rmSync(fixture.repoRoot, REMOVE_OPTIONS);
  }
});

test('checks full destinations promoted from nonpersistent sources', () => {
  const fixtureArgs: CreateFixtureArgs = {
    prefix: 'promoted-cortex-density-',
    files: [
      {
        relativePath: 'external.md',
        content:
          'External prose has one rule and another rule and another rule and another rule and another rule and another rule and remains dense enough to require review after promotion.\n',
      },
      {
        relativePath: '.cortex/.session/draft.md',
        content:
          'Session prose has one command and another command and another command and another command and another command and another command and remains dense after promotion.\n',
      },
    ],
  };
  const fixture = createFixture(fixtureArgs);
  try {
    const externalMoveArgs: GitArgs = {
      arguments: ['mv', 'external.md', '.cortex/external.md'],
      repoRoot: fixture.repoRoot,
    };
    git(externalMoveArgs);
    const sessionMoveArgs: GitArgs = {
      arguments: [
        'mv',
        '.cortex/.session/draft.md',
        '.cortex/session-promoted.md',
      ],
      repoRoot: fixture.repoRoot,
    };
    git(sessionMoveArgs);
    const reportArgs: LintFixtureArgs = {
      baseSha: fixture.baseSha,
      repoRoot: fixture.repoRoot,
    };
    const report = lintFixture(reportArgs);
    expect(report.checkedPaths).toEqual([
      '.cortex/external.md',
      '.cortex/session-promoted.md',
    ]);
    expect(report.findings.map((finding) => finding.file).sort()).toEqual([
      '.cortex/external.md',
      '.cortex/session-promoted.md',
    ]);
  } finally {
    rmSync(fixture.repoRoot, REMOVE_OPTIONS);
  }
});

test('checks a full regular file promoted from a symlink type change', () => {
  const repoRoot = mkdtempSync(
    path.join(tmpdir(), 'type-changed-cortex-density-'),
  );
  try {
    const cortexRoot = path.join(repoRoot, '.cortex');
    const directoryOptions = { recursive: true } as const;
    mkdirSync(cortexRoot, directoryOptions);
    writeFileSync(
      path.join(repoRoot, 'source.md'),
      '- The external source remains outside persistent Cortex.\n',
    );
    const destinationPath = path.join(cortexRoot, 'promoted.md');
    symlinkSync('../source.md', destinationPath);
    const initArgs: GitArgs = { arguments: ['init', '-q'], repoRoot };
    git(initArgs);
    const baselineArgs: CommitAllArgs = {
      message: 'symlink baseline',
      repoRoot,
    };
    const baseSha = commitAll(baselineArgs);

    unlinkSync(destinationPath);
    writeFileSync(
      destinationPath,
      'The promoted policy has one rule and another rule and another rule and another rule and another rule and another rule and now requires full density review.\n',
    );
    const reportArgs: LintFixtureArgs = { baseSha, repoRoot };
    const report = lintFixture(reportArgs);
    expect(report.checkedPaths).toEqual(['.cortex/promoted.md']);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(
      report.findings.every(
        (finding) => finding.file === '.cortex/promoted.md',
      ),
    ).toBe(true);
  } finally {
    rmSync(repoRoot, REMOVE_OPTIONS);
  }
});

test('compares a stale feature branch from its merge base with main', () => {
  const fixtureArgs: CreateFixtureArgs = {
    prefix: 'diverged-cortex-density-',
    files: [
      {
        relativePath: '.cortex/shared.md',
        content:
          'Legacy prose has one rule and another rule and another rule and another rule and another rule and another rule and remains dense enough to fail the writer policy when inspected.\n',
      },
    ],
  };
  const fixture = createFixture(fixtureArgs);
  try {
    const featureBranchArgs: GitArgs = {
      arguments: ['checkout', '-qb', 'feature', fixture.baseSha],
      repoRoot: fixture.repoRoot,
    };
    git(featureBranchArgs);
    writeFileSync(
      path.join(fixture.repoRoot, '.cortex/feature.md'),
      '- Require the successor branch and the open pull request and the predecessor metadata and the frozen base SHA and the containment proof before claim.\n',
    );
    const featureCommitArgs: CommitAllArgs = {
      message: 'feature change',
      repoRoot: fixture.repoRoot,
    };
    commitAll(featureCommitArgs);

    const upstreamBranchArgs: GitArgs = {
      arguments: ['checkout', '-qb', 'upstream', fixture.baseSha],
      repoRoot: fixture.repoRoot,
    };
    git(upstreamBranchArgs);
    writeFileSync(
      path.join(fixture.repoRoot, '.cortex/shared.md'),
      '- Keep the upstream policy concise.\n',
    );
    const upstreamCommitArgs: CommitAllArgs = {
      message: 'upstream change',
      repoRoot: fixture.repoRoot,
    };
    const upstreamSha = commitAll(upstreamCommitArgs);
    const checkoutFeatureArgs: GitArgs = {
      arguments: ['checkout', '-q', 'feature'],
      repoRoot: fixture.repoRoot,
    };
    git(checkoutFeatureArgs);

    const reportArgs: LintFixtureArgs = {
      baseSha: upstreamSha,
      repoRoot: fixture.repoRoot,
    };
    const report = lintFixture(reportArgs);
    expect(report.checkedPaths).toEqual(['.cortex/feature.md']);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(
      report.findings.every((finding) => finding.file === '.cortex/feature.md'),
    ).toBe(true);
  } finally {
    rmSync(fixture.repoRoot, REMOVE_OPTIONS);
  }
});

type FixtureFile = {
  readonly content: string;
  readonly relativePath: string;
};

type CreateFixtureArgs = {
  readonly files: readonly FixtureFile[];
  readonly prefix: string;
};

type Fixture = {
  readonly baseSha: string;
  readonly repoRoot: string;
};

function createFixture(args: CreateFixtureArgs): Fixture {
  const repoRoot = mkdtempSync(path.join(tmpdir(), args.prefix));
  const directoryOptions = { recursive: true } as const;
  mkdirSync(path.join(repoRoot, '.cortex'), directoryOptions);
  for (const file of args.files) {
    const filePath = path.join(repoRoot, file.relativePath);
    mkdirSync(path.dirname(filePath), directoryOptions);
    writeFileSync(filePath, file.content);
  }
  const initArgs: GitArgs = { arguments: ['init', '-q'], repoRoot };
  git(initArgs);
  const commitArgs: CommitAllArgs = {
    message: 'fixture baseline',
    repoRoot,
  };
  const baseSha = commitAll(commitArgs);
  return { baseSha, repoRoot };
}

type CommitAllArgs = {
  readonly message: string;
  readonly repoRoot: string;
};

function commitAll(args: CommitAllArgs): string {
  const addArgs: GitArgs = {
    arguments: ['add', '--', '.'],
    repoRoot: args.repoRoot,
  };
  git(addArgs);
  const commitArgs: GitArgs = {
    repoRoot: args.repoRoot,
    arguments: [
      '-c',
      'user.name=Nook',
      '-c',
      'user.email=nook@example.invalid',
      'commit',
      '-qm',
      args.message,
    ],
  };
  git(commitArgs);
  const revisionArgs: GitArgs = {
    arguments: ['rev-parse', 'HEAD'],
    repoRoot: args.repoRoot,
  };
  return git(revisionArgs).trim();
}

type LintFixtureArgs = {
  readonly baseSha: string;
  readonly repoRoot: string;
};

function lintFixture(args: LintFixtureArgs) {
  return lintChangedCortexDensity(args);
}

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
