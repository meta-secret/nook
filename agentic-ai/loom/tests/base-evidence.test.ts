import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'bun:test';

import {
  CanonicalFeatureBranchContract,
  CanonicalWorkerBranchContract,
  PinnedDevBaseEvidenceContract,
  type CanonicalFeatureBranch,
  type CanonicalWorkerBranch,
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

  gitWithInput(
    ...[input, ...args]: [input: string, ...args: string[]]
  ): string {
    const environment = { ...process.env };
    delete environment.GIT_NO_REPLACE_OBJECTS;
    return execFileSync('git', ['-C', this.root, ...args], {
      encoding: 'utf8',
      env: environment,
      input,
    }).trim();
  }

  commit(...[message, parent]: [message: string, parent?: string]): string {
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

  replaceCommit(...[target, parent]: [target: string, parent: string]): void {
    const replacement = this.commit('replacement', parent);
    this.git('replace', target, replacement);
  }

  originRef(commit: string): void {
    this.git('update-ref', 'refs/remotes/origin/main', commit);
  }

  request(
    ...[originMainSha, pinnedLocalDevSha, sourceCommit]: [
      originMainSha: string,
      pinnedLocalDevSha: string,
      sourceCommit: string,
    ]
  ): PinnedDevBaseAncestryRequest {
    return {
      originMainSha,
      pinnedLocalDevSha,
      sourceCommit,
      workingDirectory: this.root,
    };
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

describe('upstream worker role branch scopes', () => {
  test.each([
    'codex/child/ai/tech-writer/agent-branching/define-project-context-rules',
    'codex/child/ai/typescript-dev/agent-branching/implement-loom-context-routing',
    'codex/child/dev-core/rust-dev/agent-branching/implement-domain-validation',
    'codex/child/security/security-agent/agent-branching/review-vault-trust-boundaries',
    'codex/child/sre/docker-specialist/agent-branching/verify-compile-cache-reuse',
    'codex/child/sre/kubernetes-specialist/agent-branching/update-runner-cluster-policy',
    'codex/child/sre/cicd-agent/agent-branching/validate-hosted-build-results',
    'codex/child/web-dev/typescript-dev/agent-branching/implement-browser-interaction',
    'codex/child/delivery-pipeline/pr-agent/agent-branching/publish-validated-feature-head',
  ])('accepts the upstream role in its Nook scope: %s', (branch) => {
    assert.equal(CanonicalWorkerBranchContract.parse(branch), branch);
  });

  test.each([
    'codex/child/ai/loom-specialist/agent-branching/implement-loom-context-routing',
    'codex/child/dev-core/rust-auth2-developer/agent-branching/implement-domain-validation',
    'codex/child/delivery-pipeline/pr-lifecycle/agent-branching/publish-validated-feature-head',
    'codex/child/security/typescript-dev/agent-branching/implement-domain-validation',
  ])(
    'rejects retired roles and foreign role scopes without aliases: %s',
    (branch) => {
      assert.throws(
        () => CanonicalWorkerBranchContract.parse(branch),
        /malformed/,
      );
    },
  );
});

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
            fixture.request(originMainSha, pinnedLocalDevSha, sourceCommit),
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
            ),
          ),
        /exact fetched refs\/remotes\/origin\/main/u,
      );
    } finally {
      fixture.dispose();
    }
  });
});

describe('canonical feature branch identity', () => {
  test('accepts Prime feature forms', () => {
    const validBranches: readonly string[] = [
      'codex/repair-cache',
      'codex/abcdefghij',
      'codex/agentic-pipeline-delivery',
    ];

    for (const branch of validBranches) {
      const parsed: CanonicalFeatureBranch =
        CanonicalFeatureBranchContract.parse(branch);
      assert.equal(parsed, branch);
    }
  });

  test('rejects short, repeated-hyphen, and unregistered forms', () => {
    const invalidBranches: readonly string[] = [
      'main',
      'codex/',
      'codex/repair',
      'codex/agent--branching',
      'codex/child/sre/cicd-agent/agent-branching/fix-cache-branch-compile',
      'codex/agent-branching/sre/cicd-agent/fix--cache-branch-compile',
      'codex/automation-main-failure-abc-run-42-attempt-1',
      'codex/agentic-pipeline-deliveries',
      'codex/Repair-cache',
      'codex/agent-branching/sre/cicd-agent/short',
      'codex/agent-branching/web-dev/cicd-agent/fix-cache-branch-compile',
      'codex/agent-branching/sre/cicd-agent/fix-cache-branch-compile/extra',
      'codex/agentic-pipeline-delivery/tmp',
      'codex/agentic-pipeline-delivery/delivery-pipeline/pr-agent/short',
    ];

    for (const branch of invalidBranches) {
      assert.throws(() => CanonicalFeatureBranchContract.parse(branch));
    }
  });
});

describe('canonical worker branch identity', () => {
  test('accepts registered worker forms with the isolated child namespace', () => {
    const validBranches: readonly string[] = [
      'codex/child/sre/cicd-agent/agent-branching/fix-cache-branch-compile',
      'codex/child/web-dev/web-designer/agent-branching/design-shared-browser-interface',
      'codex/child/delivery-pipeline/pr-agent/agent-branching/define-remote-branch-contract',
      'codex/child/ai/typescript-dev/agentic-pipeline-delivery/update-agent-routing-contract',
    ];

    for (const branch of validBranches) {
      const parsed: CanonicalWorkerBranch =
        CanonicalWorkerBranchContract.parse(branch);
      assert.equal(parsed, branch);
    }
  });

  test('rejects noncanonical identities and opaque work suffixes', () => {
    const invalidBranches: readonly string[] = [
      'codex/agent-branching',
      'codex/agent-branching/sre/cicd-agent/fix-cache-branch-compile',
      'codex/child/sre/gizmo/agent-branching/fix-cache-branch-compile',
      'codex/child/web-dev/cicd-agent/agent-branching/fix-cache-branch-compile',
      'codex/child/sre/cicd-agent/short/fix-cache-branch-compile',
      'codex/child/sre/cicd-agent/agent-branching/short',
      'codex/child/sre/cicd-agent/agent-branching/fix-cache-branch-compile-v2',
      'codex/child/sre/cicd-agent/agent-branching/123e4567-e89b-12d3-a456-426614174000',
      'codex/child/sre/cicd-agent/agent-branching/fix-cache-on-2026-09-22',
      'codex/child/sre/cicd-agent/agent-branching/fix-cache-20260922-021234',
      'codex/child/sre/cicd-agent/agent-branching/fix-cache-20260922021234',
    ];

    for (const branch of invalidBranches) {
      assert.throws(() => CanonicalWorkerBranchContract.parse(branch));
    }
  });
});
