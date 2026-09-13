import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'bun:test';

import { PinnedDevBaseEnvironment } from '../src/lib/pinned-dev-base-environment.ts';

class PinnedDevBaseEnvironmentFixture {
  private constructor(readonly root: string) {}

  static create(): PinnedDevBaseEnvironmentFixture {
    const root = mkdtempSync(join(tmpdir(), 'nook-pinned-dev-base-'));
    const fixture = new PinnedDevBaseEnvironmentFixture(root);
    fixture.git('init', '-q');
    fixture.git('config', 'user.name', 'Loom Fixture');
    fixture.git('config', 'user.email', 'loom-fixture@example.test');
    return fixture;
  }

  commit(path: string, content: string, message: string): string {
    writeFileSync(join(this.root, path), content);
    this.git('add', '--', path);
    this.git('commit', '-qm', message);
    return this.git('rev-parse', 'HEAD');
  }

  originRef(sha: string): void {
    this.git('update-ref', 'refs/remotes/origin/main', sha);
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

const environmentFor = (
  originMainSha: string,
  pinnedLocalDevSha: string,
  featureHeadSha: string,
): NodeJS.ProcessEnv => ({
  ...process.env,
  ORIGIN_MAIN_SHA: originMainSha,
  PINNED_LOCAL_DEV_SHA: pinnedLocalDevSha,
  FEATURE_HEAD_SHA: featureHeadSha,
});

describe('pinned local-dev comparison evidence', () => {
  test('accepts the exact pinned local-dev commit and its ancestry', () => {
    const fixture = PinnedDevBaseEnvironmentFixture.create();
    try {
      const originMainSha = fixture.commit('history.txt', 'main\n', 'main');
      const pinnedLocalDevSha = fixture.commit(
        'history.txt',
        'local dev\n',
        'local dev',
      );
      const featureHeadSha = fixture.commit(
        'feature.txt',
        'feature\n',
        'feature',
      );
      fixture.originRef(originMainSha);

      const resolved = PinnedDevBaseEnvironment.resolve({
        environment: environmentFor(
          originMainSha,
          pinnedLocalDevSha,
          featureHeadSha,
        ),
        repoRoot: fixture.root,
      });
      assert(resolved.isOk());
      assert.equal(resolved.value.pinnedLocalDevSha, pinnedLocalDevSha);
    } finally {
      fixture.dispose();
    }
  });

  test('rejects missing, malformed, and stale bootstrap evidence', () => {
    const fixture = PinnedDevBaseEnvironmentFixture.create();
    try {
      const originMainSha = fixture.commit('history.txt', 'main\n', 'main');
      const pinnedLocalDevSha = fixture.commit(
        'history.txt',
        'local dev\n',
        'local dev',
      );
      const featureHeadSha = fixture.commit(
        'feature.txt',
        'feature\n',
        'feature',
      );
      fixture.originRef(originMainSha);

      const missing = PinnedDevBaseEnvironment.resolve({
        environment: { ...process.env },
        repoRoot: fixture.root,
      });
      assert(missing.isErr());
      assert.match(missing.error.message, /ORIGIN_MAIN_SHA/u);

      const malformed = PinnedDevBaseEnvironment.resolve({
        environment: environmentFor(
          'main',
          pinnedLocalDevSha,
          featureHeadSha,
        ),
        repoRoot: fixture.root,
      });
      assert(malformed.isErr());
      assert.match(malformed.error.message, /40-hex/u);

      const stale = PinnedDevBaseEnvironment.resolve({
        environment: environmentFor(
          pinnedLocalDevSha,
          pinnedLocalDevSha,
          featureHeadSha,
        ),
        repoRoot: fixture.root,
      });
      assert(stale.isErr());
      assert.match(stale.error.message, /stale|ancestry/u);
    } finally {
      fixture.dispose();
    }
  });

  test('rejects a pinned commit that is not an ancestor of the feature head', () => {
    const fixture = PinnedDevBaseEnvironmentFixture.create();
    try {
      const originMainSha = fixture.commit('history.txt', 'main\n', 'main');
      const pinnedLocalDevSha = fixture.commit(
        'history.txt',
        'local dev\n',
        'local dev',
      );
      const featureSha = fixture.commit(
        'feature.txt',
        'feature\n',
        'feature',
      );
      fixture.originRef(originMainSha);

      fixture.git('checkout', '-q', '--detach', originMainSha);
      const otherBase = fixture.commit('other.txt', 'other\n', 'other');
      fixture.git('checkout', '-q', '--detach', featureSha);
      const rejected = PinnedDevBaseEnvironment.resolve({
        environment: environmentFor(originMainSha, otherBase, featureSha),
        repoRoot: fixture.root,
      });
      assert(rejected.isErr());
      assert.match(rejected.error.message, /featureHeadSha|pinnedLocalDevSha/u);
      assert.notEqual(otherBase, pinnedLocalDevSha);
    } finally {
      fixture.dispose();
    }
  });
});
