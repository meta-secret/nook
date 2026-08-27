import { MODULE_EXPERT_CATALOG } from './catalog.ts';
import type { ModuleExpertTaskContextPath } from './catalog.ts';

export type ModuleExpertContextSelection = {
  readonly expertName: string;
  readonly selectedContextPaths: readonly string[];
};

export function validatedModuleExpertContextPaths(
  selection: ModuleExpertContextSelection,
): readonly ModuleExpertTaskContextPath[] {
  const profile = MODULE_EXPERT_CATALOG.find(
    (candidate) => candidate.name === selection.expertName,
  );
  if (!profile) {
    if (selection.selectedContextPaths.length === 0) return [];
    invalidContextSelection();
  }
  if (profile.allowedContextPaths.length === 0) {
    if (selection.selectedContextPaths.length === 0) return [];
    invalidContextSelection();
  }
  const selected = new Set(selection.selectedContextPaths);
  const canonicalSelection = profile.allowedContextPaths.filter((path) =>
    selected.has(path),
  );
  if (
    selection.selectedContextPaths.length === 0 ||
    selected.size !== selection.selectedContextPaths.length ||
    JSON.stringify(selection.selectedContextPaths) !==
      JSON.stringify(canonicalSelection)
  ) {
    invalidContextSelection();
  }
  return Object.freeze([...canonicalSelection]);
}

function invalidContextSelection(): never {
  throw new Error('Module expert context selection is invalid.');
}
