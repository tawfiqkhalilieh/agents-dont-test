import { parse } from 'acorn';

export const slot = index => `// assertion-enricher:start:${index}\n// assertion-enricher:end:${index}`;
const blocks = /\/\/ assertion-enricher:start:(\d+)\n([\s\S]*?)\/\/ assertion-enricher:end:\1/g;
const matchers = new Set(['toBeVisible','toBeHidden','toHaveText','toContainText','toHaveCount','toHaveValue','toBeChecked','toHaveURL']);
const locators = new Set(['locator','frameLocator','getByRole','getByTestId','getByLabel','getByText','getByPlaceholder','filter']);
const literal = node => {
  if (!node) return false;
  if (node.type === 'Literal') return !node.regex && ['string','number','boolean'].includes(typeof node.value);
  if (node.type === 'ArrayExpression') return node.elements.every(literal);
  if (node.type === 'ObjectExpression') return node.properties.every(p => p.type === 'Property' && !p.computed && !p.method && !p.shorthand && p.kind === 'init' && ['Identifier','Literal'].includes(p.key.type) && literal(p.value));
  return false;
};
function method(node) {
  if (node?.type !== 'CallExpression' || node.optional || node.callee.type !== 'MemberExpression' || node.callee.computed || node.callee.optional) return null;
  return node.callee.property.name;
}
function locator(node, pageIds) {
  if (!node?.arguments?.every(literal)) return false;
  const name = method(node);
  if (name === 'get' && node.callee.object.type === 'Identifier' && node.callee.object.name === 'pages') {
    return node.arguments.length === 1 && pageIds.has(node.arguments[0].value);
  }
  return locators.has(name) && locator(node.callee.object, pageIds);
}
export function validateCandidate(candidate, template, recording) {
  const restore = text => text.replace(blocks, (_, id) => slot(id));
  if (restore(candidate) !== template) throw new Error('The subagent changed code outside assertion slots');
  const pageIds = new Set(recording.events.filter(e => ['page','popup'].includes(e.type)).map(e => e.page));
  let assertions = 0, outcomes = 0;
  const matcherCounts = {};
  for (const [, index, code] of candidate.matchAll(blocks)) {
    const ast = parse(code, {ecmaVersion:'latest',sourceType:'module'});
    for (const statement of ast.body) {
      const call = statement.type === 'ExpressionStatement' && statement.expression.type === 'AwaitExpression' && statement.expression.argument;
      const matcher = method(call);
      const expect = call?.callee?.object;
      if (!matchers.has(matcher) || expect?.type !== 'CallExpression' || expect.callee.type !== 'Identifier' || expect.callee.name !== 'expect' || expect.arguments.length < 1 || expect.arguments.length > 2 || !locator(expect.arguments[0],pageIds) || (expect.arguments[1] && !literal(expect.arguments[1])) || !call.arguments.every(literal)) {
        throw new Error(`Slot ${index} must contain only awaited Playwright expect assertions with literal arguments`);
      }
      if (matcher.startsWith('toHave') || matcher === 'toContainText') {
        if (!call.arguments.length) throw new Error(`Missing expected value in slot ${index}`);
        outcomes++;
      }
      assertions++;
      matcherCounts[matcher] = (matcherCounts[matcher] || 0) + 1;
    }
  }
  if (!assertions || !outcomes) throw new Error('No meaningful text, count, value, or URL assertion was added');
  return {assertions, outcomes, matcherCounts};
}
