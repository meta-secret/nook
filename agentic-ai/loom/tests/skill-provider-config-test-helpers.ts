import { join } from 'node:path';
import {
  executableSourceReferencesProvider,
  type ExecutableProviderReferenceInspection,
} from './skill-provider-executable-script.ts';
import { PROVIDER_ROOT } from './skill-provider-config-application.ts';

const REPOSITORY_ROOT = join(import.meta.dir, '../../..');

export async function pathsContainingProviderRoot(
  paths: readonly string[],
): Promise<readonly string[]> {
  const matches: string[] = [];
  for (const path of paths) {
    const source = await Bun.file(join(REPOSITORY_ROOT, path)).text();
    const inspection: ExecutableProviderReferenceInspection = { path, source };
    if (
      path.includes(PROVIDER_ROOT) ||
      executableSourceReferencesProvider(inspection)
    )
      matches.push(path);
  }
  return matches;
}
