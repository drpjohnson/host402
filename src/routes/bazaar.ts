import { Router, Request, Response } from "express";
import { config } from "../config.js";
import { db } from "../db/index.js";

export const bazaarRouter = Router();

/**
 * GET /discovery/resources
 * Conforms to the official x402 Bazaar Discovery Layer specification.
 * Returns discoverable HTTP endpoints and tools for autonomous AI agents.
 */
bazaarRouter.get("/discovery/resources", (req: Request, res: Response) => {
  const allEndpoints = db.getAllApiEndpoints();

  // Core Host402 services
  const coreServices = [
    {
      type: "http",
      resource: `${config.baseUrl}/v1/deploy/static`,
      x402Version: 2,
      lastUpdated: new Date().toISOString(),
      accepts: [
        {
          scheme: "exact",
          network: config.network,
          payTo: config.payToAddress,
          amount: config.pricing.staticDeployUSDC.toString(),
          asset: config.usdcAsset,
          maxTimeoutSeconds: 300,
          extra: {
            name: "USD Coin",
            version: "2",
          },
        },
      ],
      extensions: {
        bazaar: {
          info: {
            input: {
              type: "http",
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: {
                files: [
                  {
                    path: "index.html",
                    content: "<h1>My Agent App</h1>",
                  },
                ],
                ttl_days: 30,
              },
            },
            output: {
              type: "json",
              example: {
                success: true,
                id: "dep_01j7...",
                url: `${config.baseUrl}/sites/dep_01j7/index.html`,
                expiresAt: "2026-10-12T00:00:00Z",
              },
            },
          },
        },
      },
    },
    {
      type: "http",
      resource: `${config.baseUrl}/v1/deploy/api`,
      x402Version: 2,
      lastUpdated: new Date().toISOString(),
      accepts: [
        {
          scheme: "exact",
          network: config.network,
          payTo: config.payToAddress,
          amount: config.pricing.apiDeployUSDC.toString(),
          asset: config.usdcAsset,
          maxTimeoutSeconds: 300,
          extra: {
            name: "USD Coin",
            version: "2",
          },
        },
      ],
      extensions: {
        bazaar: {
          info: {
            input: {
              type: "http",
              method: "POST",
              body: {
                path: "my-service",
                target_url: "https://my-backend.internal/endpoint",
                price_per_call: "0.005",
                owner_wallet: "0xYourWalletAddress",
              },
            },
            output: {
              type: "json",
              example: {
                success: true,
                gatewayUrl: `${config.baseUrl}/gateway/my-service`,
              },
            },
          },
        },
      },
    },
  ];

  // User/Agent registered monetized APIs
  const dynamicServices = allEndpoints.map((ep) => ({
    type: "http",
    resource: `${config.baseUrl}/gateway/${ep.path}`,
    x402Version: 2,
    lastUpdated: ep.createdAt,
    accepts: [
      {
        scheme: "exact",
        network: config.network,
        payTo: ep.ownerWallet,
        amount: ep.pricePerCallUSDC.toString(),
        asset: config.usdcAsset,
        maxTimeoutSeconds: 120,
        extra: {
          name: "USD Coin",
          version: "2",
        },
      },
    ],
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "ANY",
          },
          output: {
            type: "json",
          },
        },
      },
    },
  }));

  return res.json({
    items: [...coreServices, ...dynamicServices],
    pagination: {
      total: coreServices.length + dynamicServices.length,
      limit: 100,
      offset: 0,
    },
  });
});
