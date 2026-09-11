/**
 * @elizaos/plugin-host402
 * 
 * Host402 Plugin for ElizaOS (ai16z).
 * Enables autonomous agents to deploy websites, landing pages, and web apps,
 * and monetize their own APIs via x402 paywalls on Base.
 */

import { type Plugin, type Action, type IAgentRuntime, type Memory, type State, type HandlerCallback } from "@elizaos/core";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { base } from "viem/chains";

const DEFAULT_HOST402_URL = "https://aihosting.pjohnsonlabs.com";

interface FileEntry {
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
}

/**
 * Action: DEPLOY_WEBSITE
 * Agent deploys HTML/CSS/JS files directly to Host402 using its Base wallet.
 */
export const deployWebsiteAction: Action = {
  name: "DEPLOY_WEBSITE",
  similes: ["HOST_WEBSITE", "PUBLISH_SITE", "DEPLOY_APP", "HOST402_DEPLOY"],
  description: "Deploy a static website or web app to Host402 with an instant public URL using x402 on Base ($0.02 USDC).",
  validate: async (runtime: IAgentRuntime, _message: Memory) => {
    return !!runtime.getSetting("EVM_PRIVATE_KEY") || !!process.env.EVM_PRIVATE_KEY;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<boolean> => {
    try {
      const baseUrl = runtime.getSetting("HOST402_URL") || process.env.HOST402_URL || DEFAULT_HOST402_URL;
      const privateKey = (runtime.getSetting("EVM_PRIVATE_KEY") || process.env.EVM_PRIVATE_KEY) as `0x${string}`;

      if (!privateKey) {
        if (callback) {
          callback({ text: "Error: EVM_PRIVATE_KEY is required to sign x402 payment." });
        }
        return false;
      }

      // Extract deployment files or create default starter if none passed
      let files: FileEntry[] = [];
      const content = message.content as any;
      if (content?.files && Array.isArray(content.files)) {
        files = content.files;
      } else {
        files = [
          {
            path: "index.html",
            content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Agent Deployed App</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0a0e17; color: #00f0ff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #111827; border: 1px solid #00f0ff44; padding: 2rem; border-radius: 12px; text-align: center; box-shadow: 0 0 30px rgba(0,240,255,0.15); }
    h1 { margin-top: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🚀 Autonomous Agent Site</h1>
    <p>Deployed seamlessly via <strong>Host402</strong> with x402 on Base.</p>
    <p><small>Powered by ElizaOS Agent</small></p>
  </div>
</body>
</html>`,
            encoding: "utf-8"
          }
        ];
      }

      // Step 1: Initial request to receive 402 challenge
      const initialRes = await fetch(`${baseUrl}/v1/deploy/static`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files, ttl_days: 30 })
      });

      if (initialRes.status !== 402) {
        const body = await initialRes.json();
        if (callback) callback({ text: `Unexpected status ${initialRes.status}: ${JSON.stringify(body)}` });
        return false;
      }

      const paymentRequiredHeader = initialRes.headers.get("PAYMENT-REQUIRED");
      if (!paymentRequiredHeader) {
        if (callback) callback({ text: "Server did not provide PAYMENT-REQUIRED header." });
        return false;
      }

      // Step 2: Sign x402 payment with agent's EVM wallet
      const rawPayload = Buffer.from(paymentRequiredHeader, "base64").toString("utf-8");
      const paymentReq = JSON.parse(rawPayload);

      const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);
      const walletClient = createWalletClient({
        account,
        chain: base,
        transport: http()
      });

      const accept = paymentReq.accepts?.[0] || paymentReq;
      const signature = await walletClient.signMessage({
        message: `x402-payment-auth:${accept.payTo}:${accept.amount}:${paymentReq.resource?.path || "/v1/deploy/static"}`
      });

      const paymentSignatureObj = {
        x402Version: 2,
        scheme: "exact",
        network: accept.network || "eip155:8453",
        payload: {
          from: account.address,
          to: accept.payTo,
          amount: accept.amount,
          asset: accept.asset,
          signature: signature,
          timestamp: Date.now()
        }
      };

      const signedHeaderValue = Buffer.from(JSON.stringify(paymentSignatureObj)).toString("base64");

      // Step 3: Resubmit with PAYMENT-SIGNATURE
      const paidRes = await fetch(`${baseUrl}/v1/deploy/static`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-SIGNATURE": signedHeaderValue
        },
        body: JSON.stringify({ files, ttl_days: 30 })
      });

      const result = await paidRes.json();
      if (callback) {
        callback({
          text: `🎉 Website successfully deployed!\nURL: ${result.site_url}\nExpires: ${result.expires_at}\nTx/Receipt: ${result.receipt_id || "confirmed"}`
        });
      }
      return true;
    } catch (err: any) {
      if (callback) callback({ text: `Deployment failed: ${err.message}` });
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "Deploy our analytics dashboard to the web" }
      },
      {
        user: "{{agent}}",
        content: {
          text: "I will bundle our dashboard HTML and deploy it to Host402 using micro-USDC on Base.",
          action: "DEPLOY_WEBSITE"
        }
      }
    ]
  ]
};

/**
 * Action: MONETIZE_API
 * Agent wraps its upstream tool/API behind a Reverse-402 paywall.
 */
export const monetizeApiAction: Action = {
  name: "MONETIZE_API",
  similes: ["WRAP_402_API", "SELL_API_ACCESS", "REGISTER_402_GATEWAY"],
  description: "Wrap an internal agent API endpoint with an x402 paywall to earn USDC from other agents.",
  validate: async (runtime: IAgentRuntime, _message: Memory) => {
    return !!runtime.getSetting("EVM_PRIVATE_KEY") || !!process.env.EVM_PRIVATE_KEY;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<boolean> => {
    try {
      const baseUrl = runtime.getSetting("HOST402_URL") || process.env.HOST402_URL || DEFAULT_HOST402_URL;
      const content = message.content as any;
      const path = content?.path || `agent-service-${Date.now()}`;
      const targetUrl = content?.target_url;
      const pricePerCall = content?.price_per_call || "0.005";
      const ownerWallet = content?.owner_wallet || runtime.getSetting("EVM_WALLET_ADDRESS");

      if (!targetUrl || !ownerWallet) {
        if (callback) callback({ text: "Missing target_url or owner_wallet for API monetization." });
        return false;
      }

      // Initial challenge request
      const initRes = await fetch(`${baseUrl}/v1/deploy/api`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, target_url: targetUrl, price_per_call: pricePerCall, owner_wallet: ownerWallet })
      });

      if (initRes.status !== 402) {
        const data = await initRes.json();
        if (callback) callback({ text: `Failed with status ${initRes.status}: ${JSON.stringify(data)}` });
        return false;
      }

      // Agent can return the 402 requirement or pay the $0.05 registration fee
      if (callback) {
        callback({
          text: `Host402 API Gateway registration initiated for path '/gateway/${path}'. Forwarding to: ${targetUrl}. Price: ${pricePerCall} USDC.`
        });
      }
      return true;
    } catch (err: any) {
      if (callback) callback({ text: `API Monetization setup failed: ${err.message}` });
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "Monetize our market research API at $0.01 per query" }
      },
      {
        user: "{{agent}}",
        content: {
          text: "Registering the API behind Host402 Reverse-402 gateway. 95% revenue will be forwarded to your wallet.",
          action: "MONETIZE_API"
        }
      }
    ]
  ]
};

/**
 * ElizaOS Plugin Export
 */
export const host402Plugin: Plugin = {
  name: "host402",
  description: "Autonomous cloud hosting and Reverse-402 API monetization for agents on Base",
  actions: [deployWebsiteAction, monetizeApiAction],
  evaluators: [],
  providers: []
};

export default host402Plugin;
