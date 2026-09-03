# Vale migration ledger

This directory owns Nook's repository-local Vale policy and its executable
fixtures. Migrations stay gradual: Vale replaces a handwritten Markdown check
only after the pinned engine proves the same file scope, exclusions, case
behavior, source line, and alert cardinality.

## Tracked content

- `README.md` records migration decisions and blockers.
- `styles/Nook/**` contains authored Nook rules and must remain tracked.
- `fixtures/**` contains authored engine fixtures and must remain tracked.

The repository does not currently use `vale sync`. If `.vale.ini` later adds a
third-party package, only that package's named generated directory under
`styles/` should be ignored. Do not ignore `.vale/`, `styles/`, `styles/Nook/`,
or `fixtures/` as a whole.

## Deletion gate

Before deleting a TypeScript or JavaScript validator, add real Vale 3.19
fixtures that prove all of the following:

- the exact admitted and excluded file set;
- positive and negative syntax cases, including case variants;
- the reported check, line, message, severity, and number of alerts; and
- the supported repository entrypoint that invokes Vale directly.

A raw-text approximation, custom Markdown parser, generated rule, or adapter
that translates Vale alerts back into the old typed result does not satisfy the
gate. Cross-block, cross-document, graph, link-resolution, codec, and product
behavior remain in their typed owners.

Exact equivalence remains the default deletion gate. A validator may instead
adopt Vale-native semantics only when the user explicitly authorizes that
change and fixtures record every scope, source-position, segmentation, and
cardinality delta. The native alert must remain intact; this exception does not
permit raw parsing, alert translation, or compatibility behavior.

## Migration inventory

All listed validators are owned by the AI team.

The repository-wide TypeScript inventory is complete for authored Markdown
validation. Every prose or exact-heading check that Vale 3.19 can express
natively has moved below under **Complete**. The residual TypeScript parsers
own Markdown structure, section state, document topology, link resolution, or
engine-invisible prose; their exact native blockers are recorded below so a
future Vale upgrade can be evaluated without repeating lossy prototypes.

- **Complete — exact Cortex navigation headings**
  - **Files:** `styles/Nook/CortexNavigation.yml` and
    `../.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/tests/vale-navigation.test.ts`.
  - **Contract:** In persistent non-graph Cortex documents, case-sensitive H2
    headings named exactly `Relationships` or `Document map` produce one alert
    at each heading line. H3 headings, case variants, prose, code, canonical
    knowledge graphs, executable-skill `scripts/`, `.session/`, and root
    `node_modules/` are excluded.
  - **Vale fit:** Exact native `heading.h2` existence rule with fixture-proven
    discovery, line, and cardinality.

- **Complete — Vale-native sentence density**
  - **Files:** `density.ini`, `styles/NookDensity/Semicolons.yml`,
    `styles/NookDensity/SentenceLength.yml`,
    `../agentic-ai/loom/src/lib/changed-cortex-density.ts`, and
    `../agentic-ai/loom/src/commands/cortex-audit.ts`.
  - **Contract:** The explicitly enabled full audit checks every admitted
    persistent Cortex document, including canonical knowledge graphs and
    excluding documents rejected for authored HTML. Changed-density checks
    exact changed admitted files and retains alerts whose native line is added.
  - **Vale-native deltas:** Vale 3.19 owns sentence segmentation, alert line,
    Unicode character counting, and one-alert-per-over-limit-sentence
    cardinality for both semicolon and 180-character limits. Native `sentence`
    scope includes ordinary and labeled blockquotes, table prose, and
    reader-visible link text. Inline-code width contributes to the native
    sentence-length count, while fenced code remains parser-excluded. Alerts
    retain their native check, file, line, message, and severity instead of
    becoming legacy density findings.

- **Blocked — rendered GFM tables**
  - **Files:**
    `../.cortex/teams/ai/dynamic-skills/cortex-article-structure/scripts/src/audit.ts`,
    its independent `verification.ts`, and
    `../agentic-ai/loom/src/lib/cortex-article-structure.ts`.
  - **Contract:** One typed finding per GFM table at the table opening line.
  - **Vale blocker:** Vale 3.19 exposes each nonempty table cell as a lint block,
    producing one alert per matching cell and no alert for an otherwise valid
    all-empty rendered table. It does not expose the table node needed for one
    opening-line finding. Raw delimiter matching would approximate the Markdown
    grammar.

- **Blocked — empty H2/H3 articles**
  - **Files:** article-structure `audit.ts` and `verification.ts` above.
  - **Contract:** One finding at an empty owning H2/H3 line after classifying
    visible, transparent, and structural descendant blocks.
  - **Vale blocker:** Requires owned-section and cross-block state.

- **Blocked — consecutive prose density**
  - **Files:** article-structure `audit.ts` and `verification.ts` above.
  - **Contract:** One finding at the fourth consecutive prose block in each
    run, with transparent nodes ignored and structural nodes or nested headings
    applying exact reset rules.
  - **Vale blocker:** Requires ordered cross-block state and typed resets.

- **Blocked — procedure sections without ordered actions**
  - **Files:** article-structure `audit.ts` and `verification.ts` above.
  - **Contract:** A case-insensitive procedure vocabulary selects owning H2/H3
    sections; one missing-list finding is reported at the heading line.
  - **Vale blocker:** Relates a heading to descendant list structure across a
    bounded section.

- **Blocked — authored Cortex HTML**
  - **Files:**
    `../.cortex/teams/ai/dynamic-skills/cortex-document-map/scripts/src/cortex-document-structure.ts`,
    `audit.ts`, and `verification.ts`.
  - **Contract:** One finding per Markdown AST HTML node at its opening line;
    escaped text, code, and autolinks pass, while invalid documents are omitted
    from topology processing.
  - **Vale blocker:** Prose scopes exclude markup. A raw regular expression is
    not equivalent to Markdown AST classification or its topology effect.

- **Blocked — Cortex document title**
  - **Files:** document-map `cortex-document-structure.ts` and
    `verification.ts` above.
  - **Contract:** One finding per invalid document when it does not contain
    exactly one H1 as the first root node, reported at the first H1 or line 1.
  - **Vale blocker:** Heading occurrence cannot also prove root-node order and
    the same fallback line.

- **Blocked — remaining prose sentence density**
  - **Files:** `../agentic-ai/loom/src/lib/density.ts` and
    `../agentic-ai/loom/tests/density.test.ts`.
  - **Contract:** Typed findings cover more than two `and` joins in a sentence
    over 120 characters. Findings use the containing paragraph or table-cell
    line; fenced code, labeled quoted output, and one-line link-only index cells
    retain exact exclusions.
  - **Vale blocker:** Vale-native sentence matching can express the length and
    join thresholds, but Vale 3.19 structurally hides GitHub alert bodies that
    this policy covers. Its JSON for occurrence rules also reports only the
    matched token and opening line, so a hard-wrapped sentence's ending line
    cannot be derived for changed-line filtering. Raw alert parsing or a typed
    sentence compatibility layer would recreate Markdown and Vale semantics.

- **Blocked — executable-skill frontmatter**
  - **Files:** `../agentic-ai/loom/src/executable-skills/repository.ts` and
    `../agentic-ai/loom/tests/executable-skills/repository.test.ts`.
  - **Contract:** Only tracked canonical executable packages are checked; YAML
    `name` must equal the directory slug and `description` must be a nonempty
    string.
  - **Vale blocker:** Frontmatter scopes cannot prove the package predicate,
    missing or non-string fields, and path-to-name equality with the same
    package-level cardinality.

- **Not a Vale rule — authority section markers**
  - **Files:** `../agentic-ai/loom/src/lib/markdown-contract.ts` with the module-
    and structural-expert audit callers.
  - **Contract:** Exact normalized markers must remain inside named bounded
    sections of specific authority documents.
  - **Boundary:** This is cross-block semantic contract validation.

- **Not a Vale rule — policy references and runtime commands**
  - **Files:** `../agentic-ai/loom/src/lib/cortex-contracts.ts` and
    `../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/audit.ts`.
  - **Contract:** Markdown links and definitions must bind policy imports to
    owned authority documents, while inline and fenced commands must agree with
    the registered required and retired runtime entrypoints.
  - **Boundary:** This is cross-document policy and runtime contract
    compilation, not prose style validation.

- **Not a Vale rule — indexes, locators, and fragments**
  - **Files:** `../agentic-ai/loom/src/commands/cortex-audit.ts` and
    `../agentic-ai/loom/src/lib/cortex-identifiers.ts`.
  - **Contract:** Catalog membership, canonical paths, ownership, targets, and
    heading fragments must agree across files.
  - **Boundary:** This is cross-document graph and link resolution.

Markdown rendering, generated Markdown views, pull-request or API formatting,
and product business behavior are intentionally outside this ledger.
