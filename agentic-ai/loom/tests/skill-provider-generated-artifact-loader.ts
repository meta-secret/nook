import { posix } from 'node:path';

import ts from 'typescript';

import type { BoundedPackageLoaderInspection } from './skill-provider-bounded-package-loader.ts';

export class SkillProviderGeneratedArtifactLoaderScenario {
  constructor(private readonly inspection: BoundedPackageLoaderInspection) {}

  specialize(): string {
    const sourceFile = ts.createSourceFile(
      this.inspection.path,
      this.inspection.source,
      ts.ScriptTarget.ES2022,
      true,
    );
    const declarations = new Map<string, ts.VariableDeclaration>();
    const imports: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        declarations.set(node.name.text, node);
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        imports.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (imports.length !== 1) return this.inspection.source;
    const dynamicImport = imports[0];
    const urlArgument = dynamicImport?.arguments[0];
    if (!dynamicImport || !urlArgument || !ts.isIdentifier(urlArgument)) {
      return this.inspection.source;
    }
    const [urlDeclaration = false] = [declarations.get(urlArgument.text)];
    const target = this.generatedArtifactTarget(urlDeclaration);
    if (target === false) return this.inspection.source;
    const [siteDeclaration = false] = [declarations.get(target.root.text)];
    const output = this.fixedOutputDirectory(siteDeclaration);
    if (
      output === false ||
      this.identifierUseCount({ name: urlArgument.text, sourceFile }) !== 2
    ) {
      return this.inspection.source;
    }
    const appRoot = posix.dirname(posix.dirname(this.inspection.path));
    const artifactPath = posix.join(appRoot, output, target.artifact);
    const producer = this.generatedArtifactProducer({
      artifact: target.artifact,
      output,
    });
    if (producer === false || producer.artifactPath !== artifactPath) {
      return this.inspection.source;
    }
    const relative = posix.relative(
      posix.dirname(this.inspection.path),
      producer.sourcePath,
    );
    const specifier = relative.startsWith('.') ? relative : `./${relative}`;
    return `${this.inspection.source.slice(0, dynamicImport.getStart(sourceFile))}import('${specifier}')${this.inspection.source.slice(dynamicImport.end)}`;
  }

  private generatedArtifactTarget(
    declaration: ts.VariableDeclaration | false,
  ): GeneratedArtifactTarget | false {
    const initializer = declaration === false ? false : declaration.initializer;
    if (
      !initializer ||
      !ts.isTemplateExpression(initializer) ||
      initializer.templateSpans.length !== 2
    )
      return false;
    const fileUrl = initializer.templateSpans[0]?.expression;
    const cacheBust = initializer.templateSpans[1]?.expression;
    if (
      !fileUrl ||
      !ts.isPropertyAccessExpression(fileUrl) ||
      fileUrl.name.text !== 'href' ||
      !ts.isCallExpression(fileUrl.expression) ||
      !ts.isIdentifier(fileUrl.expression.expression) ||
      fileUrl.expression.expression.text !== 'pathToFileURL' ||
      !cacheBust ||
      !ts.isCallExpression(cacheBust) ||
      !ts.isPropertyAccessExpression(cacheBust.expression) ||
      !ts.isIdentifier(cacheBust.expression.expression) ||
      cacheBust.expression.expression.text !== 'Date' ||
      cacheBust.expression.name.text !== 'now' ||
      cacheBust.arguments.length !== 0
    )
      return false;
    const joinCall = fileUrl.expression.arguments[0];
    if (
      !joinCall ||
      !ts.isCallExpression(joinCall) ||
      !ts.isIdentifier(joinCall.expression) ||
      joinCall.expression.text !== 'join'
    )
      return false;
    const root = joinCall.arguments[0];
    const artifact = joinCall.arguments[1];
    if (
      !root ||
      !ts.isIdentifier(root) ||
      !artifact ||
      !ts.isStringLiteralLike(artifact)
    ) {
      return false;
    }
    return { artifact: artifact.text, root };
  }

  private fixedOutputDirectory(
    declaration: ts.VariableDeclaration | false,
  ): string | false {
    const initializer = declaration === false ? false : declaration.initializer;
    const outputArgument =
      initializer && ts.isCallExpression(initializer)
        ? initializer.arguments[1]
        : false;
    if (
      !initializer ||
      !ts.isCallExpression(initializer) ||
      !ts.isIdentifier(initializer.expression) ||
      initializer.expression.text !== 'join' ||
      !outputArgument ||
      !ts.isStringLiteralLike(outputArgument)
    )
      return false;
    return posix.normalize(outputArgument.text.replace(/^[^/]+\//u, ''));
  }

  private identifierUseCount(inspection: IdentifierUseInspection): number {
    let count = 0;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === inspection.name) count += 1;
      ts.forEachChild(node, visit);
    };
    visit(inspection.sourceFile);
    return count;
  }

  private generatedArtifactProducer(
    request: GeneratedArtifactProducerInspection,
  ): GeneratedArtifactProducer | false {
    for (const root of this.inspection.roots) {
      const [source = ''] = [this.inspection.sources.get(root)];
      if (
        !source.includes('copyFileSync') ||
        !source.includes(`'${request.artifact}'`)
      )
        continue;
      const sourceMatch =
        /copyFileSync\(\s*join\(process\.cwd\(\),\s*'([^']+)'\),\s*join\(outDir,\s*'([^']+)'\)/mu.exec(
          source,
        );
      if (!sourceMatch || sourceMatch[2] !== request.artifact) continue;
      const [, sourcePathSuffix = ''] = sourceMatch;
      const sourcePath = posix.join(posix.dirname(root), sourcePathSuffix);
      if (!this.inspection.sources.has(sourcePath)) continue;
      const envProvesOutput = [...this.inspection.roots].some((path) => {
        const [config = ''] = [this.inspection.sources.get(path)];
        return (
          config.includes('VITE_NOOK_APP_KIND=site') &&
          config.includes(`VITE_NOOK_OUT_DIR=${request.output}`)
        );
      });
      if (!envProvesOutput) continue;
      return {
        artifactPath: posix.join(
          posix.dirname(root),
          request.output,
          request.artifact,
        ),
        sourcePath,
      };
    }
    return false;
  }
}

type GeneratedArtifactTarget = {
  readonly artifact: string;
  readonly root: ts.Identifier;
};

type IdentifierUseInspection = {
  readonly name: string;
  readonly sourceFile: ts.SourceFile;
};

type GeneratedArtifactProducerInspection = {
  readonly artifact: string;
  readonly output: string;
};

type GeneratedArtifactProducer = {
  readonly artifactPath: string;
  readonly sourcePath: string;
};
