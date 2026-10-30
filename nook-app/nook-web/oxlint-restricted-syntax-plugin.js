// Oxlint has no native `no-restricted-syntax`. This JS plugin runs the same
// ESLint selector options through oxlint's ESLint-compatible selector engine,
// so `typed-api-rules.js` keeps one selector list for oxlint and ESLint.

/** @typedef {{ selector: string, message?: string }} RestrictedSyntaxEntry */
/** @typedef {string | RestrictedSyntaxEntry} RestrictedSyntaxOption */
/** @typedef {{ options: readonly RestrictedSyntaxOption[], report: (descriptor: { node: import('@typescript-eslint/types').TSESTree.Node, message: string }) => void }} RestrictedSyntaxContext */

/** @param {RestrictedSyntaxOption} option @returns {RestrictedSyntaxEntry} */
function restrictedSyntaxEntry(option) {
  return typeof option === "string" ? { selector: option } : option;
}

const noRestrictedSyntaxRule = {
  meta: {
    type: "suggestion",
    schema: {
      type: "array",
      items: {
        oneOf: [
          { type: "string" },
          {
            type: "object",
            properties: {
              selector: { type: "string" },
              message: { type: "string" },
            },
            required: ["selector"],
            additionalProperties: false,
          },
        ],
      },
      uniqueItems: true,
      minItems: 0,
    },
  },
  /** @param {RestrictedSyntaxContext} context */
  create(context) {
    /** @type {Record<string, (node: import('@typescript-eslint/types').TSESTree.Node) => void>} */
    const listeners = {};
    for (const option of context.options) {
      const {
        selector,
        message: text = `Using '${selector}' is not allowed.`,
      } = restrictedSyntaxEntry(option);
      const previous = listeners[selector];
      listeners[selector] = (node) => {
        previous?.(node);
        context.report({ node, message: text });
      };
    }
    return listeners;
  },
};

export default {
  meta: { name: "nook-syntax" },
  rules: { "no-restricted-syntax": noRestrictedSyntaxRule },
};
