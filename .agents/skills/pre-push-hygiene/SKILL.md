---
name: pre-push-hygiene
description: >-
  Always host-apply task format and pass the UI demo contract before every Nook
  PR push. Use when committing, pushing, fixing CI format/demo failures, or when
  sealed-image Prettier/rustfmt lag would otherwise burn a Verify cycle.
---

# Pre-Push Hygiene

Read and follow the canonical project skill at
[`.cortex/sre/dynamic-skills/pre-push-hygiene.md`](../../../.cortex/sre/dynamic-skills/pre-push-hygiene.md).

## Quick commands

```bash
task loom:pre-push
```

Do not use `task extension:format` alone — it does not write the host tree.

After Loom, commit and push.

Use `task remote` for focused hosted execution.

Use `task pr:validate` for the explicit complete gate.

Do not run heavy agent builds/tests locally.
