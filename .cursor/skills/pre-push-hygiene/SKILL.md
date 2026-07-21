---
name: pre-push-hygiene
description: >-
  Always host-apply task format and pass the UI demo contract before every Nook
  PR push. Use when committing, pushing, fixing CI format/demo failures, or when
  sealed-image Prettier/rustfmt lag would otherwise burn a Verify cycle.
---

# Pre-Push Hygiene

Read and follow the canonical project skill at
[`.cortex/dynamic-skills/pre-push-hygiene.md`](../../../.cortex/dynamic-skills/pre-push-hygiene.md).

## Quick commands

```bash
task format   # sealed format + apply to host — always, unconditionally
git add -u
git fetch origin main
.github/scripts/ui-demo-contract.sh "$(git rev-parse origin/main)"  # when UI paths change
```

Do not use `task extension:format` alone — it does not write the host tree.
