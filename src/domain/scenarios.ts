import type { MacroShock, Regime, RegimeConfig, SimulationConfig } from "./types";
import { SeededRNG } from "../infra/rng";

interface RegimeMap {
  [key: string]: RegimeConfig;
}

export function generateScenarios(
  config: SimulationConfig,
  regimes: RegimeMap,
  rng: SeededRNG
): MacroShock[] {
  const scenarios: MacroShock[] = [];
  const enabledRegimes = config.regimesEnabled;

  // Build CDF for regime sampling
  const regimeEntries = enabledRegimes.map((r) => ({
    regime: r,
    config: regimes[r],
  }));
  const totalProb = regimeEntries.reduce((s, e) => s + e.config.probability, 0);
  const cdf: { regime: Regime; cumProb: number }[] = [];
  let cum = 0;
  for (const entry of regimeEntries) {
    cum += entry.config.probability / totalProb;
    cdf.push({ regime: entry.regime, cumProb: cum });
  }

  for (let i = 0; i < config.numScenarios; i++) {
    // Sample regime
    const u = rng.next();
    let regime: Regime = cdf[cdf.length - 1].regime;
    for (const entry of cdf) {
      if (u <= entry.cumProb) {
        regime = entry.regime;
        break;
      }
    }

    const regimeConf = regimes[regime];
    const volMult = regimeConf.volMultiplier;

    // Generate macro factor shocks
    // Base distributions (annualized shocks)
    const rateChange = rng.nextGaussian() * 100 * volMult; // bps, ~100bps std
    const inflationShock = rng.nextGaussian() * 2.0 * volMult; // ~2% std
    const growthShock = rng.nextGaussian() * 2.5 * volMult; // ~2.5% std
    const riskOffShock = rng.nextGaussian() * 1.0 * volMult;

    // Apply correlation overrides by regime
    // In stress_2022: rates and inflation co-move, so if rates are up inflation is up
    let adjInflation = inflationShock;
    let adjRiskOff = riskOffShock;

    if (regime === "stress_2022") {
      // Correlation override: rate and inflation co-move
      adjInflation = inflationShock * 0.4 + (rateChange / 100) * 0.6;
      adjRiskOff = riskOffShock * 0.5 + Math.abs(rateChange / 100) * 0.5;
    } else if (regime === "stagflation") {
      // High inflation but negative growth
      adjInflation = Math.abs(inflationShock) * volMult;
      adjRiskOff = riskOffShock * 0.3 + Math.abs(adjInflation) * 0.3;
    } else if (regime === "deflation") {
      // Strong risk-off
      adjRiskOff = Math.abs(riskOffShock) * volMult;
      adjInflation = -Math.abs(inflationShock);
    }

    // Occasional jump mutations (tail events)
    let mutatedRate = rateChange;
    if (rng.next() < 0.05) {
      // 5% chance of a +/- 200-400bps jump
      mutatedRate += (rng.next() > 0.5 ? 1 : -1) * (200 + rng.next() * 200);
    }

    scenarios.push({
      rateChange: mutatedRate,
      inflationShock: adjInflation,
      growthShock: growthShock,
      riskOffShock: adjRiskOff,
      regime,
    });
  }

  return scenarios;
}
