import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

interface SkillLintTextOptions {
  readonly filePath: string;
}

type SkillLintResults = ESLint.LintResult[];

const sourceOptions: SkillLintTextOptions = {
  filePath: 'cortex-article-structure/src/audit.ts',
};

function ruleIds(results: SkillLintResults): Array<string> {
  return (
    results[0]?.messages.flatMap((message) =>
      message.ruleId ? [message.ruleId] : [],
    ) ?? []
  );
}

describe('executable-skill named argument contract', () => {
  test('rejects object literals expanded from spread arrays', async () => {
    const eslint = new ESLint();
    const results = await eslint.lintText(
      `
        interface ArticleRequest { readonly path: string }
        type ArticleRequestSequence = ArticleRequest[];
        declare function audit(...requests: ArticleRequestSequence): void;
        const inferredRequests = [{ path: '.cortex/AGENTS.md' }];
        audit(...[{ path: '.cortex/knowledge-graph.md' }]);
        audit(...[...[{ path: '.cortex/architecture/index.md' }]]);
        audit(...inferredRequests);
      `,
      sourceOptions,
    );

    expect(ruleIds(results)).toEqual([
      'nook/no-raw-object-arguments',
      'nook/no-raw-object-arguments',
      'nook/no-raw-object-arguments',
    ]);
  });

  test('rejects inline tuple and object parameter contracts', async () => {
    const eslint = new ESLint();
    const results = await eslint.lintText(
      `
        function readPair(pair: [string, number]): void { void pair; }
        function auditArticle(request: { path: string }): void {
          void request;
        }
      `,
      sourceOptions,
    );

    expect(ruleIds(results)).toEqual([
      'nook/no-raw-object-arguments',
      'nook/no-raw-object-arguments',
    ]);
  });

  test('rejects inferred object parameter defaults', async () => {
    const eslint = new ESLint();
    const results = await eslint.lintText(
      `
        function direct(request = { path: '.cortex/AGENTS.md' }): void {
          void request;
        }
        function destructured({
          request = { path: '.cortex/knowledge-graph.md' },
        }): void {
          void request;
        }
      `,
      sourceOptions,
    );

    expect(ruleIds(results)).toEqual([
      'nook/no-raw-object-arguments',
      'nook/no-raw-object-arguments',
    ]);
  });
});
