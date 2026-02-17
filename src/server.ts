import { runMonteCarlo } from "./domain/simulation";
import { evolvePortfolio, type EvolutionConfig } from "./domain/evolution";
import { analyzePortfolio } from "./infra/anthropic";
import type { Portfolio, SimulationConfig, ChatRequest } from "./domain/types";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readJson(req: Request) {
  return req.json();
}

Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;

    // API routes
    if (path === "/api/health" && req.method === "GET") {
      return json({ ok: true, timestamp: Date.now() });
    }

    if (path === "/api/simulate" && req.method === "POST") {
      try {
        const body = await readJson(req);
        const portfolio: Portfolio = body.portfolio;
        const config: SimulationConfig = {
          numScenarios: body.config?.numScenarios ?? 5000,
          horizonMonths: body.config?.horizonMonths ?? 12,
          seed: body.config?.seed,
          regimesEnabled: body.config?.regimesEnabled ?? [
            "normal",
            "stress_2022",
            "stagflation",
            "deflation",
          ],
        };

        const total = Object.values(portfolio.allocations).reduce(
          (s, v) => s + v,
          0
        );
        if (Math.abs(total - 1.0) > 0.01) {
          return json(
            { error: `Allocations must sum to 100% (got ${(total * 100).toFixed(1)}%)` },
            400
          );
        }

        const summary = runMonteCarlo(portfolio, config, config.seed);
        return json(summary);
      } catch (e: any) {
        return json({ error: e.message }, 500);
      }
    }

    if (path === "/api/evolve" && req.method === "POST") {
      try {
        const body = await readJson(req);
        const portfolio: Portfolio = body.portfolio;

        const total = Object.values(portfolio.allocations).reduce(
          (s, v) => s + v,
          0
        );
        if (Math.abs(total - 1.0) > 0.01) {
          return json(
            { error: `Allocations must sum to 100% (got ${(total * 100).toFixed(1)}%)` },
            400
          );
        }

        const evoConfig: EvolutionConfig = {
          populationSize: body.populationSize ?? 20,
          generations: body.generations ?? 8,
          mutationRate: body.mutationRate ?? 0.6,
          crossoverRate: body.crossoverRate ?? 0.4,
          eliteCount: body.eliteCount ?? 3,
          fitnessWeights: body.fitnessWeights ?? {
            sharpe: 2.0,
            cvar: 1.5,
            maxDrawdown: 1.0,
            returnMean: 1.0,
          },
          adversarialPressure: body.adversarialPressure ?? 0.5,
          simConfig: {
            numScenarios: body.numScenarios ?? 2000,
            horizonMonths: body.horizonMonths ?? 12,
            regimesEnabled: ["normal", "stress_2022", "stagflation", "deflation"],
          },
          seed: body.seed,
        };

        const result = evolvePortfolio(portfolio, evoConfig);

        // Trim paths from response to reduce payload size
        const trimmed = {
          ...result,
          generations: result.generations.map((g) => ({
            generation: g.generation,
            bestFitness: g.best.fitness,
            worstFitness: g.worst.fitness,
            avgFitness: g.avgFitness,
            diversity: g.diversity,
            bestAllocation: g.best.portfolio.allocations,
            bestMetrics: g.best.summary.metrics,
            bestTailFlags: g.best.summary.tailFlags,
          })),
          champion: {
            portfolio: result.champion.portfolio,
            fitness: result.champion.fitness,
            metrics: result.champion.summary.metrics,
            tailFlags: result.champion.summary.tailFlags,
            generation: result.champion.generation,
            parentage: result.champion.parentage,
            worstScenarios: result.champion.summary.worstScenarios.map((s) => ({
              portfolioReturn: s.portfolioReturn,
              drawdown: s.drawdown,
              macro: s.macro,
            })),
          },
          hallOfFame: result.hallOfFame.map((h) => ({
            portfolio: h.portfolio,
            fitness: h.fitness,
            metrics: h.summary.metrics,
            generation: h.generation,
            parentage: h.parentage,
          })),
        };

        return json(trimmed);
      } catch (e: any) {
        return json({ error: e.message }, 500);
      }
    }

    if (path === "/api/chat" && req.method === "POST") {
      try {
        const body: ChatRequest = await readJson(req);
        const result = await analyzePortfolio(
          body.message,
          body.portfolio,
          body.simSummary,
          body.history ?? []
        );
        return json(result);
      } catch (e: any) {
        return json({ error: e.message }, 500);
      }
    }

    // Static files
    if (path === "/") path = "/index.html";
    const filePath = `./public${path}`;
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }

    return json({ error: "Not found" }, 404);
  },
});

console.log("🚀 Portfolio Evolution Engine running on http://localhost:3000");
