import {
  MODULE_EXPERT_CATALOG,
  WEB_EXPERT_EXTENSION_RELEASE_SECURITY_AUTHORITY_PATH,
  WEB_EXPERT_PRODUCT_SPEC_PATHS,
  WEB_EXPERT_RELEASE_AUTHORITY_PATHS,
  WEB_EXPERT_SKILL_PATHS,
} from './catalog.ts';

import type { ModuleExpertTaskContextPath } from './catalog.ts';

export class ModuleExpertContextAdmission {
  private constructor(private readonly request: ModuleExpertContextSelection) {}
  static validate(
    selection: ModuleExpertContextSelection,
  ): readonly ModuleExpertTaskContextPath[] {
    return new ModuleExpertContextAdmission(selection).execute();
  }
  private execute(): readonly ModuleExpertTaskContextPath[] {
    const selection = this.request;
    const profile = MODULE_EXPERT_CATALOG.find(
      (candidate) => candidate.name === selection.expertName,
    );
    if (!profile) {
      if (selection.selectedContextPaths.length === 0) return [];
      this.invalidContextSelection();
    }
    if (profile.allowedContextPaths.length === 0) {
      if (selection.selectedContextPaths.length === 0) return [];
      this.invalidContextSelection();
    }
    const selected = new Set(selection.selectedContextPaths);
    const canonicalSelection = profile.allowedContextPaths.filter((path) =>
      selected.has(path),
    );
    if (
      selected.size !== selection.selectedContextPaths.length ||
      JSON.stringify(selection.selectedContextPaths) !==
        JSON.stringify(canonicalSelection)
    ) {
      this.invalidContextSelection();
    }
    const webSelection: WebExpertContextSelection = {
      selectedContextPaths: canonicalSelection,
    };
    this.validateWebExpertSelection(webSelection);
    return Object.freeze([...canonicalSelection]);
  }

  private validateWebExpertSelection(
    selection: WebExpertContextSelection,
  ): void {
    const designSkill = WEB_EXPERT_SKILL_PATHS[1];
    const extensionReleaseSkill = WEB_EXPERT_SKILL_PATHS[2];
    const selected = new Set(selection.selectedContextPaths);
    const hasDesignSkill = selected.has(designSkill);
    const hasExtensionReleaseSkill = selected.has(extensionReleaseSkill);
    const hasExtensionReleaseAuthority = selected.has(
      WEB_EXPERT_EXTENSION_RELEASE_SECURITY_AUTHORITY_PATH,
    );
    const hasReleaseAuthority = WEB_EXPERT_RELEASE_AUTHORITY_PATHS.some(
      (path) => selected.has(path),
    );
    const hasProductAuthority = WEB_EXPERT_PRODUCT_SPEC_PATHS.some((path) =>
      selected.has(path),
    );
    if (
      hasProductAuthority !== hasDesignSkill ||
      hasReleaseAuthority !== hasExtensionReleaseSkill ||
      hasReleaseAuthority !== hasExtensionReleaseAuthority
    ) {
      this.invalidContextSelection();
    }
  }

  private invalidContextSelection(): never {
    throw new Error('Module expert context selection is invalid.');
  }
}

export type ModuleExpertContextSelection = {
  readonly expertName: string;
  readonly selectedContextPaths: readonly string[];
};

type WebExpertContextSelection = {
  readonly selectedContextPaths: readonly ModuleExpertTaskContextPath[];
};
