import express, { Request, Response } from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { deployRouter } from "./routes/deploy.js";
import { serveRouter } from "./routes/serve.js";
import { bazaarRouter } from "./routes/bazaar.js";
import { apiGatewayRouter } from "./routes/api-gateway.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

// Security & Middleware
app.use(cors({ origin: "*", exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"] }));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Static frontend dashboard & playground
const publicDir = path.resolve(__dirname, "../public");
app.use(express.static(publicDir));

// Public Platform Statistics & Directory API
app.get("/api/stats", (req: Request, res: Response) => {
  res.json({
    ...db.getStats(),
    network: config.network,
    pricing: {
      staticDeployUSDC: config.pricing.staticDeployUSDC / 1_000_000,
      apiDeployUSDC: config.pricing.apiDeployUSDC / 1_000_000,
      renewalUSDC: config.pricing.renewalUSDC / 1_000_000,
    },
  });
});

app.get("/api/recent", (req: Request, res: Response) => {
  const deployments = db.getAllDeployments({ status: "active" }).slice(0, 10);
  res.json({ items: deployments });
});

// Health Probe
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "healthy", version: "1.0.0", x402Version: 2, timestamp: new Date().toISOString() });
});

// Mount Routes
app.use("/v1/deploy", deployRouter);
app.use("/v1", deployRouter);
app.use(bazaarRouter);
app.use(apiGatewayRouter);
app.use(serveRouter);

// Global 404 fallback
app.use((req: Request, res: Response) => {
  if (req.accepts("html")) {
    return res.status(404).sendFile(path.join(publicDir, "index.html"));
  }
  return res.status(404).json({ error: "Not Found", path: req.path });
});

// Start Server only if executed directly
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  const server = app.listen(config.port, () => {
    console.log(`
  ⚡ Host402 Agent Platform running at: ${config.baseUrl}
  -------------------------------------------------------------
  🌐 Public Web Gateway:       ${config.baseUrl}
  📦 x402 Static Deployment:  ${config.baseUrl}/v1/deploy/static
  💸 Reverse-402 API Gateway: ${config.baseUrl}/gateway/:path
  🔍 x402 Bazaar Discovery:   ${config.baseUrl}/discovery/resources
  📊 Platform Metrics:        ${config.baseUrl}/api/stats
  ⚙️ Network:                 ${config.network} (${config.usdcAsset})
  -------------------------------------------------------------
    `);
  });
}
