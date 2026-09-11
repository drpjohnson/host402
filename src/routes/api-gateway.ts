import { Router, Request, Response } from "express";
import { db } from "../db/index.js";
import { x402 } from "../services/x402.js";

export const apiGatewayRouter = Router();

/**
 * ALL /gateway/:path*
 * Reverse-402 API Gateway:
 * Intercepts incoming calls to an agent's registered API,
 * charges the caller via x402, and forwards the call to the upstream target URL.
 */
apiGatewayRouter.all("/gateway/:apiPath*", async (req: Request, res: Response) => {
  try {
    const apiPath = String(req.params.apiPath);
    const endpoint = db.getApiEndpoint(apiPath);

    if (!endpoint) {
      return res.status(404).json({
        error: "Endpoint Not Found",
        message: `No monetized API registered under path '/gateway/${apiPath}'.`,
      });
    }

    const paymentHeader =
      (req.headers["payment-signature"] as string) ||
      (req.headers["payment"] as string) ||
      (req.headers["x-payment"] as string);

    const priceUnits = endpoint.pricePerCallUSDC;
    const requirement = x402.createRequirement(
      priceUnits,
      req.originalUrl,
      `Access to monetized agent API: ${apiPath}`,
      endpoint.ownerWallet // Pay directly to the creator!
    );

    // If caller hasn't paid, challenge with 402
    if (!paymentHeader) {
      res.setHeader("PAYMENT-REQUIRED", x402.encodePaymentRequiredHeader(requirement));
      return res.status(402).json({
        error: "Payment Required",
        message: `This API requires an x402 micropayment of $${(priceUnits / 1_000_000).toFixed(4)} USDC.`,
        x402: requirement,
      });
    }

    // Verify payment from caller
    const settlement = await x402.verifyAndSettlePayment(paymentHeader, requirement, endpoint.id);
    if (!settlement.success) {
      return res.status(402).json({
        error: "Payment Verification Failed",
        details: settlement.error,
      });
    }

    // Record call
    db.incrementApiCall(endpoint.id);

    // Build upstream target URL
    const subpath = req.params[0] || "";
    const queryString = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const targetBase = endpoint.targetUrl.endsWith("/") ? endpoint.targetUrl.slice(0, -1) : endpoint.targetUrl;
    const targetUrl = `${targetBase}${subpath}${queryString}`;

    // Forward request to upstream
    const fetchHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (
        key.toLowerCase() !== "host" &&
        key.toLowerCase() !== "payment-signature" &&
        key.toLowerCase() !== "payment" &&
        typeof value === "string"
      ) {
        fetchHeaders[key] = value;
      }
    }
    fetchHeaders["x-forwarded-for"] = req.ip || "127.0.0.1";
    fetchHeaders["x-paid-via"] = "host402-x402";

    const fetchOptions: RequestInit = {
      method: req.method,
      headers: fetchHeaders,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
    };

    const upstreamResponse = await fetch(targetUrl, fetchOptions);
    const responseBody = await upstreamResponse.text();

    res.status(upstreamResponse.status);
    upstreamResponse.headers.forEach((val, key) => {
      if (key.toLowerCase() !== "transfer-encoding") {
        res.setHeader(key, val);
      }
    });

    res.setHeader("X-Host402-Monetized", "true");
    res.setHeader("X-Paid-Amount", `${(priceUnits / 1_000_000).toFixed(4)} USDC`);
    return res.send(responseBody);
  } catch (err: any) {
    console.error("Gateway proxy error:", err);
    return res.status(502).json({
      error: "Bad Gateway",
      message: `Failed to proxy request to agent's upstream: ${err.message}`,
    });
  }
});
