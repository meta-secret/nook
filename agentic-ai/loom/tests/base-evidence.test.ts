import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'bun:test';

import {
  PinnedDevBaseEvidenceContract,
  type PinnedDevBaseAncestryRequest,
} from '../src/lib/base-evidence.ts';

class BaseEvidenceGitFixture {
  private constructor(readonly root: string) {}

  static create(): BaseEvidenceGitFixture {
    const root = mkdtempSync(join(tmpdir(), 'nook-base-evidence-'));
    const fixture = new BaseEvidenceGitFixture(root);
    fixture.git('init');
    return fixture;
  }

  git(...args: string[]): string {
    const environment = { ...process.env };
    delete environment.GIT_NO_REPLACE_OBJECTS;
    return execFileSync('git', ['-C', this.root, ...args], {
      encoding: 'utf8',
      env: environment,
    }).trim();
  }

  gitWithInput(input: string, ...args: string[]): string {
    const environment = { ...process.env };
    delete environment.GIT_NO_REPLACE_OBJECTS;
    return execFileSync('git', ['-C', this.root, ...args], {
      encoding: 'utf8',
      env: environment,
      input,
    }).trim();
  }

  commit(message: string, parent?: string): string {
    const file = join(this.root, 'fixture.txt');
    writeFileSync(file, `${message}\n`);
    const blob = this.git('hash-object', '-w', file);
    const tree = this.gitWithInput(
      `100644 blob ${blob}\tfixture.txt\n`,
      'mktree',
    );
    const commitArgs = [
      '-c',
      'user.name=Loom Fixture',
      '-c',
      'user.email=loom-fixture@example.test',
      'commit-tree',
      tree,
    ];
    if (parent) commitArgs.push('-p', parent);
    commitArgs.push('-m', message);
    return this.git(...commitArgs);
  }

  replaceCommit(target: string, parent: string): void {
    const replacement = this.commit('replacement', parent);
    this.git('replace', target, replacement);
  }

  originRef(commit: string): void {
    this.git('update-ref', 'refs/remotes/origin/main', commit);
  }

  request(
    originMainSha: string,
    pinnedLocalDevSha: string,
    featureHeadSha: string,
    sourceCommit: string,
  ): PinnedDevBaseAncestryRequest {
    return {
      originMainSha,
      pinnedLocalDevSha,
      featureHeadSha,
      sourceCommit,
      workingDirectory: this.root,
    };
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

describe('pinned dev base Git identity', () => {
  test('rejects replacement-ref ancestry bypasses', () => {
    const fixture = BaseEvidenceGitFixture.create();
    try {
      const originMainSha = fixture.commit('origin main');
      const pinnedLocalDevSha = fixture.commit('pinned local dev');
      const sourceCommit = fixture.commit('source commit');
      fixture.originRef(originMainSha);
      fixture.replaceCommit(pinnedLocalDevSha, originMainSha);

      assert.equal(
        fixture.git(
          'merge-base',
          '--is-ancestor',
          originMainSha,
          pinnedLocalDevSha,
        ),
        '',
      );
      assert.throws(
        () =>
          PinnedDevBaseEvidenceContract.assertAncestry(
            fixture.request(
              originMainSha,
              pinnedLocalDevSha,
              sourceCommit,
              sourceCommit,
            ),
          ),
        /pinnedLocalDevSha must include/u,
      );
    } finally {
      fixture.dispose();
    }
  });

  test('rejects a stale origin/main identity even when it is an ancestor', () => {
    const fixture = BaseEvidenceGitFixture.create();
    try {
      const recordedOriginMainSha = fixture.commit('recorded origin main');
      const currentOriginMainSha = fixture.commit('current origin main');
      const pinnedLocalDevSha = fixture.commit(
        'pinned local dev',
        currentOriginMainSha,
      );
      const sourceCommit = fixture.commit('source commit', pinnedLocalDevSha);
      fixture.originRef(currentOriginMainSha);

      assert.throws(
        () =>
          PinnedDevBaseEvidenceContract.assertAncestry(
            fixture.request(
              recordedOriginMainSha,
              pinnedLocalDevSha,
              sourceCommit,
              sourceCommit,
            ),
          ),
        /exact fetched refs\/remotes\/origin\/main/u,
      );
    } finally {
      fixture.dispose();
    }
  });
});
