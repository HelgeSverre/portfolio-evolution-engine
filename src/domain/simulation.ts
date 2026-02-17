import type {
  AssetAssumptions,
  AssetClass,
  MacroShock,
  Portfolio,
  ScenarioResult,
  SimulationConfig,
  SimulationSummary,
} from "./types";
import { ASSET_LABELS } from "./types";
import { SeededRNG } from "../infra/rng";
import { generateScenarios } from "./scenarios";
import { mean, percentile, stddev } from "../infra/stats";
import assumptions from "../../data/assumptions.json";

const ASSETS = Object.keys(assumptions.assets) as AssetClass[];

export function runMonteCarlo(
  portfolio: Portfolio,
  config: SimulationConfig,
  seed?: number
): SimulationSummary {
  const rng = new SeededRNG(seed ?? Date.now());
  const assetData = assumptions.assets as Record<AssetClass, AssetAssumptions>;
  const regimes = assumptions.regimes;

  const scenarios = generateScenarios(config, regimes, rng);
  const results: ScenarioResult[] = [];

  const monthlySteps = config.horizonMonths;
  const dt = 1 / 12;

  for (let i = 0; i < scenarios.length; i++) {
    const macro = scenarios[i];
    const assetReturns: Record<string, number> = {};

    // Compute per-asset returns from factor model
    for (const asset of ASSETS) {
      if ((portfolio.allocations[asset] ?? 0) === 0) continue;

      const a = assetData[asset];
      const factorReturn =
        a.betaRate * (macro.rateChange / 100) +
        a.betaInflation * (macro.inflationShock / 10) +
        a.betaGrowth * (macro.growthShock / 10) +
        a.betaRiskOff * macro.riskOffShock;

      // Add idiosyncratic noise
      const idioVol = a.volatility * 0.5; // ~half of vol is idiosyncratic
      const idioNoise = rng.nextGaussian() * idioVol * Math.sqrt(monthlySteps * dt);

      const totalReturn =
        a.expectedReturn * (monthlySteps * dt) + factorReturn + idioNoise;

      assetReturns[asset] = totalReturn;
    }

    // Build monthly wealth path
    const path: number[] = [1.0];
    const monthlyReturn =
      Object.entries(portfolio.allocations).reduce(
        (sum, [asset, weight]) =>
          sum + weight * (assetReturns[asset] ?? 0),
        0
      ) / monthlySteps;

    for (let m = 1; m <= monthlySteps; m++) {
      // Add some path noise for realism
      const noise = rng.nextGaussian() * 0.01;
      path.push(path[m - 1] * (1 + monthlyReturn + noise));
    }

    // Compute drawdown
    let peak = path[0];
    let maxDD = 0;
    for (const val of path) {
      if (val > peak) peak = val;
      const dd = (peak - val) / peak;
      if (dd > maxDD) maxDD = dd;
    }

    const portfolioReturn = path[path.length - 1] / path[0] - 1;

    results.push({
      scenarioId: i,
      macro,
      assetReturns: assetReturns as Record<AssetClass, number>,
      portfolioReturn,
      drawdown: maxDD,
      path,
    });
  }

  // Sort by return for analytics
  const returns = results.map((r) => r.portfolioReturn).sort((a, b) => a - b);

  // Tail risk: CVaR (expected shortfall) at 95%
  const cutoff = Math.floor(returns.length * 0.05);
  const tailReturns = returns.slice(0, cutoff);
  const cvar95 = mean(tailReturns);

  const riskFreeRate = 0.04 * (config.horizonMonths / 12);
  const avgReturn = mean(returns);
  const vol = stddev(returns);
  const sharpe = vol > 0 ? (avgReturn - riskFreeRate) / vol : 0;

  // Correlation matrix (realized)
  const activeAssets = ASSETS.filter(
    (a) => (portfolio.allocations[a] ?? 0) > 0
  );
  const corrMatrix: Record<string, Record<string, number>> = {};
  for (const a1 of activeAssets) {
    corrMatrix[a1] = {};
    const r1 = results.map((r) => r.assetReturns[a1] ?? 0);
    const m1 = mean(r1);
    const s1 = stddev(r1);
    for (const a2 of activeAssets) {
      const r2 = results.map((r) => r.assetReturns[a2] ?? 0);
      const m2 = mean(r2);
      const s2 = stddev(r2);
      if (s1 > 0 && s2 > 0) {
        const cov =
          r1.reduce((sum, v, idx) => sum + (v - m1) * (r2[idx] - m2), 0) /
          r1.length;
        corrMatrix[a1][a2] = cov / (s1 * s2);
      } else {
        corrMatrix[a1][a2] = a1 === a2 ? 1 : 0;
      }
    }
  }

  // Tail flags
  const hasEquities =
    (portfolio.allocations.usEquities ?? 0) > 0 ||
    (portfolio.allocations.intlEquities ?? 0) > 0;
  const hasBonds = (portfolio.allocations.longTermBonds ?? 0) > 0;
  const equityKey = portfolio.allocations.usEquities > 0 ? "usEquities" : "intlEquities";
  const bondKey = "longTermBonds";

  const stockBondCorr =
    hasEquities && hasBonds
      ? corrMatrix[equityKey]?.[bondKey] ?? 0
      : 0;

  const maxAlloc = Math.max(...Object.values(portfolio.allocations));
  const hasLongDuration = (portfolio.allocations.longTermBonds ?? 0) > 0.15;

  // Return distribution histogram (20 buckets)
  const minR = returns[0];
  const maxR = returns[returns.length - 1];
  const bucketSize = (maxR - minR) / 20 || 0.01;
  const histogram = new Array(20).fill(0);
  for (const r of returns) {
    const bucket = Math.min(19, Math.floor((r - minR) / bucketSize));
    histogram[bucket]++;
  }

  // Sort by return to pick worst/best/median
  const sorted = [...results].sort(
    (a, b) => a.portfolioReturn - b.portfolioReturn
  );

  return {
    runId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    portfolio,
    config,
    metrics: {
      p5Return: percentile(returns, 5),
      p25Return: percentile(returns, 25),
      p50Return: percentile(returns, 50),
      p75Return: percentile(returns, 75),
      p95Return: percentile(returns, 95),
      meanReturn: avgReturn,
      stdDev: vol,
      sharpeRatio: sharpe,
      maxDrawdown: Math.max(...results.map((r) => r.drawdown)),
      cvar95,
      probLoss: returns.filter((r) => r < 0).length / returns.length,
    },
    tailFlags: {
      correlationBreakdown: stockBondCorr > 0.2,
      rateShockRisk: hasLongDuration,
      inflationShockRisk:
        (portfolio.allocations.longTermBonds ?? 0) > 0.2 &&
        (portfolio.allocations.tips ?? 0) < 0.1,
      concentrationRisk: maxAlloc > 0.4,
      durationRisk: hasLongDuration,
    },
    worstScenarios: sorted.slice(0, 3),
    bestScenarios: sorted.slice(-3).reverse(),
    medianScenario: sorted[Math.floor(sorted.length / 2)],
    returnDistribution: histogram,
    correlationMatrix: corrMatrix,
  };
}
