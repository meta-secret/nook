export class MarkdownContractSections {
  private constructor(private readonly request: MarkdownContractAuditRequest) {}
  static audit(
    request: MarkdownContractAuditRequest,
  ): readonly MarkdownContractDrift[] {
    return new MarkdownContractSections(request).execute();
  }
  private execute(): readonly MarkdownContractDrift[] {
    const request = this.request;
    const drifts: MarkdownContractDrift[] = [];
    for (const contract of request.sections) {
      const sectionRequest: NormalizedMarkdownSectionRequest = {
        heading: contract.heading,
        source: request.source,
      };
      const section = this.normalizedMarkdownSection(sectionRequest);
      const missingMarkers = contract.requiredMarkers.filter(
        (marker) =>
          !section || !section.includes(this.normalizedMarkdown(marker)),
      );
      if (missingMarkers.length === 0) continue;
      const drift: MarkdownContractDrift = {
        heading: contract.heading,
        missingMarkers,
      };
      drifts.push(drift);
    }
    return drifts;
  }

  private normalizedMarkdownSection(
    request: NormalizedMarkdownSectionRequest,
  ): string | false {
    const lines = request.source.replaceAll('\r\n', '\n').split('\n');
    const start = lines.findIndex((line) => line.trim() === request.heading);
    if (start < 0) return false;
    const headingLevel = this.markdownHeadingLevel(request.heading);
    if (headingLevel === false) return false;
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      const candidate = lines[index];
      if (typeof candidate !== 'string') continue;
      const candidateLevel = this.markdownHeadingLevel(candidate.trim());
      if (candidateLevel !== false && candidateLevel <= headingLevel) {
        end = index;
        break;
      }
    }
    return this.normalizedMarkdown(lines.slice(start, end).join('\n'));
  }

  private markdownHeadingLevel(heading: string): number | false {
    const match = /^(#{1,6})\s+\S/u.exec(heading);
    const [defaulted1 = false] = [match?.[1]?.length];
    return defaulted1;
  }

  private normalizedMarkdown(value: string): string {
    return value.replace(/\s+/gu, ' ').trim();
  }
}
export type MarkdownContractSection = {
  readonly heading: string;
  readonly requiredMarkers: readonly string[];
};

export type MarkdownContractAuditRequest = {
  readonly sections: readonly MarkdownContractSection[];
  readonly source: string;
};

export type MarkdownContractDrift = {
  readonly heading: string;
  readonly missingMarkers: readonly string[];
};

type NormalizedMarkdownSectionRequest = {
  readonly heading: string;
  readonly source: string;
};
