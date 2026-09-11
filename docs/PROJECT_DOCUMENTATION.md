# Host402 — Master Project Documentation

## 1. System Overview
**Host402** is an agent-native cloud hosting and API monetization platform. It allows autonomous AI agents to deploy web applications, static landing pages, and monetized API endpoints using **x402 V2 (HTTP 402 Payment Required)** with USDC on the Base network (EVM: 8453 / Base Sepolia: 84532), completely eliminating the need for credit cards, human registration, or dashboard logins.

* **Live Production URL**: `https://aihosting.pjohnsonlabs.com`
* **Local Development**: `http://localhost:4020`
* **Process Manager**: PM2 (`aihosting-platform`, port 4020)
* **Web Server & SSL**: Nginx reverse-proxy with Let's Encrypt TLS (HTTP/2) on `77.42.47.113`

---

## 2. Core Entities & Database Schema (SQLite)

```mermaid
erDiagram
    DEPLOYMENT ||--o{ PAYMENT : has
    DEPLOYMENT ||--o{ API_ENDPOINT : hosts
    DEPLOYMENT {
        string id PK "Unique deployment identifier (dep_...)"
        string wallet_address "Owner's EVM wallet address"
        string site_url "Public URL for accessing the site"
        string type "static | api"
        integer file_count "Number of hosted files"
        integer size_bytes "Total storage size in bytes"
        datetime created_at "Creation timestamp"
        datetime expires_at "Expiration timestamp (TTL)"
        string status "active | expired | deleted"
        string storage_path "Filesystem location for assets"
    }
    PAYMENT {
        string id PK "Payment record ID"
        string deployment_id FK "Associated deployment"
        string tx_hash "Transaction hash / settlement proof"
        string payer_wallet "Payer's EVM address"
        string recipient_wallet "Platform receiver address"
        string asset "Token contract (e.g. USDC on Base)"
        string amount "Amount in atomic units (6 decimals)"
        string scheme "exact | upto"
        string status "verified | settled | failed"
        datetime created_at "Payment timestamp"
    }
    API_ENDPOINT {
        string id PK "Unique API endpoint ID"
        string deployment_id FK "Associated deployment"
        string path "Exposed sub-path"
        string target_url "Upstream URL or internal handler"
        string price_per_call "Monetization price in USDC"
        string owner_wallet "Agent wallet receiving 90-95% revenue"
        integer total_calls "Call counter"
        datetime created_at "Creation timestamp"
    }
```

---

## 3. Component Architecture

```mermaid
graph TD
    Client[Autonomous AI Agent / Client] -->|HTTP Request / MCP| Gateway[Host402 API Gateway :4020]
    
    subgraph Gateway Layer
        Gateway --> Auth[SIWX Signature Validator]
        Gateway --> X402Filter[x402 Payment Interceptor]
        Gateway --> StaticRouter[Static Assets Router /sites/:id/*]
        Gateway --> ApiProxy[Reverse-402 API Proxy /gateway/:id/*]
    end

    subgraph Core Services
        X402Filter -->|Verify & Settle| Facilitator[x402 Facilitator / Base Network]
        Gateway --> Storage[Storage Service / File Provisioner]
        Gateway --> DB[(SQLite Metadata Store)]
        Gateway --> Bazaar[x402 Bazaar Catalog Provider]
    end

    subgraph Agent Interfaces
        MCPServer[Host402 MCP Server :4021 / stdio] --> Gateway
        UI[Agentic Dashboard & Playground] --> Gateway
    end
```

---

## 4. API Endpoints Specification

### 4.1. Deployments
* **`POST /v1/deploy/static`**:
  * **Headers**: `PAYMENT-SIGNATURE` (optional on initial call, required after 402 challenge), `Idempotency-Key`.
  * **Body**: Multipart form or JSON `{"files": [{"path": "index.html", "content": "base64..."}], "ttl_days": 30}`.
  * **Returns**: `402 Payment Required` (with `PAYMENT-REQUIRED` header) OR `200 OK` with `{ id, url, expires_at }`.
* **`POST /v1/deploy/api`**:
  * Deploys a monetized API handler with target upstream or script and custom price per call.
* **`GET /v1/sites/:id`**:
  * Returns deployment details, traffic statistics, and remaining lease time.
* **`POST /v1/sites/:id/renew`**:
  * Extends the lease of an existing deployment via x402 payment.
* **`DELETE /v1/sites/:id`**:
  * Removes the deployment. Requires `SIGN-IN-WITH-X` (SIWX) header signed by the site's owner wallet.

### 4.2. x402 Discovery & Bazaar
* **`GET /discovery/resources`**:
  * Compliant with x402 Bazaar discovery specification. Returns machine-readable listings of available hosting and compute resources.

### 4.3. Reverse-402 Monetization Gateway
* **`ALL /gateway/:api_id/*`**:
  * Intercepts calls to an agent's deployed API, enforces the agent's specified x402 fee, retains platform commission (5-10%), forwards remaining balance to the agent's wallet, and proxies the payload to the agent's upstream handler.

---

## 5. Security & Isolation Matrix
* **Network Isolation**: Egress outbound traffic from hosted dynamic code is restricted; port 25 (SMTP) and crypto-mining IPs are strictly firewalled.
* **Path Traversal Protection**: All static file extractions validate relative paths to prevent directory escaping outside `storage/deployments/<id>/`.
* **Idempotency**: All payment transactions require an `Idempotency-Key` preventing double-charging on network retry.

---

## 6. Machine-Readable Agent Discovery & Standards
Host402 implements open AI discovery standards enabling autonomous LLMs and web agents to find, understand, and use the platform automatically:
* **`/llms.txt`**: Standardized Markdown index for LLMs detailing capabilities, pricing, and rapid invocation workflow.
* **`/llms-full.txt`**: Extended technical specification with complete request/response schemas for agent prompt contexts.
* **`/.well-known/agent.json`**: Agent Capability Card specifying authentication (`x402`), payment assets (Base USDC), and RPC endpoints.

---

## 7. Ecosystem Integrations & Distribution
* **Smithery & Glama MCP Registries**: `smithery.yaml` and `packages/mcp-registry/manifest.json` for one-click installation into Claude Desktop, Cursor, and MCP clients.
* **ElizaOS (ai16z)**: Ready-to-use plugin in `integrations/elizaos-plugin/index.ts` with `DEPLOY_WEBSITE` and `MONETIZE_API` autonomous actions.
* **Coinbase AgentKit**: Custom action provider in `integrations/coinbase-agentkit/host402ActionProvider.ts` integrating Host402 into Coinbase-powered EVM agents.
* **x402 Foundation Submission**: Official ecosystem PR draft in `marketing/x402-foundation-submission.md`.
* **Social Launch Kit**: Full announcement threads for Warpcast (`/base`, `/ai-agents`) and Twitter/X in `marketing/launch-announcement.md`.
