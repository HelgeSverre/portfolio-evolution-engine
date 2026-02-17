export interface Portfolio {
  allocations: Record<AssetClass, number>;
}

export type AssetClass =
  | "usEquities"
  | "intlEquities"
  | "emergingEquities"
  | "longTermBonds"
  | "shortTermBonds"
  | "tips"
  | "reits"
  | "commodities"
  | "gold"
  | "cash";

export const ASSET_LABELS: Record<AssetClass, string> = {
  usEquities: "US Equities",
  intlEquities: "Int'l Equities",
  emergingEquities: "Emerging Markets",
  longTermBonds: "Long-Term Bonds",
  shortTermBonds: "Short-Term Bonds",
  tips: "TIPS (Inflation-Protected)",
  reits: "REITs",
  commodities: "Commodities",
  gold: "Gold",
  cash: "Cash / Money Market",
};

export interface AssetAssumptions {
  expectedReturn: number; // annualized
  volatility: number; // annualized
  betaRate: number; // sensitivity to rate shock
  betaInflation: number; // sensitivity to inflation shock
  betaGrowth: number; // sensitivity to growth shock
  betaRiskOff: number; // sensitivity to risk-off shock
}

export type Regime = "normal" | "stress_2022" | "stagflation" | "deflation";

export interface RegimeConfig {
  probability: number;
  volMultiplier: number;
  correlationOverrides: Partial<Record<string, number>>;
  description: string;
}

export interface SimulationConfig {
  numScenarios: number;
  horizonMonths: number;
  seed?: number;
  regimesEnabled: Regime[];
}

export interface MacroShock {
  rateChange: number; // bps
  inflationShock: number; // percentage
  growthShock: number; // percentage
  riskOffShock: number; // z-score
  regime: Regime;
}

export interface ScenarioResult {
  scenarioId: number;
  macro: MacroShock;
  assetReturns: Record<AssetClass, number>;
  portfolioReturn: number;
  drawdown: number;
  path: number[]; // monthly wealth path (starting at 1.0)
}

export interface SimulationSummary {
  runId: string;
  portfolio: Portfolio;
  config: SimulationConfig;
  metrics: {
    p5Return: number;
    p25Return: number;
    p50Return: number;
    p75Return: number;
    p95Return: number;
    meanReturn: number;
    stdDev: number;
    sharpeRatio: number;
    maxDrawdown: number;
    cvar95: number;
    probLoss: number;
  };
  tailFlags: {
    correlationBreakdown: boolean;
    rateShockRisk: boolean;
    inflationShockRisk: boolean;
    concentrationRisk: boolean;
    durationRisk: boolean;
  };
  worstScenarios: ScenarioResult[];
  bestScenarios: ScenarioResult[];
  medianScenario: ScenarioResult;
  returnDistribution: number[]; // histogram buckets
  correlationMatrix: Record<string, Record<string, number>>;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  message: string;
  portfolio: Portfolio;
  simSummary?: SimulationSummary;
  history: ChatMessage[];
}

export interface ChatResponse {
  reply: string;
  suggestedAllocations?: Record<AssetClass, number>;
}
