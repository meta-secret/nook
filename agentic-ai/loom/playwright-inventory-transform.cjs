module.exports = ({ types: t }) => ({
  visitor: {
    // prettier-ignore
    ArrowFunctionExpression({ node }) {
      const [rest] = node.params;
      if (node.params.length !== 1 || !t.isRestElement(rest) || !t.isArrayPattern(rest.argument) || rest.argument.elements.length !== 1) return;
      const [value] = rest.argument.elements;
      if (t.isAssignmentPattern(value) && t.isIdentifier(value.left) && t.isIdentifier(node.body, { name: value.left.name })) node.params = [value];
    },
  },
});
