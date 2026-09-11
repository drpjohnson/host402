import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { storage } from "../services/storage.js";
import { x402 } from "../services/x402.js";
import crypto from "node:crypto";

export function createHost402McpServer() {
  const server = new Server(
    {
      name: "host402",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "host402_deploy_website",
          description:
            "Deploys a static website, landing page, or web application to the web with an instant public URL. Uses x402 protocol ($0.02 USDC on Base).",
          inputSchema: {
            type: "object",
            properties: {
              files: {
                type: "array",
                description: "Array of files to deploy (e.g. index.html, styles.css, script.js)",
                items: {
                  type: "object",
                  properties: {
                    path: { type: "string", description: "Relative file path (e.g. 'index.html')" },
                    content: { type: "string", description: "File content (raw text or base64)" },
                    encoding: { type: "string", enum: ["utf-8", "base64"], description: "Encoding" },
                  },
                  required: ["path", "content"],
                },
              },
              ttl_days: {
                type: "number",
                description: "Lease duration in days (default: 30)",
                default: 30,
              },
              payment_signature: {
                type: "string",
                description: "Base64 signed x402 payment payload. Omit to request payment requirements first.",
              },
            },
            required: ["files"],
          },
        },
        {
          name: "host402_deploy_monetized_api",
          description:
            "Hosts and wraps an agent API with an x402 paywall. Caller agents pay USDC per call, and 95% is forwarded directly to your wallet.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Subpath identifier for the API (e.g. 'research-tool')" },
              target_url: { type: "string", description: "Upstream endpoint URL to forward paid requests to" },
              price_per_call: { type: "string", description: "Price in USDC per call (e.g. '0.005')" },
              owner_wallet: { type: "string", description: "Your EVM wallet address to receive payments" },
              payment_signature: {
                type: "string",
                description: "Registration payment signature ($0.05 USDC). Omit to get 402 challenge.",
              },
            },
            required: ["path", "target_url", "price_per_call", "owner_wallet"],
          },
        },
        {
          name: "host402_get_site_info",
          description: "Inspect the status, live URL, and expiration date of a deployed website.",
          inputSchema: {
            type: "object",
            properties: {
              deployment_id: { type: "string", description: "Deployment ID (dep_...)" },
            },
            required: ["deployment_id"],
          },
        },
        {
          name: "host402_list_bazaar_services",
          description: "Search discoverable x402 APIs and tools registered on the Host402 network.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Filter search query" },
            },
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "host402_deploy_website") {
      const files = (args as any)?.files;
      const ttlDays = Number((args as any)?.ttl_days) || 30;
      const paymentSig = (args as any)?.payment_signature;

      const requirement = x402.createRequirement(
        config.pricing.staticDeployUSDC,
        "/v1/deploy/static",
        `Host402 static deployment (${ttlDays} days lease)`
      );

      if (!paymentSig) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "402 Payment Required",
                  instruction:
                    "Sign the following x402 payment requirement with your wallet and resend with 'payment_signature'.",
                  x402_requirement: requirement,
                  payment_required_header: x402.encodePaymentRequiredHeader(requirement),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const depId = `dep_${crypto.randomBytes(6).toString("hex")}`;
      const settlement = await x402.verifyAndSettlePayment(paymentSig, requirement, depId);
      if (!settlement.success) {
        return {
          isError: true,
          content: [{ type: "text", text: `Payment verification failed: ${settlement.error}` }],
        };
      }

      const saveResult = storage.saveFiles(depId, files);
      const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
      const siteUrl = `${config.baseUrl}/sites/${depId}/${saveResult.entrypoint}`;

      db.saveDeployment({
        id: depId,
        walletAddress: settlement.paymentRecord?.payerWallet || "0xAgent",
        siteUrl,
        type: "static",
        fileCount: saveResult.fileCount,
        sizeBytes: saveResult.sizeBytes,
        createdAt: new Date().toISOString(),
        expiresAt,
        status: "active",
        storagePath: storage.getDeploymentDir(depId),
        entrypoint: saveResult.entrypoint,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                deployment_id: depId,
                live_url: siteUrl,
                expires_at: expiresAt,
                message: "Website successfully hosted and live on the internet!",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === "host402_deploy_monetized_api") {
      const { path: apiPath, target_url, price_per_call, owner_wallet, payment_signature } = args as any;
      const cleanPath = String(apiPath).replace(/^\/+|\/+$/g, "");

      const requirement = x402.createRequirement(
        config.pricing.apiDeployUSDC,
        "/v1/deploy/api",
        "Host402 monetized API endpoint registration"
      );

      if (!payment_signature) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "402 Payment Required",
                  instruction:
                    "Sign the following x402 payment requirement with your wallet and resend with 'payment_signature'.",
                  x402_requirement: requirement,
                  payment_required_header: x402.encodePaymentRequiredHeader(requirement),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const apiId = `api_${crypto.randomBytes(6).toString("hex")}`;
      const settlement = await x402.verifyAndSettlePayment(payment_signature, requirement, apiId);
      if (!settlement.success) {
        return {
          isError: true,
          content: [{ type: "text", text: `Payment verification failed: ${settlement.error}` }],
        };
      }

      const priceUnits = Math.round(parseFloat(price_per_call) * 1_000_000);
      db.saveApiEndpoint({
        id: apiId,
        deploymentId: apiId,
        path: cleanPath,
        targetUrl: target_url,
        pricePerCallUSDC: priceUnits,
        ownerWallet: owner_wallet,
        totalCalls: 0,
        createdAt: new Date().toISOString(),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                api_id: apiId,
                gateway_url: `${config.baseUrl}/gateway/${cleanPath}`,
                price_per_call: `${price_per_call} USDC`,
                revenue_share: "95% to owner wallet, 5% platform fee",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === "host402_get_site_info") {
      const dep = db.getDeployment((args as any)?.deployment_id);
      if (!dep) {
        return { isError: true, content: [{ type: "text", text: "Deployment not found" }] };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(dep, null, 2) }],
      };
    }

    if (name === "host402_list_bazaar_services") {
      const endpoints = db.getAllApiEndpoints();
      return {
        content: [{ type: "text", text: JSON.stringify(endpoints, null, 2) }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}

// Auto-run if executed directly
if (process.argv[1]?.includes("server")) {
  const server = createHost402McpServer();
  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    console.error("Host402 MCP Server running on stdio");
  });
}
