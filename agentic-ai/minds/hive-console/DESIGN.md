# Hive Control Center design system

The Control Center is an Operate surface. It extends Nook's restrained neutral
system into a dense operational workspace where state, recency, and dependency
relationships carry the visual hierarchy.

## Surface

- Use the incumbent Nook light and dark semantic color values.
- Separate navigation, queue, and detail regions with tonal surfaces and
  hairline rules rather than nested cards.
- Reserve saturated color for failure, blocking, warning, and healthy-running
  state. Never use color as the only state signal.
- Use one system sans family for labels, content, and data; use monospace only
  for task identifiers and Git revisions.

## Composition

- Desktop is a three-part operational workspace: worker rail, task queue, and
  selected-task inspector.
- Compact layouts collapse the worker rail into a horizontal status band and
  place task detail after the queue.
- The first viewport answers three questions in order: is Hive healthy, what is
  running, and what needs attention.
- Task rows are the primary repeated object. Avoid card grids and metric tiles.

## Components and states

- Status labels combine text with a restrained shape or icon.
- Loading preserves the final layout with skeleton rows.
- Empty state teaches what will make data appear.
- Unavailable state names the observer problem and offers one retry.
- Timeline entries use a continuous rule and semantic event glyphs; activity is
  newest first.
- Focus rings use the incumbent Nook ring token and remain visible in both
  themes.

## Motion

Use 160–220 ms opacity and position transitions only when task selection or
live state changes. Honor reduced motion. Never animate idle indicators
continuously.
