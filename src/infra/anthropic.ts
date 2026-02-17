import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatMessage,
  ChatResponse,
  Portfolio,
  SimulationSummary,
  AssetClass,
} from "../domain/types";
import { ASSET_LABELS } from "../domain/types";

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
const client = hasApiKey ? new Anthropic() : null;

const SYSTEM_PROMPT = `You are an AI Portfolio Risk Coach. You help investors build resilient, diversified portfolios that can withstand market stress scenarios.

You have access to a genetic/evolutionary portfolio optimizer that:
- Takes a seed portfolio and breeds mutations, crosses them, applies adversarial stress testing
- Runs thousands of Monte Carlo simulations per generation across 4 market regimes (Normal, 2022-style crash, Stagflation, Deflation)
- Selects survivors based on risk-adjusted fitness (Sharpe, CVaR, drawdown, returns)
- Identifies specific vulnerabilities through adversarial scenario generation

Your expertise includes:
- Asset allocation and portfolio construction
- Risk management and tail risk analysis
- Correlation dynamics (especially how correlations break down in crises like 2022)
- Fixed income duration risk vs. credit risk
- Inflation hedging strategies
- Interpreting evolutionary optimization results and adversarial findings

Key principles:
1. NEVER recommend specific securities or ETFs by ticker — focus on asset class allocation
2. Always explain WHY a scenario is dangerous, not just that it is
3. When the evolution engine has found a better portfolio, explain what changed and why it's more resilient
4. Be direct about risks — don't sugar-coat. Investors need honesty.
5. Reference the simulation/evolution data when available to back up your points
6. Highlight correlation breakdown risks — the 2022 scenario where stocks AND bonds fell together is critical
7. When adversarial findings are present, walk through each vulnerability and what the evolution did to address it
8. Compare the user's original portfolio vs the evolved champion — highlight what the optimizer discovered that a human might miss

Format your responses with clear headers and bullet points for readability. Keep responses focused and actionable.`;

function formatSummaryForPrompt(summary: SimulationSummary): string {
  const m = summary.metrics;
  const flags = summary.tailFlags;

  let text = `## Simulation Results (${summary.config.numScenarios} scenarios, ${summary.config.horizonMonths} month horizon)

### Portfolio Allocation
${Object.entries(summary.portfolio.allocations)
  .filter(([_, v]) => v > 0)
  .map(([k, v]) => `- ${ASSET_LABELS[k as AssetClass]}: ${(v * 100).toFixed(1)}%`)
  .join("\n")}

### Return Distribution
- 5th percentile (worst case): ${(m.p5Return * 100).toFixed(1)}%
- 25th percentile: ${(m.p25Return * 100).toFixed(1)}%
- Median return: ${(m.p50Return * 100).toFixed(1)}%
- 75th percentile: ${(m.p75Return * 100).toFixed(1)}%
- 95th percentile (best case): ${(m.p95Return * 100).toFixed(1)}%
- Mean return: ${(m.meanReturn * 100).toFixed(1)}%
- Volatility: ${(m.stdDev * 100).toFixed(1)}%

### Risk Metrics
- Sharpe Ratio: ${m.sharpeRatio.toFixed(2)}
- Max Drawdown: ${(m.maxDrawdown * 100).toFixed(1)}%
- CVaR (95%): ${(m.cvar95 * 100).toFixed(1)}%
- Probability of Loss: ${(m.probLoss * 100).toFixed(1)}%

### Risk Flags
${flags.correlationBreakdown ? "⚠️ CORRELATION BREAKDOWN DETECTED: Stocks and bonds may crash together (2022-style scenario)" : "✅ No correlation breakdown detected"}
${flags.rateShockRisk ? "⚠️ DURATION RISK: Significant long-term bond exposure vulnerable to rate hikes" : "✅ Limited duration risk"}
${flags.inflationShockRisk ? "⚠️ INFLATION RISK: Heavy bond allocation without TIPS protection" : "✅ Inflation hedging adequate"}
${flags.concentrationRisk ? "⚠️ CONCENTRATION RISK: Over 40% in a single asset class" : "✅ Diversification adequate"}

### Worst 3 Scenarios
${summary.worstScenarios
  .map(
    (s, i) =>
      `${i + 1}. Return: ${(s.portfolioReturn * 100).toFixed(1)}% | Regime: ${s.macro.regime} | Rate Δ: ${s.macro.rateChange.toFixed(0)}bps | Inflation: ${s.macro.inflationShock.toFixed(1)}%`
  )
  .join("\n")}

### Best 3 Scenarios
${summary.bestScenarios
  .map(
    (s, i) =>
      `${i + 1}. Return: ${(s.portfolioReturn * 100).toFixed(1)}% | Regime: ${s.macro.regime}`
  )
  .join("\n")}`;

  return text;
}

export async function analyzePortfolio(
  message: string,
  portfolio: Portfolio,
  simSummary: SimulationSummary | undefined,
  history: ChatMessage[]
): Promise<ChatResponse> {
  if (!client) {
    return {
      reply:
        "⚠️ **AI Risk Coach is not configured.** The evolution engine and simulations work without it, but to get AI-powered analysis you need to:\n\n1. Get an API key from [console.anthropic.com](https://console.anthropic.com)\n2. Create a `.env` file in the project root\n3. Add: `ANTHROPIC_API_KEY=sk-ant-your-key-here`\n4. Restart the server\n\nThe evolutionary optimizer and adversarial stress testing work fully without the AI — you just won't get the natural language analysis.",
    };
  }

  const messages: Anthropic.MessageParam[] = [];

  // Add history
  for (const msg of history.slice(-10)) {
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  }

  // Build user message with context
  let userContent = message;
  if (simSummary) {
    userContent = `${formatSummaryForPrompt(simSummary)}\n\n---\n\nUser question: ${message}`;
  }

  messages.push({ role: "user", content: userContent });

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages,
  });

  const reply =
    response.content[0].type === "text" ? response.content[0].text : "";

  return { reply };
}
