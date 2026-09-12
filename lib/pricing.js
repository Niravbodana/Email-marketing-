// USD per 1,000,000 tokens. Update this if Anthropic's pricing changes or a different
// model is used — see https://docs.claude.com/en/docs/about-claude/pricing for current rates.
const PRICING = {
  'claude-sonnet-5': { input: 2.0, output: 10.0 }
};

function calcCostUsd(model, inputTokens, outputTokens) {
  const rates = PRICING[model] || PRICING['claude-sonnet-5'];
  return (inputTokens / 1e6) * rates.input + (outputTokens / 1e6) * rates.output;
}

module.exports = { PRICING, calcCostUsd };
