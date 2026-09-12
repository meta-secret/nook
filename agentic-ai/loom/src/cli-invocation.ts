import {
  DefaultableExamplePresence,
  type ExampleCatalogEntry,
  type LookupDefaultableExampleArgs,
  LoomRequestExamples,
} from './codec/example-documents.ts';

export class LoomCommandLine {
  private constructor(private readonly request: ParseCliInvocationArgs) {}
  static parse(args: ParseCliInvocationArgs): CliInvocation {
    return new LoomCommandLine(args).execute();
  }
  private execute(): CliInvocation {
    const args = this.request;
    const argv = args.argv;
    const token = argv[0];
    if (typeof token !== 'string' || token === 'help' || token === '--help') {
      return { kind: CliInvocationKind.Help };
    }
    if (token === DEFAULT_FLAG) {
      return this.parseDefaultFamily(argv);
    }
    if (argv.length !== 1) {
      return {
        kind: CliInvocationKind.UsageError,
        message: 'expected exactly one request YAML path argument',
      };
    }
    return { kind: CliInvocationKind.RequestFile, requestPath: token };
  }

  private parseDefaultFamily(argv: readonly string[]): CliInvocation {
    if (argv.length !== 2) {
      return {
        kind: CliInvocationKind.UsageError,
        message:
          'expected loom --default <prePush|toolsList|cortexAudit|cortexSessionClean|dependencyPopularity>',
      };
    }
    const family = argv[1];
    if (typeof family !== 'string') {
      return {
        kind: CliInvocationKind.UsageError,
        message:
          'expected loom --default <prePush|toolsList|cortexAudit|cortexSessionClean|dependencyPopularity>',
      };
    }
    const lookupDefaultableExampleArgs: LookupDefaultableExampleArgs = {
      family,
    };
    const lookup = LoomRequestExamples.lookupDefaultableExample(
      lookupDefaultableExampleArgs,
    );
    if (lookup.presence === DefaultableExamplePresence.Present) {
      return { kind: CliInvocationKind.DefaultFamily, entry: lookup.entry };
    }
    return {
      kind: CliInvocationKind.UsageError,
      message:
        'expected loom --default <prePush|toolsList|cortexAudit|cortexSessionClean|dependencyPopularity>',
    };
  }
}

export enum CliInvocationKind {
  Help = 'help',
  RequestFile = 'requestFile',
  DefaultFamily = 'defaultFamily',
  UsageError = 'usageError',
}

export type CliInvocation =
  | { readonly kind: CliInvocationKind.Help }
  | {
      readonly kind: CliInvocationKind.RequestFile;
      readonly requestPath: string;
    }
  | {
      readonly kind: CliInvocationKind.DefaultFamily;
      readonly entry: ExampleCatalogEntry;
    }
  | { readonly kind: CliInvocationKind.UsageError; readonly message: string };

export type ParseCliInvocationArgs = {
  readonly argv: readonly string[];
};

const DEFAULT_FLAG = '--default';
