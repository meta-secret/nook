import { describe, expect, test } from 'bun:test';
import {
  CORTEX_AUTHORING_SKILL_PATHS,
  resolveTeamTaskContext,
} from '../../src/team-agents/context.ts';
import type { TeamTaskContextRequest } from '../../src/team-agents/context.ts';
import { TeamKey } from '../../src/team-agents/catalog.ts';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '../../../..');
const SRE_CONTEXT_PATHS = [
  '.cortex/teams/sre/AGENTS.md',
  '.cortex/teams/sre/knowledge-graph.md',
] as const;
const SRE_DELTA_SKILL =
  '.cortex/teams/sre/dynamic-skills/github-actions-only-validation.md';

describe('team task context', () => {
  test('keeps team identity separate from dynamically selected skills', () => {
    const request: TeamTaskContextRequest = {
      repositoryRoot: REPO_ROOT,
      team: TeamKey.Sre,
      readClaims: ['.cortex/teams/sre/dynamic-skills/**'],
      writeClaims: ['infra/arc/**'],
      selectedSkillPaths: [SRE_DELTA_SKILL],
    };
    const context = resolveTeamTaskContext(request);

    expect(context.team).toBe(TeamKey.Sre);
    expect(context.contextPaths).toEqual([
      ...SRE_CONTEXT_PATHS,
      SRE_DELTA_SKILL,
    ]);
    expect(context.skillPaths).toEqual([SRE_DELTA_SKILL]);
  });

  test.each([
    '.cortex/**',
    '.cortex/teams/sre/**',
    '.cortex/teams/sre/workflows/quality.md',
    '**/*.md',
  ])('automatically composes Cortex authoring skills for %s', (writeClaim) => {
    const request: TeamTaskContextRequest = {
      repositoryRoot: REPO_ROOT,
      team: TeamKey.Sre,
      readClaims: ['.cortex/teams/sre/dynamic-skills/**'],
      writeClaims: [writeClaim],
      selectedSkillPaths: [SRE_DELTA_SKILL],
    };
    const context = resolveTeamTaskContext(request);

    expect(context.team).toBe(TeamKey.Sre);
    expect(context.skillPaths).toEqual([
      ...CORTEX_AUTHORING_SKILL_PATHS,
      SRE_DELTA_SKILL,
    ]);
    expect(context.contextPaths).toEqual([
      ...SRE_CONTEXT_PATHS,
      ...CORTEX_AUTHORING_SKILL_PATHS,
      SRE_DELTA_SKILL,
    ]);
  });

  test('does not attach authoring skills for Cortex reads', () => {
    const request: TeamTaskContextRequest = {
      repositoryRoot: REPO_ROOT,
      team: TeamKey.Sre,
      readClaims: [],
      writeClaims: [],
      selectedSkillPaths: [],
    };
    const context = resolveTeamTaskContext(request);

    expect(context.contextPaths).toEqual(SRE_CONTEXT_PATHS);
    expect(context.skillPaths).toEqual([]);
  });

  test('deduplicates a selected canonical authoring skill', () => {
    const request: TeamTaskContextRequest = {
      repositoryRoot: REPO_ROOT,
      team: TeamKey.Sre,
      readClaims: [],
      writeClaims: ['.cortex/teams/sre/**'],
      selectedSkillPaths: [CORTEX_AUTHORING_SKILL_PATHS[0]],
    };
    const context = resolveTeamTaskContext(request);

    expect(context.skillPaths).toHaveLength(
      CORTEX_AUTHORING_SKILL_PATHS.length,
    );
  });

  test('rejects unsafe claims and non-Cortex skill paths', () => {
    const unsafeClaim: TeamTaskContextRequest = {
      repositoryRoot: REPO_ROOT,
      team: TeamKey.Sre,
      readClaims: [],
      writeClaims: ['../.cortex/**'],
      selectedSkillPaths: [],
    };
    const invalidSkill: TeamTaskContextRequest = {
      repositoryRoot: REPO_ROOT,
      team: TeamKey.Sre,
      readClaims: ['README.md'],
      writeClaims: [],
      selectedSkillPaths: ['README.md'],
    };
    const nonSkillCortexPath: TeamTaskContextRequest = {
      repositoryRoot: REPO_ROOT,
      team: TeamKey.Sre,
      readClaims: ['.cortex/teams/sre/workflows/quality.md'],
      writeClaims: [],
      selectedSkillPaths: ['.cortex/teams/sre/workflows/quality.md'],
    };
    expect(() => resolveTeamTaskContext(unsafeClaim)).toThrow(
      'canonical resource paths',
    );
    expect(() => resolveTeamTaskContext(invalidSkill)).toThrow(
      'exact existing task-authorized Cortex Markdown files',
    );
    expect(() => resolveTeamTaskContext(nonSkillCortexPath)).toThrow(
      'exact existing task-authorized Cortex Markdown files',
    );
  });

  test('rejects wildcard, missing, and unreadable selected skills', () => {
    const request: TeamTaskContextRequest = {
      repositoryRoot: REPO_ROOT,
      team: TeamKey.Sre,
      readClaims: ['.cortex/teams/sre/dynamic-skills/**'],
      writeClaims: [],
      selectedSkillPaths: [],
    };
    for (const selectedSkillPath of [
      '.cortex/teams/sre/dynamic-skills/*.md',
      '.cortex/teams/sre/dynamic-skills/missing.md',
      '.cortex/teams/security/dynamic-skills/browser-extension-release-security.md',
    ]) {
      const selectedRequest: TeamTaskContextRequest = {
        ...request,
        selectedSkillPaths: [selectedSkillPath],
      };
      expect(() => resolveTeamTaskContext(selectedRequest)).toThrow(
        'exact existing task-authorized Cortex Markdown files',
      );
    }
  });
});
