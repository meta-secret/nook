export class TaskResourceClaim {
  private constructor(private readonly request: string) {}

  static isValidTaskResourceClaim(claim: string): boolean {
    return new TaskResourceClaim(claim).execute();
  }

  private execute(): boolean {
    const claim = this.request;
    return TaskResourceClaim.parseResourceClaim(claim) !== false;
  }

  static taskResourcePatternsOverlap(pair: TaskResourcePatternPair): boolean {
    const first = TaskResourceClaim.parseResourceClaim(pair.first);
    const second = TaskResourceClaim.parseResourceClaim(pair.second);
    if (!first || !second) return false;
    if (first.kind === ResourceClaimKind.Git) {
      return (
        second.kind === ResourceClaimKind.Git && first.path === second.path
      );
    }
    if (second.kind === ResourceClaimKind.Git) return false;
    if (
      first.kind === ResourceClaimKind.RecursiveBasename ||
      second.kind === ResourceClaimKind.RecursiveBasename
    ) {
      const descriptors: ResourceDescriptorPair = { first, second };
      return TaskResourceClaim.recursiveBasenameOverlaps(descriptors);
    }
    if (
      first.kind === ResourceClaimKind.DirectGlob ||
      second.kind === ResourceClaimKind.DirectGlob
    ) {
      const overlap: ResourceDescriptorPair = { first, second };
      return TaskResourceClaim.directGlobOverlaps(overlap);
    }
    const pathPair: TaskResourcePatternPair = {
      first: first.path,
      second: second.path,
    };
    return TaskResourceClaim.pathsAreNested(pathPair);
  }

  private static parseResourceClaim(
    claim: string,
  ): ResourceClaimDescriptor | false {
    if (!TaskResourceClaim.hasCanonicalResourcePathSegments(claim))
      return false;
    if (/^git:[A-Za-z0-9._/-]+$/.test(claim)) {
      return { kind: ResourceClaimKind.Git, path: claim, basename: '' };
    }
    const literalPath = '[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*';
    if (new RegExp(`^${literalPath}$`).test(claim)) {
      return { kind: ResourceClaimKind.Exact, path: claim, basename: '' };
    }
    if (new RegExp(`^${literalPath}/\\*\\*$`).test(claim)) {
      return {
        kind: ResourceClaimKind.Subtree,
        path: claim.slice(0, -3),
        basename: '',
      };
    }
    const globBasename = '\\*(?:\\.[A-Za-z0-9_-]+)?';
    const directMatch = claim.match(
      new RegExp(`^(${literalPath})/(${globBasename})$`),
    );
    if (directMatch?.[1] && directMatch[2]) {
      return {
        kind: ResourceClaimKind.DirectGlob,
        path: directMatch[1],
        basename: directMatch[2],
      };
    }
    const recursiveMatch = claim.match(
      new RegExp(`^\\*\\*/([A-Za-z0-9._-]+|${globBasename})$`),
    );
    if (recursiveMatch?.[1]) {
      return {
        kind: ResourceClaimKind.RecursiveBasename,
        path: '',
        basename: recursiveMatch[1],
      };
    }
    return false;
  }

  private static hasCanonicalResourcePathSegments(claim: string): boolean {
    const path = claim.startsWith('git:') ? claim.slice(4) : claim;
    return path
      .split('/')
      .every((segment) => segment !== '.' && segment !== '..');
  }

  private static pathsAreNested(pair: TaskResourcePatternPair): boolean {
    return (
      pair.first === pair.second ||
      pair.first.startsWith(`${pair.second}/`) ||
      pair.second.startsWith(`${pair.first}/`)
    );
  }

  private static recursiveBasenameOverlaps(
    pair: ResourceDescriptorPair,
  ): boolean {
    const recursive =
      pair.first.kind === ResourceClaimKind.RecursiveBasename
        ? pair.first
        : pair.second;
    const other = recursive === pair.first ? pair.second : pair.first;
    if (other.kind === ResourceClaimKind.Subtree) return true;
    if (other.kind === ResourceClaimKind.DirectGlob) return true;
    if (other.kind === ResourceClaimKind.RecursiveBasename) return true;
    if (other.kind === ResourceClaimKind.Exact) {
      const inspection: RecursiveExactOverlapInspection = {
        recursiveBasename: recursive.basename,
        exactPath: other.path,
      };
      return TaskResourceClaim.exactPathOverlapsRecursiveBasename(inspection);
    }
    return false;
  }

  private static exactPathOverlapsRecursiveBasename(
    inspection: RecursiveExactOverlapInspection,
  ): boolean {
    const matchingSegment = inspection.exactPath.split('/').some((segment) => {
      const basenames: TaskResourcePatternPair = {
        first: inspection.recursiveBasename,
        second: segment,
      };
      return TaskResourceClaim.globBasenamesOverlap(basenames);
    });
    return (
      matchingSegment ||
      TaskResourceClaim.exactClaimCanNameDirectory(inspection.exactPath)
    );
  }

  private static exactClaimCanNameDirectory(resourcePath: string): boolean {
    const basename = TaskResourceClaim.basenameOfPath(resourcePath);
    return basename.startsWith('.') || !basename.includes('.');
  }

  private static basenameOfPath(resourcePath: string): string {
    const [defaulted1 = resourcePath] = [resourcePath.split('/').at(-1)];
    return defaulted1;
  }

  private static directGlobOverlaps(pair: ResourceDescriptorPair): boolean {
    const first = pair.first;
    const second = pair.second;
    if (
      first.kind === ResourceClaimKind.DirectGlob &&
      second.kind === ResourceClaimKind.DirectGlob
    ) {
      if (first.path !== second.path) {
        const outer = second.path.startsWith(`${first.path}/`)
          ? first
          : first.path.startsWith(`${second.path}/`)
            ? second
            : false;
        if (!outer) return false;
        const inner = outer === first ? second : first;
        const relative = inner.path.slice(outer.path.length + 1);
        const [firstSegment = ''] = [relative.split('/')[0]];
        const nestedBasenames: TaskResourcePatternPair = {
          first: outer.basename,
          second: firstSegment,
        };
        return TaskResourceClaim.globBasenamesOverlap(nestedBasenames);
      }
      const basenames: TaskResourcePatternPair = {
        first: first.basename,
        second: second.basename,
      };
      return TaskResourceClaim.globBasenamesOverlap(basenames);
    }
    const glob = first.kind === ResourceClaimKind.DirectGlob ? first : second;
    const concrete = glob === first ? second : first;
    if (concrete.path === glob.path) return true;
    if (concrete.path.startsWith(`${glob.path}/`)) {
      const relative = concrete.path.slice(glob.path.length + 1);
      const [firstSegment = ''] = [relative.split('/')[0]];
      const basenames: TaskResourcePatternPair = {
        first: glob.basename,
        second: firstSegment,
      };
      return TaskResourceClaim.globBasenamesOverlap(basenames);
    }
    return glob.path.startsWith(`${concrete.path}/`);
  }

  private static globBasenamesOverlap(pair: TaskResourcePatternPair): boolean {
    if (pair.first === '*' || pair.second === '*') return true;
    if (!pair.first.startsWith('*') && !pair.second.startsWith('*')) {
      return pair.first === pair.second;
    }
    if (pair.first.startsWith('*') && pair.second.startsWith('*')) {
      return pair.first === pair.second;
    }
    const glob = pair.first.startsWith('*') ? pair.first : pair.second;
    const literal = glob === pair.first ? pair.second : pair.first;
    return literal.endsWith(glob.slice(1));
  }
}

export type TaskResourcePatternPair = {
  readonly first: string;
  readonly second: string;
};

enum ResourceClaimKind {
  Git = 'git',
  Exact = 'exact',
  Subtree = 'subtree',
  DirectGlob = 'direct-glob',
  RecursiveBasename = 'recursive-basename',
}

type ResourceClaimDescriptor = {
  readonly kind: ResourceClaimKind;
  readonly path: string;
  readonly basename: string;
};

type ResourceDescriptorPair = {
  readonly first: ResourceClaimDescriptor;
  readonly second: ResourceClaimDescriptor;
};

type RecursiveExactOverlapInspection = {
  readonly recursiveBasename: string;
  readonly exactPath: string;
};
