import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

export interface PlatformConfig {
  port: number;
  mcpPort: number;
  baseUrl: string;
  network: string;
  usdcAsset: string;
  payToAddress: string;
  facilitatorUrl: string;
  storageDir: string;
  dbPath: string;
  pricing: {
    staticDeployUSDC: number; // in atomic units (6 decimals): 20000 = $0.02
    apiDeployUSDC: number;    // 50000 = $0.05
    renewalUSDC: number;      // 10000 = $0.01
    platformFeePercent: number; // 5%
  };
  limits: {
    maxFilesPerDeployment: number;
    maxTotalSizeBytes: number; // 25MB
    defaultTtlDays: number;    // 30 days
  };
  allowDevBypass: boolean;
}

const isProduction = process.env.NODE_ENV === "production";
const network = process.env.X402_NETWORK || (isProduction ? "eip155:8453" : "eip155:84532");

// Standard Circle USDC on Base
const usdcAsset = network === "eip155:8453"
  ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // Base Mainnet
  : "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia

export const config: PlatformConfig = {
  port: Number(process.env.PORT || 4020),
  mcpPort: Number(process.env.MCP_PORT || 4021),
  baseUrl: process.env.BASE_URL || (isProduction ? "https://aihosting.pjohnsonlabs.com" : `http://localhost:${process.env.PORT || 4020}`),
  network,
  usdcAsset,
  payToAddress: process.env.X402_PAY_TO || "0x567E4CdDe14FC5D6207B0fA7750b13C7223acF6A",
  facilitatorUrl: process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator",
  storageDir: path.resolve(process.env.STORAGE_DIR || "./storage/deployments"),
  dbPath: path.resolve(process.env.DB_PATH || "./storage/host402.json"),
  pricing: {
    staticDeployUSDC: Number(process.env.PRICE_STATIC_USDC || 20000), // $0.02
    apiDeployUSDC: Number(process.env.PRICE_API_USDC || 50000),       // $0.05
    renewalUSDC: Number(process.env.PRICE_RENEW_USDC || 10000),       // $0.01
    platformFeePercent: 5, // 5% platform fee on monetized APIs
  },
  limits: {
    maxFilesPerDeployment: 500,
    maxTotalSizeBytes: 25 * 1024 * 1024, // 25 MB
    defaultTtlDays: 30,
  },
  allowDevBypass: process.env.ALLOW_DEV_BYPASS === "true" || !isProduction,
};
