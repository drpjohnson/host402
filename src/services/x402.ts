import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { config } from "../config.js";
import { db, PaymentRecord } from "../db/index.js";
import crypto from "node:crypto";

export interface PaymentRequirementOption {
  scheme: "exact";
  network: string;
  payTo: string;
  amount: string; // atomic units (USDC has 6 decimals)
  asset: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface PaymentRequiredPayload {
  x402Version: number;
  accepts: PaymentRequirementOption[];
  resource: string;
  description: string;
}

import { createPublicClient, http, decodeEventLog } from "viem";
import { base, baseSepolia } from "viem/chains";

const isMainnet = config.network.includes("8453") && !config.network.includes("84532");
const chain = isMainnet ? base : baseSepolia;
const rpcUrl = isMainnet ? "https://mainnet.base.org" : "https://sepolia.base.org";

const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl),
});

const transferEventAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
] as const;

export class X402Service {
  private facilitatorClient: HTTPFacilitatorClient;
  public resourceServer: x402ResourceServer;

  constructor() {
    this.facilitatorClient = new HTTPFacilitatorClient({
      url: config.facilitatorUrl,
    });
    this.resourceServer = new x402ResourceServer(this.facilitatorClient);

    // Register EVM scheme for all supported EVM networks (including Base and Base Sepolia)
    registerExactEvmScheme(this.resourceServer);
  }

  createRequirement(
    amountUnits: number,
    resourcePath: string,
    description: string,
    customPayTo?: string
  ): PaymentRequiredPayload {
    const fullResourceUrl = `${config.baseUrl}${resourcePath}`;
    return {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: config.network,
          payTo: customPayTo || config.payToAddress,
          amount: amountUnits.toString(),
          asset: config.usdcAsset,
          maxTimeoutSeconds: 300,
          extra: {
            name: "USD Coin",
            version: "2",
            formattedPrice: `$${(amountUnits / 1_000_000).toFixed(2)} USDC`,
          },
        },
      ],
      resource: fullResourceUrl,
      description,
    };
  }

  encodePaymentRequiredHeader(payload: PaymentRequiredPayload): string {
    return Buffer.from(JSON.stringify(payload)).toString("base64");
  }

  decodePaymentSignature(headerValue: string): Record<string, unknown> | null {
    try {
      const decoded = Buffer.from(headerValue, "base64").toString("utf-8");
      return JSON.parse(decoded);
    } catch {
      try {
        return JSON.parse(headerValue);
      } catch {
        return null;
      }
    }
  }

  async verifyAndSettlePayment(
    paymentHeader: string | undefined,
    requirement: PaymentRequiredPayload,
    deploymentId: string
  ): Promise<{ success: boolean; error?: string; paymentRecord?: PaymentRecord }> {
    if (!paymentHeader) {
      return { success: false, error: "Missing PAYMENT-SIGNATURE or PAYMENT header" };
    }

    const payload = this.decodePaymentSignature(paymentHeader);
    if (!payload) {
      return { success: false, error: "Malformed payment signature header" };
    }

    const amount = Number(requirement.accepts[0].amount);
    const paymentType: "deploy_static" | "deploy_api" | "renew" | "api_call" =
      requirement.resource?.includes("/v1/deploy/static") || amount === config.pricing.staticDeployUSDC
        ? "deploy_static"
        : requirement.resource?.includes("/v1/deploy/api") || amount === config.pricing.apiDeployUSDC
        ? "deploy_api"
        : requirement.resource?.includes("/renew") || amount === config.pricing.renewalUSDC
        ? "renew"
        : "api_call";

    // 1. Direct On-Chain Transaction Verification (via Base RPC)
    const rawTxHash = (payload.txHash as string) || (payload.transactionHash as string);
    if (typeof rawTxHash === "string" && /^0x[a-fA-F0-9]{64}$/.test(rawTxHash)) {
      const hash = rawTxHash as `0x${string}`;

      // Replay attack prevention
      const existing = db.getAllPayments().find((p) => p.txHash?.toLowerCase() === hash.toLowerCase());
      if (existing) {
        return { success: false, error: "Transaction hash has already been used and settled." };
      }

      try {
        const receipt = await publicClient.getTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          return { success: false, error: "Transaction reverted or failed on Base network." };
        }

        const expectedAsset = requirement.accepts[0].asset.toLowerCase();
        const expectedPayTo = requirement.accepts[0].payTo.toLowerCase();
        const expectedAmount = BigInt(requirement.accepts[0].amount);

        let validTransfer = false;
        let payer = receipt.from;

        for (const log of receipt.logs) {
          if (log.address.toLowerCase() === expectedAsset) {
            try {
              const decoded = decodeEventLog({
                abi: transferEventAbi,
                data: log.data,
                topics: log.topics,
              });
              if (
                decoded.eventName === "Transfer" &&
                decoded.args.to.toLowerCase() === expectedPayTo &&
                decoded.args.value >= expectedAmount
              ) {
                validTransfer = true;
                payer = decoded.args.from;
                break;
              }
            } catch {
              // Not a standard Transfer log, skip
            }
          }
        }

        if (!validTransfer) {
          return {
            success: false,
            error: `Onchain transaction does not contain a valid Transfer of >= ${expectedAmount} USDC to ${requirement.accepts[0].payTo}`,
          };
        }

        const record: PaymentRecord = {
          id: `pay_${crypto.randomUUID().slice(0, 8)}`,
          deploymentId,
          txHash: hash,
          payerWallet: payer,
          recipientWallet: requirement.accepts[0].payTo,
          asset: requirement.accepts[0].asset,
          amount,
          scheme: "exact",
          type: paymentType,
          status: "settled",
          createdAt: new Date().toISOString(),
        };

        db.savePayment(record);
        return { success: true, paymentRecord: record };
      } catch (err: any) {
        return { success: false, error: `Base RPC receipt verification failed: ${err.message}` };
      }
    }

    // 2. Reject simulation if dev bypass is disabled
    const isSimulated =
      payload.simulation === true ||
      payload.testnet === true ||
      payload.payer === "mock-agent" ||
      String(paymentHeader).startsWith("sim_") ||
      String(paymentHeader).startsWith("test_");

    if (isSimulated && !config.allowDevBypass) {
      return {
        success: false,
        error: "Simulated payments are disabled. Host402 operates strictly onchain with Base network (eip155:8453).",
      };
    }

    if (isSimulated && config.allowDevBypass) {
      const payerWallet = (payload.payerWallet as string) || "0xAgentDev0000000000000000000000000000001";
      const txHash = `0xsim_${crypto.randomBytes(28).toString("hex")}`;

      const record: PaymentRecord = {
        id: `pay_${crypto.randomUUID().slice(0, 8)}`,
        deploymentId,
        txHash,
        payerWallet,
        recipientWallet: requirement.accepts[0].payTo,
        asset: requirement.accepts[0].asset,
        amount,
        scheme: "exact",
        type: paymentType,
        status: "settled",
        createdAt: new Date().toISOString(),
      };

      db.savePayment(record);
      return { success: true, paymentRecord: record };
    }

    // 3. EIP-712 Facilitator Verification
    try {
      const settleResult = await this.facilitatorClient.settle(payload as any, requirement.accepts[0] as any);
      const payerWallet = (settleResult as any)?.payer || (payload as any)?.payer || "0xPayerUnknown";
      const txHash = (settleResult as any)?.txHash || `0x${crypto.randomBytes(32).toString("hex")}`;

      const record: PaymentRecord = {
        id: `pay_${crypto.randomUUID().slice(0, 8)}`,
        deploymentId,
        txHash,
        payerWallet,
        recipientWallet: requirement.accepts[0].payTo,
        asset: requirement.accepts[0].asset,
        amount,
        scheme: "exact",
        type: paymentType,
        status: "settled",
        createdAt: new Date().toISOString(),
      };

      db.savePayment(record);
      return { success: true, paymentRecord: record };
    } catch (err: any) {
      if (config.allowDevBypass) {
        console.warn("Facilitator call failed in dev mode, falling back to simulated settlement:", err.message);
        const payerWallet = (payload.payerWallet as string) || (payload.from as string) || "0xAgentAutoWallet";
        const txHash = `0xfallback_${crypto.randomBytes(28).toString("hex")}`;

        const record: PaymentRecord = {
          id: `pay_${crypto.randomUUID().slice(0, 8)}`,
          deploymentId,
          txHash,
          payerWallet,
          recipientWallet: requirement.accepts[0].payTo,
          asset: requirement.accepts[0].asset,
          amount,
          scheme: "exact",
          type: paymentType,
          status: "settled",
          createdAt: new Date().toISOString(),
        };

        db.savePayment(record);
        return { success: true, paymentRecord: record };
      }

      return {
        success: false,
        error: `x402 Facilitator verification failed: ${err.message || "Invalid signature"}`,
      };
    }
  }
}

export const x402 = new X402Service();

