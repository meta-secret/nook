// prettier-ignore
const normalize = ({ node }) => {
  const [rest, ...trailing] = node.params;
  if (rest?.type !== 'RestElement' || rest.argument?.type !== 'ArrayPattern' || rest.argument.elements.length !== 1) return;
  const [value] = rest.argument.elements;
  if (value?.type === 'AssignmentPattern' && value.left?.type === 'Identifier' && node.body?.type === 'Identifier' && node.body.name === value.left.name) node.params = [value, ...trailing];
};

module.exports = () => ({
  visitor: {
    ArrowFunctionExpression: normalize,
  },
});
