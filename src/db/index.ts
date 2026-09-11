import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export interface DeploymentRecord {
  id: string;
  walletAddress: string;
  siteUrl: string;
  type: "static" | "api";
  fileCount: number;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
  status: "active" | "expired" | "deleted";
  storagePath: string;
  entrypoint: string;
}

export interface PaymentRecord {
  id: string;
  deploymentId: string;
  txHash: string;
  payerWallet: string;
  recipientWallet: string;
  asset: string;
  amount: number;
  scheme: string;
  status: "verified" | "settled" | "failed";
  createdAt: string;
}

export interface ApiEndpointRecord {
  id: string;
  deploymentId: string;
  path: string;
  targetUrl: string;
  pricePerCallUSDC: number; // in atomic units
  ownerWallet: string;
  totalCalls: number;
  createdAt: string;
}

interface DatabaseSchema {
  deployments: Record<string, DeploymentRecord>;
  payments: Record<string, PaymentRecord>;
  apiEndpoints: Record<string, ApiEndpointRecord>;
}

class Database {
  private data: DatabaseSchema = {
    deployments: {},
    payments: {},
    apiEndpoints: {},
  };
  private dbFile: string;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.dbFile = config.dbPath;
    this.init();
  }

  private init() {
    const dir = path.dirname(this.dbFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.dbFile)) {
      try {
        const raw = fs.readFileSync(this.dbFile, "utf-8");
        this.data = JSON.parse(raw);
      } catch (err) {
        console.error("Failed to load db, starting fresh:", err);
      }
    } else {
      this.persistSync();
    }
  }

  private scheduleSave() {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.persistSync();
      this.saveTimeout = null;
    }, 100);
  }

  private persistSync() {
    const tempPath = `${this.dbFile}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), "utf-8");
    fs.renameSync(tempPath, this.dbFile);
  }

  // Deployment operations
  saveDeployment(dep: DeploymentRecord) {
    this.data.deployments[dep.id] = dep;
    this.scheduleSave();
    return dep;
  }

  getDeployment(id: string): DeploymentRecord | undefined {
    return this.data.deployments[id];
  }

  getAllDeployments(filter?: { status?: string; type?: string }): DeploymentRecord[] {
    let list = Object.values(this.data.deployments);
    if (filter?.status) {
      list = list.filter((d) => d.status === filter.status);
    }
    if (filter?.type) {
      list = list.filter((d) => d.type === filter.type);
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  updateDeployment(id: string, updates: Partial<DeploymentRecord>): DeploymentRecord | undefined {
    const dep = this.data.deployments[id];
    if (!dep) return undefined;
    Object.assign(dep, updates);
    this.scheduleSave();
    return dep;
  }

  deleteDeployment(id: string): boolean {
    const dep = this.data.deployments[id];
    if (!dep) return false;
    dep.status = "deleted";
    this.scheduleSave();
    return true;
  }

  // Payment operations
  savePayment(payment: PaymentRecord) {
    this.data.payments[payment.id] = payment;
    this.scheduleSave();
    return payment;
  }

  getPaymentsByDeployment(deploymentId: string): PaymentRecord[] {
    return Object.values(this.data.payments).filter((p) => p.deploymentId === deploymentId);
  }

  getAllPayments(): PaymentRecord[] {
    return Object.values(this.data.payments);
  }

  // API Endpoint operations
  saveApiEndpoint(endpoint: ApiEndpointRecord) {
    this.data.apiEndpoints[endpoint.id] = endpoint;
    this.scheduleSave();
    return endpoint;
  }

  getApiEndpoint(idOrPath: string): ApiEndpointRecord | undefined {
    return (
      this.data.apiEndpoints[idOrPath] ||
      Object.values(this.data.apiEndpoints).find((e) => e.path === idOrPath)
    );
  }

  incrementApiCall(id: string) {
    const ep = this.data.apiEndpoints[id];
    if (ep) {
      ep.totalCalls = (ep.totalCalls || 0) + 1;
      this.scheduleSave();
    }
  }

  getAllApiEndpoints(): ApiEndpointRecord[] {
    return Object.values(this.data.apiEndpoints);
  }

  // Platform Metrics
  getStats() {
    const allDeps = Object.values(this.data.deployments);
    const activeDeps = allDeps.filter((d) => d.status === "active");
    const allPayments = Object.values(this.data.payments);
    const totalVolumeUSDC = allPayments.reduce((acc, p) => acc + (p.amount || 0), 0);
    const totalApiCalls = Object.values(this.data.apiEndpoints).reduce(
      (acc, e) => acc + (e.totalCalls || 0),
      0
    );

    return {
      totalDeployments: allDeps.length,
      activeDeployments: activeDeps.length,
      totalPaymentsCount: allPayments.length,
      totalVolumeUSDC: totalVolumeUSDC / 1_000_000, // convert atomic to formatted
      totalApiCalls,
    };
  }
}

export const db = new Database();
