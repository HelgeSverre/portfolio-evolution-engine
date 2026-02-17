import type { AssetClass, Portfolio, SimulationConfig, SimulationSummary } from "./types";
import { runMonteCarlo } from "./simulation";
import { SeededRNG } from "../infra/rng";

const ALL_ASSETS: AssetClass[] = [
  "usEquities", "intlEquities", "emergingEquities",
  "longTermBonds", "shortTermBonds", "tips",
  "reits", "commodities", "gold", "cash",
];

export interface EvolutionConfig {
  populationSize: number;      // how many portfolio variants per generation
  generations: number;         // how many rounds of evolution
  mutationRate: number;        // 0-1, how aggressively to mutate
  crossoverRate: number;       // 0-1, how often to breed two portfolios
  eliteCount: number;          // top N survive unchanged
  fitnessWeights: {
    sharpe: number;
    cvar: number;              // penalize tail risk (negative = penalty)
    maxDrawdown: number;       // penalize drawdown (negative = penalty)
    returnMean: number;
  };
  adversarialPressure: number; // 0-1, how much to bias toward stress regimes
  simConfig: SimulationConfig;
  seed?: number;
}

export interface EvolvedPortfolio {
  portfolio: Portfolio;
  fitness: number;
  summary: SimulationSummary;
  generation: number;
  parentage: string; // how it was created
}

export interface GenerationSnapshot {
  generation: number;
  best: EvolvedPortfolio;
  worst: EvolvedPortfolio;
  median: EvolvedPortfolio;
  avgFitness: number;
  diversity: number; // how different the population is
  population: EvolvedPortfolio[];
}

export interface EvolutionResult {
  generations: GenerationSnapshot[];
  champion: EvolvedPortfolio;
  hallOfFame: EvolvedPortfolio[]; // top 5 unique strategies found
  adversarialFindings: AdversarialFinding[];
}

export interface AdversarialFinding {
  description: string;
  vulnerability: string;
  regime: string;
  worstReturn: number;
  affectedAssets: string[];
}

/** Normalize allocations to sum to 1, clamp negatives */
function normalize(allocs: Record<AssetClass, number>): Record<AssetClass, number> {
  const result = { ...allocs };
  for (const k of ALL_ASSETS) {
    result[k] = Math.max(0, result[k] ?? 0);
  }
  const total = Object.values(result).reduce((s, v) => s + v, 0);
  if (total === 0) {
    // Fallback: equal weight
    for (const k of ALL_ASSETS) result[k] = 1 / ALL_ASSETS.length;
  } else {
    for (const k of ALL_ASSETS) result[k] /= total;
  }
  // Snap tiny values to 0 and renormalize
  for (const k of ALL_ASSETS) {
    if (result[k] < 0.02) result[k] = 0;
  }
  const total2 = Object.values(result).reduce((s, v) => s + v, 0);
  for (const k of ALL_ASSETS) result[k] /= total2;
  // Round to nearest 0.5%
  for (const k of ALL_ASSETS) {
    result[k] = Math.round(result[k] * 200) / 200;
  }
  // Final normalize after rounding
  const total3 = Object.values(result).reduce((s, v) => s + v, 0);
  if (total3 > 0) for (const k of ALL_ASSETS) result[k] /= total3;
  return result;
}

/** Compute fitness score for a simulation result */
function computeFitness(
  summary: SimulationSummary,
  weights: EvolutionConfig["fitnessWeights"]
): number {
  return (
    weights.sharpe * summary.metrics.sharpeRatio +
    weights.cvar * Math.abs(summary.metrics.cvar95) * -1 + // penalize bad CVaR
    weights.maxDrawdown * summary.metrics.maxDrawdown * -1 + // penalize drawdown
    weights.returnMean * summary.metrics.meanReturn
  );
}

/** Mutate a portfolio allocation */
function mutate(
  allocs: Record<AssetClass, number>,
  rate: number,
  rng: SeededRNG
): Record<AssetClass, number> {
  const result = { ...allocs };
  const mutationType = rng.next();

  if (mutationType < 0.3) {
    // Point mutation: shift weight from one asset to another
    const from = ALL_ASSETS[Math.floor(rng.next() * ALL_ASSETS.length)];
    const to = ALL_ASSETS[Math.floor(rng.next() * ALL_ASSETS.length)];
    const amount = rng.next() * rate * 0.3;
    result[from] = Math.max(0, (result[from] ?? 0) - amount);
    result[to] = (result[to] ?? 0) + amount;
  } else if (mutationType < 0.55) {
    // Gaussian noise on all weights
    for (const k of ALL_ASSETS) {
      result[k] = (result[k] ?? 0) + rng.nextGaussian() * rate * 0.1;
    }
  } else if (mutationType < 0.7) {
    // Swap: exchange weights of two assets
    const a = ALL_ASSETS[Math.floor(rng.next() * ALL_ASSETS.length)];
    const b = ALL_ASSETS[Math.floor(rng.next() * ALL_ASSETS.length)];
    const tmp = result[a];
    result[a] = result[b];
    result[b] = tmp;
  } else if (mutationType < 0.85) {
    // Zero-out: kill one position and redistribute
    const kill = ALL_ASSETS[Math.floor(rng.next() * ALL_ASSETS.length)];
    const amount = result[kill] ?? 0;
    result[kill] = 0;
    const remaining = ALL_ASSETS.filter((a) => a !== kill && (result[a] ?? 0) > 0);
    if (remaining.length > 0) {
      const target = remaining[Math.floor(rng.next() * remaining.length)];
      result[target] = (result[target] ?? 0) + amount;
    }
  } else {
    // Regime-aware mutation: boost hedges
    // If we're being adversarial, increase inflation/rate hedges
    const hedges: AssetClass[] = ["tips", "commodities", "gold", "shortTermBonds"];
    const risky: AssetClass[] = ["usEquities", "intlEquities", "emergingEquities", "longTermBonds"];
    const hedge = hedges[Math.floor(rng.next() * hedges.length)];
    const risk = risky[Math.floor(rng.next() * risky.length)];
    const shift = rng.next() * rate * 0.2;
    result[risk] = Math.max(0, (result[risk] ?? 0) - shift);
    result[hedge] = (result[hedge] ?? 0) + shift;
  }

  return normalize(result);
}

/** Crossover: blend two portfolios */
function crossover(
  a: Record<AssetClass, number>,
  b: Record<AssetClass, number>,
  rng: SeededRNG
): Record<AssetClass, number> {
  const result: Record<string, number> = {};
  const crossType = rng.next();

  if (crossType < 0.5) {
    // Uniform crossover: each asset randomly from parent A or B
    for (const k of ALL_ASSETS) {
      result[k] = rng.next() < 0.5 ? (a[k] ?? 0) : (b[k] ?? 0);
    }
  } else {
    // Blend crossover: weighted average with random blend factor
    const alpha = 0.2 + rng.next() * 0.6; // blend between 0.2 and 0.8
    for (const k of ALL_ASSETS) {
      result[k] = alpha * (a[k] ?? 0) + (1 - alpha) * (b[k] ?? 0);
    }
  }

  return normalize(result as Record<AssetClass, number>);
}

/** Generate a completely random portfolio */
function randomPortfolio(rng: SeededRNG): Record<AssetClass, number> {
  const result: Record<string, number> = {};
  for (const k of ALL_ASSETS) {
    result[k] = rng.next();
  }
  return normalize(result as Record<AssetClass, number>);
}

/** Measure population diversity (avg pairwise distance) */
function measureDiversity(pop: EvolvedPortfolio[]): number {
  if (pop.length < 2) return 0;
  let totalDist = 0;
  let pairs = 0;
  for (let i = 0; i < Math.min(pop.length, 20); i++) {
    for (let j = i + 1; j < Math.min(pop.length, 20); j++) {
      let dist = 0;
      for (const k of ALL_ASSETS) {
        const diff = (pop[i].portfolio.allocations[k] ?? 0) - (pop[j].portfolio.allocations[k] ?? 0);
        dist += diff * diff;
      }
      totalDist += Math.sqrt(dist);
      pairs++;
    }
  }
  return pairs > 0 ? totalDist / pairs : 0;
}

/** Detect adversarial findings from worst scenarios */
function detectAdversarial(pop: EvolvedPortfolio[]): AdversarialFinding[] {
  const findings: AdversarialFinding[] = [];
  const seen = new Set<string>();

  for (const ind of pop) {
    for (const worst of ind.summary.worstScenarios) {
      const key = `${worst.macro.regime}-${Math.sign(worst.macro.rateChange)}-${Math.sign(worst.macro.inflationShock)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (worst.portfolioReturn < -0.15) {
        // Find which assets got hit worst
        const assetLosses = Object.entries(worst.assetReturns)
          .filter(([_, r]) => r < -0.1)
          .sort((a, b) => a[1] - b[1])
          .slice(0, 3);

        let vulnerability = "";
        if (worst.macro.regime === "stress_2022") {
          vulnerability = "Correlation breakdown: traditional diversification fails as stocks and bonds crash together";
        } else if (worst.macro.regime === "stagflation") {
          vulnerability = "Stagflation trap: inflation erodes bonds while weak growth crushes equities";
        } else if (worst.macro.regime === "deflation") {
          vulnerability = "Deflationary spiral: growth collapse with flight-to-quality crushing risk assets";
        } else {
          vulnerability = `Extreme ${worst.macro.rateChange > 100 ? "rate hike" : worst.macro.rateChange < -100 ? "rate cut" : "volatility"} scenario`;
        }

        findings.push({
          description: `${worst.macro.regime} regime: rates ${worst.macro.rateChange > 0 ? "+" : ""}${worst.macro.rateChange.toFixed(0)}bps, inflation ${worst.macro.inflationShock > 0 ? "+" : ""}${worst.macro.inflationShock.toFixed(1)}%`,
          vulnerability,
          regime: worst.macro.regime,
          worstReturn: worst.portfolioReturn,
          affectedAssets: assetLosses.map(([k]) => k),
        });
      }
    }
  }

  return findings.sort((a, b) => a.worstReturn - b.worstReturn).slice(0, 5);
}

/** Run the full evolutionary optimization */
export function evolvePortfolio(
  seedPortfolio: Portfolio,
  config: EvolutionConfig
): EvolutionResult {
  const rng = new SeededRNG(config.seed ?? Date.now());
  const generations: GenerationSnapshot[] = [];
  const hallOfFame: EvolvedPortfolio[] = [];

  // Initialize population: seed portfolio + mutations + randoms
  let population: EvolvedPortfolio[] = [];

  // Adversarial sim config: bias toward stress regimes
  const adversarialSimConfig: SimulationConfig = {
    ...config.simConfig,
    regimesEnabled:
      config.adversarialPressure > 0.5
        ? ["stress_2022", "stagflation", "deflation", "normal"]
        : config.simConfig.regimesEnabled,
  };

  // Generate initial population
  for (let i = 0; i < config.populationSize; i++) {
    let allocs: Record<AssetClass, number>;
    if (i === 0) {
      allocs = { ...seedPortfolio.allocations };
    } else if (i < config.populationSize * 0.5) {
      // Mutations of seed
      allocs = mutate(seedPortfolio.allocations, config.mutationRate * (1 + i * 0.1), rng);
    } else {
      // Random portfolios for diversity
      allocs = randomPortfolio(rng);
    }

    const portfolio: Portfolio = { allocations: normalize(allocs) };
    const summary = runMonteCarlo(portfolio, adversarialSimConfig, rng.next() * 1e9 | 0);
    const fitness = computeFitness(summary, config.fitnessWeights);

    population.push({
      portfolio,
      fitness,
      summary,
      generation: 0,
      parentage: i === 0 ? "seed" : i < config.populationSize * 0.5 ? "mutation" : "random",
    });
  }

  // Evolve
  for (let gen = 0; gen < config.generations; gen++) {
    // Sort by fitness (higher = better)
    population.sort((a, b) => b.fitness - a.fitness);

    // Snapshot
    const snapshot: GenerationSnapshot = {
      generation: gen,
      best: population[0],
      worst: population[population.length - 1],
      median: population[Math.floor(population.length / 2)],
      avgFitness: population.reduce((s, p) => s + p.fitness, 0) / population.length,
      diversity: measureDiversity(population),
      population: population.map((p) => ({ ...p })),
    };
    generations.push(snapshot);

    // Track hall of fame (unique top performers)
    if (
      hallOfFame.length === 0 ||
      population[0].fitness > hallOfFame[0].fitness * 0.95
    ) {
      const isDuplicate = hallOfFame.some((h) => {
        let dist = 0;
        for (const k of ALL_ASSETS) {
          const diff = (h.portfolio.allocations[k] ?? 0) - (population[0].portfolio.allocations[k] ?? 0);
          dist += diff * diff;
        }
        return Math.sqrt(dist) < 0.05;
      });
      if (!isDuplicate) {
        hallOfFame.push({ ...population[0], generation: gen });
        hallOfFame.sort((a, b) => b.fitness - a.fitness);
        if (hallOfFame.length > 5) hallOfFame.pop();
      }
    }

    // Selection + breeding
    const nextGen: EvolvedPortfolio[] = [];

    // Elitism: top N survive
    for (let i = 0; i < config.eliteCount && i < population.length; i++) {
      nextGen.push({ ...population[i], generation: gen + 1, parentage: "elite" });
    }

    // Fill remaining with offspring
    while (nextGen.length < config.populationSize) {
      const roll = rng.next();

      if (roll < config.crossoverRate && population.length >= 2) {
        // Tournament selection + crossover
        const parentA = tournamentSelect(population, rng);
        const parentB = tournamentSelect(population, rng);
        let childAllocs = crossover(parentA.portfolio.allocations, parentB.portfolio.allocations, rng);

        // Also mutate the child
        if (rng.next() < config.mutationRate) {
          childAllocs = mutate(childAllocs, config.mutationRate, rng);
        }

        const portfolio: Portfolio = { allocations: normalize(childAllocs) };
        const summary = runMonteCarlo(portfolio, adversarialSimConfig, rng.next() * 1e9 | 0);
        const fitness = computeFitness(summary, config.fitnessWeights);

        nextGen.push({ portfolio, fitness, summary, generation: gen + 1, parentage: "crossover" });
      } else if (roll < config.crossoverRate + config.mutationRate) {
        // Mutation of a selected parent
        const parent = tournamentSelect(population, rng);
        const childAllocs = mutate(parent.portfolio.allocations, config.mutationRate, rng);
        const portfolio: Portfolio = { allocations: normalize(childAllocs) };
        const summary = runMonteCarlo(portfolio, adversarialSimConfig, rng.next() * 1e9 | 0);
        const fitness = computeFitness(summary, config.fitnessWeights);

        nextGen.push({ portfolio, fitness, summary, generation: gen + 1, parentage: "mutation" });
      } else {
        // Random immigrant (maintain diversity)
        const allocs = randomPortfolio(rng);
        const portfolio: Portfolio = { allocations: normalize(allocs) };
        const summary = runMonteCarlo(portfolio, adversarialSimConfig, rng.next() * 1e9 | 0);
        const fitness = computeFitness(summary, config.fitnessWeights);

        nextGen.push({ portfolio, fitness, summary, generation: gen + 1, parentage: "immigrant" });
      }
    }

    population = nextGen;

    // Adaptive adversarial pressure: increase stress regime bias over generations
    if (config.adversarialPressure > 0) {
      const pressure = config.adversarialPressure * (1 + gen / config.generations);
      if (pressure > 0.7 && !adversarialSimConfig.regimesEnabled.includes("stress_2022")) {
        adversarialSimConfig.regimesEnabled.push("stress_2022");
      }
    }
  }

  // Final sort
  population.sort((a, b) => b.fitness - a.fitness);

  // Final snapshot
  generations.push({
    generation: config.generations,
    best: population[0],
    worst: population[population.length - 1],
    median: population[Math.floor(population.length / 2)],
    avgFitness: population.reduce((s, p) => s + p.fitness, 0) / population.length,
    diversity: measureDiversity(population),
    population: population.map((p) => ({ ...p })),
  });

  // Detect adversarial findings
  const adversarialFindings = detectAdversarial(population);

  return {
    generations,
    champion: population[0],
    hallOfFame: hallOfFame.length > 0 ? hallOfFame : [population[0]],
    adversarialFindings,
  };
}

/** Tournament selection: pick k random, return the fittest */
function tournamentSelect(pop: EvolvedPortfolio[], rng: SeededRNG, k = 3): EvolvedPortfolio {
  let best = pop[Math.floor(rng.next() * pop.length)];
  for (let i = 1; i < k; i++) {
    const contender = pop[Math.floor(rng.next() * pop.length)];
    if (contender.fitness > best.fitness) best = contender;
  }
  return best;
}
