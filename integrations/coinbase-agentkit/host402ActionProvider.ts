/**
 * Host402 Action Provider for Coinbase AgentKit
 * 
 * Enables Coinbase AgentKit agents to deploy static websites and monetize APIs
 * autonomously using their native Base EVM wallet and x402 payment protocol.
 */

import { z } from "zod";

export interface EvmWalletProvider {
  getAddress(): Promise<string>;
  signMessage(message: string): Promise<string>;
  getNetwork(): Promise<{ protocolFamily: string; networkId: string }>;
}

const DeployWebsiteSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().describe("Relative file path, e.g. index.html or styles.css"),
        content: z.string().describe("File content string or base64 encoded string"),
        encoding: z.enum(["utf-8", "base64"]).default("utf-8")
      })
    )
    .describe("List of files to deploy into the web application"),
  ttl_days: z.number().default(30).describe("Lease duration in days (default: 30 days for $0.02 USDC)")
});

const MonetizeApiSchema = z.object({
  path: z.string().describe("Subpath identifier for the public gateway, e.g. 'deep-research'"),
  target_url: z.string().url().describe("Upstream API URL to forward requests to"),
  price_per_call: z.string().default("0.01").describe("Price in USDC per call charged to caller agents")
});

const SearchBazaarSchema = z.object({
  query: z.string().optional().describe("Search filter term for discoverable x402 agent tools")
});

export class Host402ActionProvider {
  private baseUrl: string;

  constructor(baseUrl: string = "https://aihosting.pjohnsonlabs.com") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /**
   * Action: host402_deploy_website
   * Deploys static HTML/JS/CSS files to Host402 with autonomous x402 payment.
   */
  async deployWebsite(
    wallet: EvmWalletProvider,
    args: z.infer<typeof DeployWebsiteSchema>
  ): Promise<string> {
    try {
      const { files, ttl_days = 30 } = args;

      // 1. Send initial unauthenticated request to trigger 402 challenge
      const initRes = await fetch(`${this.baseUrl}/v1/deploy/static`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files, ttl_days })
      });

      if (initRes.status !== 402) {
        const errorText = await initRes.text();
        return `Failed: Expected 402 Payment Required, received ${initRes.status}: ${errorText}`;
      }

      const paymentRequiredHeader = initRes.headers.get("PAYMENT-REQUIRED");
      if (!paymentRequiredHeader) {
        return "Failed: Missing PAYMENT-REQUIRED challenge header from Host402 server.";
      }

      // 2. Decode challenge and sign payment requirement with AgentKit wallet
      const paymentReq = JSON.parse(Buffer.from(paymentRequiredHeader, "base64").toString("utf-8"));
      const accept = paymentReq.accepts?.[0] || paymentReq;
      const agentAddress = await wallet.getAddress();

      const messageToSign = `x402-payment-auth:${accept.payTo}:${accept.amount}:${paymentReq.resource?.path || "/v1/deploy/static"}`;
      const signature = await wallet.signMessage(messageToSign);

      const paymentPayload = {
        x402Version: 2,
        scheme: "exact",
        network: accept.network || "eip155:8453",
        payload: {
          from: agentAddress,
          to: accept.payTo,
          amount: accept.amount,
          asset: accept.asset,
          signature: signature,
          timestamp: Date.now()
        }
      };

      const paymentSignatureHeader = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

      // 3. Resend deployment request with valid payment signature
      const deployRes = await fetch(`${this.baseUrl}/v1/deploy/static`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-SIGNATURE": paymentSignatureHeader
        },
        body: JSON.stringify({ files, ttl_days })
      });

      if (!deployRes.ok) {
        const errText = await deployRes.text();
        return `Payment settlement failed (${deployRes.status}): ${errText}`;
      }

      const data = await deployRes.json();
      return JSON.stringify(
        {
          status: "SUCCESS",
          site_url: data.site_url,
          deployment_id: data.deployment_id,
          expires_at: data.expires_at,
          paid_usdc: "$0.02 USDC",
          network: "Base (eip155:8453)"
        },
        null,
        2
      );
    } catch (err: any) {
      return `Host402 deployment error: ${err.message}`;
    }
  }

  /**
   * Action: host402_monetize_api
   * Registers an agent tool/API behind a Reverse-402 paywall gateway.
   */
  async monetizeApi(
    wallet: EvmWalletProvider,
    args: z.infer<typeof MonetizeApiSchema>
  ): Promise<string> {
    try {
      const ownerWallet = await wallet.getAddress();
      const payload = {
        path: args.path,
        target_url: args.target_url,
        price_per_call: args.price_per_call,
        owner_wallet: ownerWallet
      };

      // 1. Send initial challenge
      const initRes = await fetch(`${this.baseUrl}/v1/deploy/api`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (initRes.status !== 402) {
        return `Failed to initialize 402 gateway: Status ${initRes.status}`;
      }

      const paymentRequiredHeader = initRes.headers.get("PAYMENT-REQUIRED");
      if (!paymentRequiredHeader) {
        return "Failed: Missing PAYMENT-REQUIRED challenge header.";
      }

      const paymentReq = JSON.parse(Buffer.from(paymentRequiredHeader, "base64").toString("utf-8"));
      const accept = paymentReq.accepts?.[0] || paymentReq;

      const messageToSign = `x402-payment-auth:${accept.payTo}:${accept.amount}:${paymentReq.resource?.path || "/v1/deploy/api"}`;
      const signature = await wallet.signMessage(messageToSign);

      const paymentSignatureHeader = Buffer.from(
        JSON.stringify({
          x402Version: 2,
          scheme: "exact",
          network: accept.network || "eip155:8453",
          payload: {
            from: ownerWallet,
            to: accept.payTo,
            amount: accept.amount,
            asset: accept.asset,
            signature,
            timestamp: Date.now()
          }
        })
      ).toString("base64");

      const registerRes = await fetch(`${this.baseUrl}/v1/deploy/api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-SIGNATURE": paymentSignatureHeader
        },
        body: JSON.stringify(payload)
      });

      const resData = await registerRes.json();
      return JSON.stringify(resData, null, 2);
    } catch (err: any) {
      return `API monetization error: ${err.message}`;
    }
  }

  /**
   * Action: host402_search_bazaar
   * Discovers paid and free x402 services available across the network.
   */
  async searchBazaar(_wallet: EvmWalletProvider, args: z.infer<typeof SearchBazaarSchema>): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/discovery/resources`);
      const data = await res.json();
      if (args.query) {
        const q = args.query.toLowerCase();
        const filtered = (data.resources || []).filter((r: any) =>
          r.title?.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q)
        );
        return JSON.stringify(filtered, null, 2);
      }
      return JSON.stringify(data, null, 2);
    } catch (err: any) {
      return `Bazaar search error: ${err.message}`;
    }
  }
}

export const host402ActionProvider = (baseUrl?: string) => new Host402ActionProvider(baseUrl);
