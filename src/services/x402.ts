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
            formattedPrice: `$${(amountUnits / 1_000_000).toFixed(4)} USDC`,
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

    // Dev / Test simulation mode:
    // If running in development and dev bypass is enabled or header has simulation tag
    const isDevSimulated =
      config.allowDevBypass &&
      (payload.simulation === true ||
        payload.testnet === true ||
        payload.payer === "mock-agent" ||
        String(paymentHeader).startsWith("sim_") ||
        String(paymentHeader).startsWith("test_"));

    if (isDevSimulated) {
      const payerWallet = (payload.payerWallet as string) || "0xAgentDev0000000000000000000000000000001";
      const txHash = `0xsim_${crypto.randomBytes(28).toString("hex")}`;
      const amount = Number(requirement.accepts[0].amount);

      const record: PaymentRecord = {
        id: `pay_${crypto.randomUUID().slice(0, 8)}`,
        deploymentId,
        txHash,
        payerWallet,
        recipientWallet: requirement.accepts[0].payTo,
        asset: requirement.accepts[0].asset,
        amount,
        scheme: "exact",
        status: "settled",
        createdAt: new Date().toISOString(),
      };

      db.savePayment(record);
      return { success: true, paymentRecord: record };
    }

    // Real On-Chain / Facilitator verification
    try {
      const settleResult = await this.facilitatorClient.settle(payload as any, requirement.accepts[0] as any);
      const payerWallet = (settleResult as any)?.payer || (payload as any)?.payer || "0xPayerUnknown";
      const txHash = (settleResult as any)?.txHash || `0x${crypto.randomBytes(32).toString("hex")}`;
      const amount = Number(requirement.accepts[0].amount);

      const record: PaymentRecord = {
        id: `pay_${crypto.randomUUID().slice(0, 8)}`,
        deploymentId,
        txHash,
        payerWallet,
        recipientWallet: requirement.accepts[0].payTo,
        asset: requirement.accepts[0].asset,
        amount,
        scheme: "exact",
        status: "settled",
        createdAt: new Date().toISOString(),
      };

      db.savePayment(record);
      return { success: true, paymentRecord: record };
    } catch (err: any) {
      // Fallback in case facilitator is offline in test mode
      if (config.allowDevBypass) {
        console.warn("Facilitator call failed in dev mode, falling back to simulated settlement:", err.message);
        const payerWallet = (payload.payerWallet as string) || (payload.from as string) || "0xAgentAutoWallet";
        const txHash = `0xfallback_${crypto.randomBytes(28).toString("hex")}`;
        const amount = Number(requirement.accepts[0].amount);

        const record: PaymentRecord = {
          id: `pay_${crypto.randomUUID().slice(0, 8)}`,
          deploymentId,
          txHash,
          payerWallet,
          recipientWallet: requirement.accepts[0].payTo,
          asset: requirement.accepts[0].asset,
          amount,
          scheme: "exact",
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
