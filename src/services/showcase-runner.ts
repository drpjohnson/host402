import { ShowcaseAgent } from "./showcase-agent.js";

const agent = new ShowcaseAgent();
console.log("[ShowcaseRunner] Starting autonomous showcase daemon for Host402...");

async function runCycle() {
  console.log(`[ShowcaseRunner] Executing autonomous deployment cycle at ${new Date().toISOString()}`);
  try {
    await agent.deployShowcase(0);
    await new Promise((r) => setTimeout(r, 5000));
    await agent.deployShowcase(1);
  } catch (err) {
    console.error("[ShowcaseRunner] Cycle error:", err);
  }
}

// Run every 4 hours
const INTERVAL_MS = 4 * 60 * 60 * 1000;
setInterval(runCycle, INTERVAL_MS);
