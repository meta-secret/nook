// Oxlint JS plugin for the Nook typed-API rule that needs no type
// information. The type-aware success-contract rule cannot run inside an
// oxlint JS plugin; `named-success-contract-check.ts` runs it on TypeScript 7.
import { noRawObjectArgumentsRule } from "./no-raw-object-arguments-rule.js";

export default {
  meta: { name: "nook-typed-api" },
  rules: { "no-raw-object-arguments": noRawObjectArgumentsRule },
};
