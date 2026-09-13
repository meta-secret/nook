import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  AuthoredChangeSummary,
  SourceText,
  AuthoredAdditionBudget,
  AuthoredBudgetMode,
  AuthoredBudgetFailureKind,
  AuthoredBudgetWorkspace,
} from '../src/commands/pr-authored-budget.ts';

class AuthoredBudgetRepositoryFixture {
  private constructor(readonly root: string) {}

  static create(): AuthoredBudgetRepositoryFixture {
    return new AuthoredBudgetRepositoryFixture(
      mkdtempSync(join(tmpdir(), 'nook-budget-pinned-base-')),
    );
  }

  git(...args: string[]): string {
    return execFileSync('git', ['-C', this.root, ...args], {
      encoding: 'utf8',
    }).trim();
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

void test('keeps delivery at or below 2,000 authored additions', () => {
  const admitted = new AuthoredAdditionBudget(2_000).evaluate();
  assert(admitted.isOk());
  assert.equal(admitted.value.mode, AuthoredBudgetMode.NearLimit);
  if (admitted.value.mode === AuthoredBudgetMode.NearLimit)
    assert.match(
      admitted.value.message,
      /warning: authored additions are near the 2,000-line limit/,
    );
});
void test('warns when authored additions reach 1,500', () => {
  const near = new AuthoredAdditionBudget(1_500).evaluate();
  assert(near.isOk());
  assert.equal(near.value.mode, AuthoredBudgetMode.NearLimit);
  const below = new AuthoredAdditionBudget(1_499).evaluate();
  assert(below.isOk());
  assert.equal(below.value.mode, AuthoredBudgetMode.AdditionsOnly);
});
void test('blocks above 2,000 authored additions', () => {
  const denied = new AuthoredAdditionBudget(2_001).evaluate();
  assert(denied.isErr());
  assert.equal(denied.error.kind, AuthoredBudgetFailureKind.Limit);
});

void test('counts only authored additions and reports excluded rows separately', () => {
  const summary = AuthoredChangeSummary.fromNumstat({
    numstat:
      '12\t300\tsrc/domain.ts\0' +
      '4\t5\tgenerated/schema.ts\0' +
      '2\t1\tbun.lock\0',
  });
  assert.equal(summary.authoredLines, 12);
  assert.equal(summary.generatedLines, 9);
  assert.equal(summary.lockfileLines, 3);
});

void test('does not count deletion-only authored rows', () => {
  const summary = AuthoredChangeSummary.fromNumstat({
    numstat: '0\t5000\tsrc/obsolete.ts\0',
  });
  assert.equal(summary.authoredLines, 0);
});

void test('does not require line counts for a deleted binary source file', () => {
  const summary = AuthoredChangeSummary.fromNumstat({
    numstat: '-\t-\tsrc/obsolete.ts\0',
    deletedPaths: new Set(['src/obsolete.ts']),
  });
  assert.equal(summary.authoredLines, 0);
  assert.equal(summary.unmeasurableAuthoredFiles, 0);
  assert.equal(summary.binaryFiles, 1);
});

void test('fails closed when a binary source rename hides line counts', () => {
  const summary = AuthoredChangeSummary.fromNumstat({
    numstat: '-\t-\t\0src/old.ts\0src/new.ts\0',
  });
  assert.equal(summary.pureRenameFiles, 0);
  assert.equal(summary.unmeasurableAuthoredFiles, 1);
});

void test('counts newline-terminated untracked text like Git numstat', () => {
  assert.equal(new SourceText('x\n').lineCount(), 1);
  assert.equal(new SourceText('x').lineCount(), 1);
  assert.equal(new SourceText('x\r\ny\r\n').lineCount(), 2);
  assert.equal(new SourceText('x\ry\r').lineCount(), 1);
});

void test('counts an untracked symlink blob without following its target', () => {
  const root = mkdtempSync(join(tmpdir(), 'nook-budget-'));
  const link = join(root, 'fixture.ts');
  try {
    symlinkSync('../missing-large-file', link);
    const summary = AuthoredChangeSummary.fromNumstat({ numstat: '' });
    assert(summary.addUntracked([link]).isOk());
    assert.equal(summary.authoredLines, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test('measures authored additions from the pinned local-dev commit', () => {
  const fixture = AuthoredBudgetRepositoryFixture.create();
  try {
    fixture.git('init', '-q');
    fixture.git('config', 'user.name', 'Loom Fixture');
    fixture.git('config', 'user.email', 'loom-fixture@example.test');
    writeFileSync(join(fixture.root, 'history.txt'), 'main\n');
    fixture.git('add', '--', 'history.txt');
    fixture.git('commit', '-qm', 'main');
    const originMainSha = fixture.git('rev-parse', 'HEAD');
    fixture.git('update-ref', 'refs/remotes/origin/main', originMainSha);

    writeFileSync(join(fixture.root, 'prior-dev.ts'), 'x\n'.repeat(2_001));
    fixture.git('add', '--', 'prior-dev.ts');
    fixture.git('commit', '-qm', 'prior dev');
    const pinnedLocalDevSha = fixture.git('rev-parse', 'HEAD');

    writeFileSync(
      join(fixture.root, 'feature.ts'),
      'const feature = true;\n',
    );
    fixture.git('add', '--', 'feature.ts');
    fixture.git('commit', '-qm', 'feature');
    const featureHeadSha = fixture.git('rev-parse', 'HEAD');

    const result = new AuthoredBudgetWorkspace({
      environment: {
        ...process.env,
        ORIGIN_MAIN_SHA: originMainSha,
        PINNED_LOCAL_DEV_SHA: pinnedLocalDevSha,
        FEATURE_HEAD_SHA: featureHeadSha,
      },
      repoRoot: fixture.root,
    }).main();
    assert(result.isOk());
  } finally {
    fixture.dispose();
  }
});

void test('fails closed when authored-budget bootstrap evidence is stale', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'nook-budget-stale-base-'));
  try {
    const result = new AuthoredBudgetWorkspace({
      environment: { ...process.env },
      repoRoot,
    }).main();
    assert(result.isErr());
    assert.equal(result.error.kind, AuthoredBudgetFailureKind.BaseEvidence);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
