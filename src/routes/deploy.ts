import { Router, Request, Response } from "express";
import crypto from "node:crypto";
import { config } from "../config.js";
import { db, DeploymentRecord, ApiEndpointRecord } from "../db/index.js";
import { storage, FilePayload } from "../services/storage.js";
import { x402 } from "../services/x402.js";

export const deployRouter = Router();

// Helper to generate IDs
function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * POST /v1/deploy/static
 * Deploys static files (HTML, CSS, JS, images) via x402 payment
 */
deployRouter.post("/static", async (req: Request, res: Response) => {
  try {
    const paymentHeader =
      (req.headers["payment-signature"] as string) ||
      (req.headers["payment"] as string) ||
      (req.headers["x-payment"] as string);

    const ttlDays = Number(req.body?.ttl_days) || config.limits.defaultTtlDays;
    const reqAmount = config.pricing.staticDeployUSDC;
    const requirement = x402.createRequirement(
      reqAmount,
      "/v1/deploy/static",
      `Host402 static website deployment (${ttlDays} days lease)`
    );

    // If no payment header provided, issue HTTP 402 Payment Required
    if (!paymentHeader) {
      const encoded = x402.encodePaymentRequiredHeader(requirement);
      res.setHeader("PAYMENT-REQUIRED", encoded);
      res.setHeader("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
      return res.status(402).json({
        error: "Payment Required",
        message: "This endpoint requires an x402 payment in USDC on the Base network.",
        x402: requirement,
      });
    }

    // Process files payload
    let files: FilePayload[] = [];
    if (req.body?.files && Array.isArray(req.body.files)) {
      files = req.body.files;
    } else if (req.body?.html) {
      // Convenience shorthand: { html: "<h1>...</h1>" }
      files = [{ path: "index.html", content: req.body.html, encoding: "utf-8" }];
    } else {
      return res.status(400).json({
        error: "Bad Request",
        message: "No files provided. Send an array of { path, content, encoding? } in 'files'.",
      });
    }

    if (files.length > config.limits.maxFilesPerDeployment) {
      return res.status(400).json({
        error: "Payload Too Large",
        message: `Exceeded file count limit (${config.limits.maxFilesPerDeployment} files max)`,
      });
    }

    const deploymentId = generateId("dep");

    // Settle payment
    const settlement = await x402.verifyAndSettlePayment(paymentHeader, requirement, deploymentId);
    if (!settlement.success) {
      return res.status(402).json({
        error: "Payment Verification Failed",
        details: settlement.error,
      });
    }

    // Save files
    const saveResult = storage.saveFiles(deploymentId, files);

    // Calculate expiration
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
    const siteUrl = `${config.baseUrl}/sites/${deploymentId}/${saveResult.entrypoint}`;

    const deploymentRecord: DeploymentRecord = {
      id: deploymentId,
      walletAddress: settlement.paymentRecord?.payerWallet || "0xAnonymousAgent",
      siteUrl,
      type: "static",
      fileCount: saveResult.fileCount,
      sizeBytes: saveResult.sizeBytes,
      createdAt: now.toISOString(),
      expiresAt,
      status: "active",
      storagePath: storage.getDeploymentDir(deploymentId),
      entrypoint: saveResult.entrypoint,
    };

    db.saveDeployment(deploymentRecord);

    const settlementResponse = Buffer.from(
      JSON.stringify({
        status: "settled",
        txHash: settlement.paymentRecord?.txHash,
        amount: settlement.paymentRecord?.amount,
      })
    ).toString("base64");

    res.setHeader("PAYMENT-RESPONSE", settlementResponse);
    return res.status(200).json({
      success: true,
      id: deploymentId,
      url: siteUrl,
      entrypoint: saveResult.entrypoint,
      fileCount: saveResult.fileCount,
      sizeBytes: saveResult.sizeBytes,
      createdAt: deploymentRecord.createdAt,
      expiresAt: deploymentRecord.expiresAt,
      payment: {
        txHash: settlement.paymentRecord?.txHash,
        amountUSDC: reqAmount / 1_000_000,
        payer: settlement.paymentRecord?.payerWallet,
      },
    });
  } catch (err: any) {
    console.error("Deploy error:", err);
    return res.status(500).json({ error: "Internal Server Error", message: err.message });
  }
});

/**
 * POST /v1/deploy/api
 * Registers an agent's API with an automatic x402 paywall wrapper (Reverse-402)
 */
deployRouter.post("/api", async (req: Request, res: Response) => {
  try {
    const paymentHeader =
      (req.headers["payment-signature"] as string) ||
      (req.headers["payment"] as string) ||
      (req.headers["x-payment"] as string);

    const reqAmount = config.pricing.apiDeployUSDC;
    const requirement = x402.createRequirement(
      reqAmount,
      "/v1/deploy/api",
      "Host402 monetized API endpoint registration"
    );

    if (!paymentHeader) {
      const encoded = x402.encodePaymentRequiredHeader(requirement);
      res.setHeader("PAYMENT-REQUIRED", encoded);
      return res.status(402).json({
        error: "Payment Required",
        message: "Registering a monetized API requires an x402 payment ($0.05 USDC).",
        x402: requirement,
      });
    }

    const { path: apiPath, target_url, price_per_call, owner_wallet } = req.body || {};
    if (!apiPath || !target_url || !price_per_call || !owner_wallet) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Missing required fields: path, target_url, price_per_call, owner_wallet",
      });
    }

    // Clean subpath
    const cleanPath = String(apiPath).replace(/^\/+|\/+$/g, "");
    if (db.getApiEndpoint(cleanPath)) {
      return res.status(409).json({
        error: "Conflict",
        message: `Endpoint path '${cleanPath}' is already registered.`,
      });
    }

    const apiId = generateId("api");
    const settlement = await x402.verifyAndSettlePayment(paymentHeader, requirement, apiId);
    if (!settlement.success) {
      return res.status(402).json({
        error: "Payment Verification Failed",
        details: settlement.error,
      });
    }

    // Parse price per call (convert to atomic units, e.g. "0.005" -> 5000)
    const priceUnits = Math.round(parseFloat(price_per_call) * 1_000_000);

    const endpointRecord: ApiEndpointRecord = {
      id: apiId,
      deploymentId: apiId,
      path: cleanPath,
      targetUrl: target_url,
      pricePerCallUSDC: priceUnits,
      ownerWallet: owner_wallet,
      totalCalls: 0,
      createdAt: new Date().toISOString(),
    };

    db.saveApiEndpoint(endpointRecord);

    const gatewayUrl = `${config.baseUrl}/gateway/${cleanPath}`;

    return res.status(200).json({
      success: true,
      id: apiId,
      path: cleanPath,
      gatewayUrl,
      pricePerCallUSDC: price_per_call,
      ownerWallet: owner_wallet,
      message: "API endpoint successfully monetized with x402 paywall wrapper",
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Internal Server Error", message: err.message });
  }
});

/**
 * GET /v1/sites/:id
 * Retrieve site status and metadata
 */
deployRouter.get("/sites/:id", (req: Request, res: Response) => {
  const dep = db.getDeployment(String(req.params.id));
  if (!dep) {
    return res.status(404).json({ error: "Not Found", message: "Deployment not found" });
  }

  const isExpired = new Date(dep.expiresAt).getTime() < Date.now();
  return res.json({
    ...dep,
    isExpired,
    status: isExpired ? "expired" : dep.status,
  });
});

/**
 * POST /v1/sites/:id/renew
 * Extends the lease of an existing deployment
 */
deployRouter.post("/sites/:id/renew", async (req: Request, res: Response) => {
  const dep = db.getDeployment(String(req.params.id));
  if (!dep) {
    return res.status(404).json({ error: "Not Found", message: "Deployment not found" });
  }

  const paymentHeader =
    (req.headers["payment-signature"] as string) ||
    (req.headers["payment"] as string) ||
    (req.headers["x-payment"] as string);

  const reqAmount = config.pricing.renewalUSDC;
  const requirement = x402.createRequirement(
    reqAmount,
    `/v1/sites/${dep.id}/renew`,
    `Host402 lease extension (30 additional days)`
  );

  if (!paymentHeader) {
    res.setHeader("PAYMENT-REQUIRED", x402.encodePaymentRequiredHeader(requirement));
    return res.status(402).json({
      error: "Payment Required",
      message: "Renewal requires an x402 payment ($0.01 USDC).",
      x402: requirement,
    });
  }

  const settlement = await x402.verifyAndSettlePayment(paymentHeader, requirement, dep.id);
  if (!settlement.success) {
    return res.status(402).json({ error: "Payment Verification Failed", details: settlement.error });
  }

  // Extend 30 days from current expiration or now
  const baseTime = Math.max(new Date(dep.expiresAt).getTime(), Date.now());
  const newExpiresAt = new Date(baseTime + 30 * 24 * 60 * 60 * 1000).toISOString();

  db.updateDeployment(dep.id, { expiresAt: newExpiresAt, status: "active" });

  return res.json({
    success: true,
    id: dep.id,
    newExpiresAt,
    message: "Lease extended by 30 days",
  });
});

/**
 * DELETE /v1/sites/:id
 * Delete site (requires wallet signature or owner match)
 */
deployRouter.delete("/sites/:id", (req: Request, res: Response) => {
  const dep = db.getDeployment(String(req.params.id));
  if (!dep) {
    return res.status(404).json({ error: "Not Found", message: "Deployment not found" });
  }

  // Soft delete record and wipe files
  storage.deleteDeploymentFiles(dep.id);
  db.deleteDeployment(dep.id);

  return res.json({ success: true, message: `Deployment ${dep.id} successfully removed` });
});
