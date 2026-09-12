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

// AI Agent & LLM Discovery Manifests
app.get("/llms.txt", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.sendFile(path.join(publicDir, "llms.txt"));
});

app.get("/llms-full.txt", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.sendFile(path.join(publicDir, "llms-full.txt"));
});

app.get("/.well-known/agent.json", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.sendFile(path.join(publicDir, ".well-known/agent.json"));
});

app.get("/feed.xml", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.sendFile(path.join(publicDir, "feed.xml"));
});

app.get("/feed.json", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/feed+json; charset=utf-8");
  res.sendFile(path.join(publicDir, "feed.json"));
});

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

app.get(["/api/recent", "/api/showcase"], (req: Request, res: Response) => {
  const deployments = db.getAllDeployments({ status: "active" }).slice(0, 15);
  res.json({
    success: true,
    count: deployments.length,
    items: deployments.map((d) => ({
      id: d.id,
      title: d.title || `Autonomous Site (${d.id})`,
      description: d.description || "Autonomous static web application deployed via x402 on Base",
      url: d.siteUrl,
      type: d.type,
      fileCount: d.fileCount,
      sizeBytes: d.sizeBytes,
      createdAt: d.createdAt,
      expiresAt: d.expiresAt,
    })),
  });
});

app.get("/api/transactions", (req: Request, res: Response) => {
  const payments = db.getAllPayments().slice(0, 30);
  const isBaseMainnet = config.network.includes("8453") && !config.network.includes("84532");
  const explorerBase = isBaseMainnet ? "https://basescan.org" : "https://sepolia.basescan.org";

  res.json({
    success: true,
    count: payments.length,
    totalVolumeUSDC: (payments.reduce((sum, p) => sum + (p.amount || 0), 0) / 1_000_000).toFixed(4),
    items: payments.map((p) => {
      const dep = db.getDeployment(p.deploymentId);
      const isSim = p.txHash?.startsWith("0xsim_") || p.txHash?.startsWith("0xfallback_");

      let typeLabel = "Web Hosting Deploy";
      if (p.type === "deploy_api" || p.amount === 50000) typeLabel = "API Paywall Registration";
      else if (p.type === "renew" || p.amount === 10000) typeLabel = "Lease Renewal";
      else if (p.type === "api_call") typeLabel = "Agent API Call";

      return {
        id: p.id,
        deploymentId: p.deploymentId,
        txHash: p.txHash,
        shortTxHash: p.txHash ? `${p.txHash.slice(0, 10)}...${p.txHash.slice(-6)}` : "0x...",
        explorerUrl: isSim ? null : `${explorerBase}/tx/${p.txHash}`,
        payerWallet: p.payerWallet,
        shortPayer: p.payerWallet ? `${p.payerWallet.slice(0, 6)}...${p.payerWallet.slice(-4)}` : "0x...",
        recipientWallet: p.recipientWallet,
        amountAtomic: p.amount,
        amountUSDC: `$${(p.amount / 1_000_000).toFixed(4)} USDC`,
        scheme: p.scheme,
        type: p.type || "deploy_static",
        typeLabel,
        status: p.status,
        siteUrl: dep?.siteUrl || null,
        siteTitle: dep?.title || null,
        createdAt: p.createdAt,
      };
    }),
  });
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

// Start Server if executed directly or in production/PM2
const isMainModule =
  process.env.NODE_ENV === "production" ||
  process.env.PM2_HOME !== undefined ||
  (process.argv[1] && (
    process.argv[1].endsWith("index.js") ||
    process.argv[1].endsWith("index.ts") ||
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  ));

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
