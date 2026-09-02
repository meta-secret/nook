import path from 'node:path';
import { runCortexVale } from '../lib/cortex-vale.ts';

const [repoRootArgument = false, cortexRootArgument = false] =
  process.argv.slice(2);
if (repoRootArgument === false || cortexRootArgument === false) {
  throw new Error('Expected repository root and Cortex root arguments.');
}
const repoRoot = path.resolve(repoRootArgument);
const cortexRoot = path.resolve(repoRoot, cortexRootArgument);
runCortexVale({ cortexRoot, repoRoot });
process.stdout.write('{}\n');
