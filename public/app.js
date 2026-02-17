// Portfolio Evolution Engine

const ASSETS = [
  { key: "usEquities", label: "US Equities", color: "#4c9aff" },
  { key: "intlEquities", label: "Int'l Equities", color: "#6c8cff" },
  { key: "emergingEquities", label: "Emerging Mkts", color: "#a78bfa" },
  { key: "longTermBonds", label: "Long Bonds", color: "#ff4c6a" },
  { key: "shortTermBonds", label: "Short Bonds", color: "#ffaa2c" },
  { key: "tips", label: "TIPS", color: "#00d4aa" },
  { key: "reits", label: "REITs", color: "#ff8c4c" },
  { key: "commodities", label: "Commodities", color: "#d4aa00" },
  { key: "gold", label: "Gold", color: "#ffd700" },
  { key: "cash", label: "Cash", color: "#8892a4" },
];

const ASSET_MAP = Object.fromEntries(ASSETS.map((a) => [a.key, a]));

const PRESETS = {
  conservative: {
    usEquities: 0.15, intlEquities: 0.05, emergingEquities: 0,
    longTermBonds: 0.10, shortTermBonds: 0.30, tips: 0.15,
    reits: 0.05, commodities: 0, gold: 0.05, cash: 0.15,
  },
  balanced: {
    usEquities: 0.25, intlEquities: 0.10, emergingEquities: 0.05,
    longTermBonds: 0.10, shortTermBonds: 0.15, tips: 0.10,
    reits: 0.10, commodities: 0.05, gold: 0.05, cash: 0.05,
  },
  aggressive: {
    usEquities: 0.40, intlEquities: 0.15, emergingEquities: 0.10,
    longTermBonds: 0.05, shortTermBonds: 0.05, tips: 0.05,
    reits: 0.10, commodities: 0.05, gold: 0.05, cash: 0,
  },
  allweather: {
    usEquities: 0.30, intlEquities: 0, emergingEquities: 0,
    longTermBonds: 0.40, shortTermBonds: 0, tips: 0,
    reits: 0, commodities: 0.075, gold: 0.075, cash: 0.15,
  },
};

// State
let allocations = {};
let evoResults = null;
let originalAllocations = null;
let chatHistory = [];

document.addEventListener("DOMContentLoaded", () => {
  buildSliders();
  setPreset("balanced");
  bindEvents();
  bindEvoParams();
});

function buildSliders() {
  const container = document.getElementById("allocation-sliders");
  container.innerHTML = "";
  for (const asset of ASSETS) {
    const div = document.createElement("div");
    div.className = "alloc-slider";
    div.innerHTML = `
      <div class="alloc-slider-header">
        <span class="alloc-label">${asset.label}</span>
        <span class="alloc-value" id="val-${asset.key}">0%</span>
      </div>
      <input type="range" id="slider-${asset.key}" min="0" max="100" step="5" value="0"
        data-asset="${asset.key}" />
    `;
    container.appendChild(div);
    const slider = document.getElementById(`slider-${asset.key}`);
    slider.addEventListener("input", () => {
      allocations[asset.key] = parseInt(slider.value) / 100;
      updateDisplay();
    });
  }
}

function updateDisplay() {
  const total = Object.values(allocations).reduce((s, v) => s + v, 0);
  const totalEl = document.getElementById("total-pct");
  totalEl.textContent = `${Math.round(total * 100)}%`;
  totalEl.className = `total-value ${Math.abs(total - 1.0) < 0.01 ? "valid" : "invalid"}`;
  for (const asset of ASSETS) {
    const val = allocations[asset.key] ?? 0;
    document.getElementById(`val-${asset.key}`).textContent = `${Math.round(val * 100)}%`;
    document.getElementById(`slider-${asset.key}`).value = Math.round(val * 100);
  }
}

function setPreset(name) {
  allocations = { ...PRESETS[name] };
  updateDisplay();
}

function bindEvoParams() {
  const params = [
    { id: "evo-population", display: "val-pop", fmt: (v) => v },
    { id: "evo-generations", display: "val-gen", fmt: (v) => v },
    { id: "evo-mutation", display: "val-mut", fmt: (v) => v + "%" },
    { id: "evo-adversarial", display: "val-adv", fmt: (v) => v + "%" },
  ];
  for (const p of params) {
    const el = document.getElementById(p.id);
    el.addEventListener("input", () => {
      document.getElementById(p.display).textContent = p.fmt(el.value);
    });
  }
}

function bindEvents() {
  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => setPreset(btn.dataset.preset));
  });
  document.getElementById("btn-reset").addEventListener("click", () => {
    allocations = {};
    ASSETS.forEach((a) => (allocations[a.key] = 0));
    updateDisplay();
  });
  document.getElementById("btn-evolve").addEventListener("click", runEvolution);
  document.getElementById("btn-send").addEventListener("click", sendChat);
  document.getElementById("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChat();
  });
  document.getElementById("btn-clear-chat").addEventListener("click", () => {
    chatHistory = [];
    document.getElementById("chat-messages").innerHTML = `
      <div class="chat-msg assistant">
        <div class="msg-content"><p>👋 Chat cleared. Evolve a portfolio and ask me about the results!</p></div>
      </div>`;
  });
}

async function runEvolution() {
  const total = Object.values(allocations).reduce((s, v) => s + v, 0);
  if (Math.abs(total - 1.0) > 0.02) {
    alert(`Allocations must sum to 100% (currently ${Math.round(total * 100)}%)`);
    return;
  }

  originalAllocations = { ...allocations };

  const btn = document.getElementById("btn-evolve");
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Evolving…';

  document.getElementById("results-placeholder").style.display = "none";
  document.getElementById("results-content").style.display = "block";
  const progress = document.getElementById("evo-progress");
  progress.style.display = "block";

  // Animate progress bar
  const generations = parseInt(document.getElementById("evo-generations").value);
  let pct = 0;
  const progressInterval = setInterval(() => {
    pct = Math.min(pct + 100 / (generations * 8), 95);
    document.getElementById("progress-bar").style.width = pct + "%";
    document.getElementById("progress-text").textContent =
      `Generation ~${Math.floor((pct / 100) * generations)}/${generations} — breeding, mutating, stress-testing…`;
  }, 300);

  try {
    const resp = await fetch("/api/evolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        portfolio: { allocations },
        populationSize: parseInt(document.getElementById("evo-population").value),
        generations,
        mutationRate: parseInt(document.getElementById("evo-mutation").value) / 100,
        crossoverRate: 0.4,
        adversarialPressure: parseInt(document.getElementById("evo-adversarial").value) / 100,
        numScenarios: parseInt(document.getElementById("num-scenarios").value),
        horizonMonths: parseInt(document.getElementById("horizon").value),
      }),
    });

    evoResults = await resp.json();
    if (evoResults.error) throw new Error(evoResults.error);

    clearInterval(progressInterval);
    document.getElementById("progress-bar").style.width = "100%";
    document.getElementById("progress-text").textContent = "Evolution complete ✓";

    renderEvolutionResults(evoResults);

    // Auto-trigger AI analysis
    autoAnalyze(evoResults);
  } catch (e) {
    clearInterval(progressInterval);
    alert(`Evolution failed: ${e.message}`);
    progress.style.display = "none";
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">🧬</span> Evolve Portfolio';
  }
}

function renderEvolutionResults(data) {
  renderComparison(data);
  renderFitnessCurve(data.generations);
  renderAdversarial(data.adversarialFindings);
  renderHallOfFame(data.hallOfFame);
  renderChampionAllocation(data.champion);
}

function renderComparison(data) {
  const orig = originalAllocations;
  const champ = data.champion;
  const champAllocs = champ.portfolio.allocations;

  // Run a quick sim of original for comparison (use first generation's data)
  const firstGen = data.generations[0];
  const origMetrics = firstGen.bestMetrics; // approximate — the seed was in gen 0
  const champMetrics = champ.metrics;

  const fmt = (v) => `${(v * 100).toFixed(1)}%`;
  const fmtN = (v) => v.toFixed(2);

  function metricRow(label, origVal, champVal, format, higherBetter) {
    const improved = higherBetter ? champVal > origVal : champVal < origVal;
    const cls = improved ? "improved" : "worsened";
    return `<div class="comparison-metric">
      <span class="label">${label}</span>
      <span class="value ${cls}">${format(champVal)}</span>
    </div>`;
  }

  const container = document.getElementById("comparison-section");
  container.innerHTML = `
    <div class="comparison-card original">
      <div class="comparison-title">Your Seed Portfolio</div>
      ${renderAllocBars(orig, "#5a6478")}
    </div>
    <div class="comparison-arrow">→</div>
    <div class="comparison-card champion">
      <div class="comparison-title">🏆 Evolved Champion</div>
      ${renderAllocBars(champAllocs)}
      <div style="margin-top:10px; border-top: 1px solid var(--border); padding-top:8px;">
        ${metricRow("Sharpe", origMetrics.sharpeRatio, champMetrics.sharpeRatio, fmtN, true)}
        ${metricRow("Median Return", origMetrics.p50Return, champMetrics.p50Return, fmt, true)}
        ${metricRow("CVaR (95%)", origMetrics.cvar95, champMetrics.cvar95, fmt, false)}
        ${metricRow("Max Drawdown", origMetrics.maxDrawdown, champMetrics.maxDrawdown, fmt, false)}
        ${metricRow("Prob. Loss", origMetrics.probLoss, champMetrics.probLoss, fmt, false)}
        ${metricRow("Volatility", origMetrics.stdDev, champMetrics.stdDev, fmt, false)}
      </div>
      <button class="btn btn-primary champion-btn" id="btn-adopt-champion">
        Adopt Champion Allocation
      </button>
    </div>
  `;

  document.getElementById("btn-adopt-champion")?.addEventListener("click", () => {
    allocations = { ...champAllocs };
    updateDisplay();
  });
}

function renderAllocBars(allocs, colorOverride) {
  return ASSETS.filter((a) => (allocs[a.key] ?? 0) > 0.005)
    .sort((a, b) => (allocs[b.key] ?? 0) - (allocs[a.key] ?? 0))
    .map((a) => {
      const pct = (allocs[a.key] ?? 0) * 100;
      const color = colorOverride ?? a.color;
      return `<div class="alloc-bar-row">
        <span class="alloc-bar-label">${a.label}</span>
        <div class="alloc-bar-track">
          <div class="alloc-bar-fill" style="width:${pct}%; background:${color}"></div>
        </div>
        <span class="alloc-bar-pct">${pct.toFixed(0)}%</span>
      </div>`;
    })
    .join("");
}

function renderFitnessCurve(generations) {
  const canvas = document.getElementById("chart-fitness");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = 180 * dpr;
  ctx.scale(dpr, dpr);
  const W = canvas.clientWidth;
  const H = 180;
  ctx.clearRect(0, 0, W, H);

  const chartX = 50, chartY = 10, chartW = W - 65, chartH = H - 35;

  const bestFit = generations.map((g) => g.bestFitness);
  const avgFit = generations.map((g) => g.avgFitness);
  const worstFit = generations.map((g) => g.worstFitness);

  const allVals = [...bestFit, ...avgFit, ...worstFit];
  const minY = Math.min(...allVals) - 0.05;
  const maxY = Math.max(...allVals) + 0.05;

  function toX(i) { return chartX + (i / (generations.length - 1)) * chartW; }
  function toY(v) { return chartY + chartH * (1 - (v - minY) / (maxY - minY)); }

  // Fill area between worst and best
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = "#00d4aa";
  ctx.beginPath();
  for (let i = 0; i < generations.length; i++) {
    ctx.lineTo(toX(i), toY(bestFit[i]));
  }
  for (let i = generations.length - 1; i >= 0; i--) {
    ctx.lineTo(toX(i), toY(worstFit[i]));
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Draw lines
  function drawLine(data, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      if (i === 0) ctx.moveTo(toX(i), toY(data[i]));
      else ctx.lineTo(toX(i), toY(data[i]));
    }
    ctx.stroke();
  }

  drawLine(worstFit, "#ff4c6a", 1);
  drawLine(avgFit, "#ffaa2c", 1.5);
  drawLine(bestFit, "#00d4aa", 2.5);

  // Labels
  ctx.fillStyle = "#5a6478";
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  for (let i = 0; i < generations.length; i += Math.max(1, Math.floor(generations.length / 8))) {
    ctx.fillText(`G${generations[i].generation}`, toX(i), H - 5);
  }

  // Y-axis
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const val = minY + (maxY - minY) * (i / 4);
    ctx.fillText(val.toFixed(2), chartX - 5, toY(val) + 3);
  }

  // Legend
  ctx.textAlign = "left";
  ctx.font = "10px 'Inter', sans-serif";
  const lx = chartX + chartW - 100;
  ctx.fillStyle = "#00d4aa"; ctx.fillText("● Best", lx, chartY + 10);
  ctx.fillStyle = "#ffaa2c"; ctx.fillText("● Average", lx, chartY + 22);
  ctx.fillStyle = "#ff4c6a"; ctx.fillText("● Worst", lx, chartY + 34);

  // Diversity indicator
  const lastDiv = generations[generations.length - 1].diversity;
  ctx.fillStyle = "#5a6478";
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textAlign = "left";
  ctx.fillText(`Diversity: ${(lastDiv * 100).toFixed(1)}%`, chartX, H - 5);
}

function renderAdversarial(findings) {
  const container = document.getElementById("adversarial-section");
  if (!findings || findings.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <h3>⚠ Adversarial Findings</h3>
    ${findings
      .map(
        (f) => `
      <div class="adversarial-card">
        <div class="finding-header">${f.description}</div>
        <div class="finding-body">
          ${f.vulnerability}<br/>
          Worst portfolio return: <span class="finding-return">${(f.worstReturn * 100).toFixed(1)}%</span>
          ${f.affectedAssets.length > 0 ? `<br/>Most affected: ${f.affectedAssets.map((a) => ASSET_MAP[a]?.label ?? a).join(", ")}` : ""}
        </div>
      </div>`
      )
      .join("")}
  `;
}

function renderHallOfFame(hof) {
  const container = document.getElementById("halloffame-section");
  container.innerHTML = `
    <h3>🏆 Hall of Fame — Top Evolved Strategies</h3>
    <div class="hof-grid">
      ${hof
        .map(
          (h, i) => `
        <div class="hof-card">
          <div class="hof-rank">${i === 0 ? "Champion" : `#${i + 1}`}</div>
          <div class="hof-fitness">${h.fitness.toFixed(3)}</div>
          <div class="hof-detail">
            Sharpe ${h.metrics.sharpeRatio.toFixed(2)} · 
            CVaR ${(h.metrics.cvar95 * 100).toFixed(1)}%
          </div>
          <div class="hof-detail">Gen ${h.generation} · ${h.parentage}</div>
        </div>`
        )
        .join("")}
    </div>
  `;
}

function renderChampionAllocation(champion) {
  const container = document.getElementById("champion-section");
  const allocs = champion.portfolio.allocations;
  const flags = champion.tailFlags;

  const flagItems = [];
  if (flags.correlationBreakdown) flagItems.push("⚠ Correlation breakdown risk remains");
  if (flags.rateShockRisk) flagItems.push("⚠ Duration risk");
  if (flags.inflationShockRisk) flagItems.push("⚠ Inflation exposure");
  if (flags.concentrationRisk) flagItems.push("⚠ Concentration risk");
  if (flagItems.length === 0) flagItems.push("✓ Risks mitigated by evolution");

  container.innerHTML = `
    <h3>Champion Portfolio — Stress-Test Survivor</h3>
    <div class="risk-flags" style="margin-bottom:12px">
      ${flagItems
        .map(
          (f) =>
            `<div class="risk-flag ${f.startsWith("✓") ? "ok" : "warning"}">${f}</div>`
        )
        .join("")}
    </div>
    <div class="scenarios-section">
      <h3 style="color:var(--text-secondary)">Champion's Worst Scenarios</h3>
      <table class="scenario-table">
        <thead>
          <tr><th>Return</th><th>Drawdown</th><th>Regime</th><th>Rate Δ</th><th>Inflation</th></tr>
        </thead>
        <tbody>
          ${(champion.worstScenarios ?? [])
            .map(
              (s) => `
            <tr class="scenario-worst">
              <td style="color:${s.portfolioReturn >= 0 ? "#00d4aa" : "#ff4c6a"}">${(s.portfolioReturn * 100).toFixed(1)}%</td>
              <td style="color:#ff4c6a">${(s.drawdown * 100).toFixed(1)}%</td>
              <td><span class="regime-badge regime-${s.macro.regime}">${s.macro.regime}</span></td>
              <td>${s.macro.rateChange.toFixed(0)} bps</td>
              <td>${s.macro.inflationShock.toFixed(1)}%</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function autoAnalyze(data) {
  const msg = `I just ran an evolutionary optimization on my portfolio. Here are the results:

**Original Seed Allocation:**
${Object.entries(originalAllocations)
    .filter(([_, v]) => v > 0)
    .map(([k, v]) => `- ${ASSET_MAP[k]?.label ?? k}: ${(v * 100).toFixed(0)}%`)
    .join("\n")}

**Evolved Champion Allocation:**
${Object.entries(data.champion.portfolio.allocations)
    .filter(([_, v]) => v > 0)
    .map(([k, v]) => `- ${ASSET_MAP[k]?.label ?? k}: ${(v * 100).toFixed(0)}%`)
    .join("\n")}

**Champion Metrics:**
- Fitness: ${data.champion.fitness.toFixed(3)}
- Sharpe: ${data.champion.metrics.sharpeRatio.toFixed(2)}
- Median Return: ${(data.champion.metrics.p50Return * 100).toFixed(1)}%
- CVaR (95%): ${(data.champion.metrics.cvar95 * 100).toFixed(1)}%
- Max Drawdown: ${(data.champion.metrics.maxDrawdown * 100).toFixed(1)}%
- Prob. Loss: ${(data.champion.metrics.probLoss * 100).toFixed(1)}%

**Evolution ran ${data.generations.length} generations. Final diversity: ${(data.generations[data.generations.length - 1].diversity * 100).toFixed(1)}%**

**Adversarial Findings:**
${data.adversarialFindings
    .map(
      (f) =>
        `- ${f.regime}: ${f.vulnerability} (worst return: ${(f.worstReturn * 100).toFixed(1)}%)`
    )
    .join("\n")}

What did the optimizer discover? What's the key insight about my original portfolio's weaknesses, and how did the evolution address them? Are there remaining risks?`;

  appendChatMsg("user", "🧬 Analyze my evolution results — what did the optimizer discover?");
  chatHistory.push({ role: "user", content: msg });

  const thinkingEl = document.createElement("div");
  thinkingEl.className = "chat-msg assistant";
  thinkingEl.innerHTML = `<div class="thinking-indicator"><span class="loading-spinner"></span> Analyzing evolution results...</div>`;
  document.getElementById("chat-messages").appendChild(thinkingEl);
  scrollChat();

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: msg,
        portfolio: { allocations: data.champion.portfolio.allocations },
        history: [],
      }),
    });
    const result = await resp.json();
    thinkingEl.remove();
    if (result.error) {
      appendChatMsg("assistant", `⚠️ Error: ${result.error}`);
    } else {
      appendChatMsg("assistant", result.reply);
      chatHistory.push({ role: "assistant", content: result.reply });
    }
  } catch (e) {
    thinkingEl.remove();
    appendChatMsg("assistant", `⚠️ Connection error: ${e.message}`);
  }
}

async function sendChat() {
  const input = document.getElementById("chat-input");
  const message = input.value.trim();
  if (!message) return;
  input.value = "";
  appendChatMsg("user", message);
  chatHistory.push({ role: "user", content: message });

  const thinkingEl = document.createElement("div");
  thinkingEl.className = "chat-msg assistant";
  thinkingEl.innerHTML = `<div class="thinking-indicator"><span class="loading-spinner"></span> Analyzing...</div>`;
  document.getElementById("chat-messages").appendChild(thinkingEl);
  scrollChat();

  try {
    // Build context from evolution results
    let contextMsg = message;
    if (evoResults) {
      contextMsg = `[Context: Evolution results available. Champion fitness: ${evoResults.champion.fitness.toFixed(3)}, Sharpe: ${evoResults.champion.metrics.sharpeRatio.toFixed(2)}, CVaR: ${(evoResults.champion.metrics.cvar95 * 100).toFixed(1)}%]

User question: ${message}`;
    }

    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: contextMsg,
        portfolio: { allocations },
        history: chatHistory.slice(-10),
      }),
    });
    const data = await resp.json();
    thinkingEl.remove();
    if (data.error) {
      appendChatMsg("assistant", `⚠️ Error: ${data.error}`);
    } else {
      appendChatMsg("assistant", data.reply);
      chatHistory.push({ role: "assistant", content: data.reply });
    }
  } catch (e) {
    thinkingEl.remove();
    appendChatMsg("assistant", `⚠️ Connection error: ${e.message}`);
  }
}

function appendChatMsg(role, content) {
  const div = document.createElement("div");
  div.className = `chat-msg ${role}`;
  let html = content
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/### (.*?)$/gm, "<h4>$1</h4>")
    .replace(/## (.*?)$/gm, "<h3>$1</h3>")
    .replace(/`(.*?)`/g, "<code>$1</code>")
    .replace(/^- (.*?)$/gm, "<li>$1</li>")
    .replace(/^(\d+)\. (.*?)$/gm, "<li>$2</li>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");
  html = html.replace(/(<li>.*?<\/li>)+/gs, (match) => `<ul>${match}</ul>`);
  div.innerHTML = `<div class="msg-content"><p>${html}</p></div>`;
  document.getElementById("chat-messages").appendChild(div);
  scrollChat();
}

function scrollChat() {
  const el = document.getElementById("chat-messages");
  el.scrollTop = el.scrollHeight;
}
