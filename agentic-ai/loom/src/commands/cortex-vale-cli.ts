import path from 'node:path';
import { CortexValeInvocation } from '../lib/cortex-vale.ts';

const [repoRootArgument = false, cortexRootArgument = false] =
  process.argv.slice(2);
if (repoRootArgument === false || cortexRootArgument === false) {
  process.stderr.write('Expected repository root and Cortex root arguments.\n');
  process.exitCode = 1;
} else {
  const repoRoot = path.resolve(repoRootArgument);
  const cortexRoot = path.resolve(repoRoot, cortexRootArgument);
  const result = CortexValeInvocation.runCortexVale({ cortexRoot, repoRoot });
  if (result.isErr()) {
    process.stderr.write(result.error.message + '\n');
    process.exitCode = 1;
  } else process.stdout.write('{}\n');
}
