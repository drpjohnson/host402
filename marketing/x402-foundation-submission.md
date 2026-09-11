# x402 Ecosystem Submission: Host402

Заявка на добавление платформы **Host402** в официальный репозиторий экосистемы **x402 Foundation** (например, `x402-foundation/x402` или `awesome-x402`).

---

## Pull Request Details

- **Title**: Add Host402 to Developer Tools & Hosting Ecosystem
- **Category**: `Dev Tools / Infrastructure & Hosting`
- **Target Repository**: `x402-foundation/x402` (or `awesome-x402`)

### Proposed Markdown Entry for README.md / ECOSYSTEM.md:

```markdown
### Hosting & Infrastructure

- [Host402](https://aihosting.pjohnsonlabs.com) - Agent-native autonomous web hosting and Reverse-402 API monetization platform. Enables AI agents to deploy static sites/SPAs ($0.02 USDC) and wrap upstream APIs with micro-USDC paywalls on Base (`eip155:8453`). Features MCP server, x402 Bazaar discovery catalog, and native machine-readable manifests (`/llms.txt`, `/.well-known/agent.json`).
```

---

## Project Questionnaire & Metadata

| Parameter | Value |
|---|---|
| **Project Name** | Host402 |
| **Website** | https://aihosting.pjohnsonlabs.com |
| **Description** | Autonomous cloud hosting and reverse-402 API monetization platform for AI agents. |
| **x402 Version** | x402 v2 (compatible with `@x402/core` v2.25.0) |
| **Supported Networks** | Base Mainnet (`eip155:8453`), Base Sepolia (`eip155:84532`) |
| **Settlement Asset** | Circle USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) |
| **Receiver Wallet** | `0x567E4CdDe14FC5D6207B0fA7750b13C7223acF6A` |
| **Bazaar Discovery URL** | https://aihosting.pjohnsonlabs.com/discovery/resources |
| **Agent Card Manifest** | https://aihosting.pjohnsonlabs.com/.well-known/agent.json |
| **LLM Machine-Readable Index** | https://aihosting.pjohnsonlabs.com/llms.txt |
| **Model Context Protocol (MCP)** | Stdio server included (`smithery.yaml` registered) |
| **SDKs / Plugins** | ElizaOS (`@elizaos/plugin-host402`), Coinbase AgentKit provider |

---

## Verification & Live Endpoints

- **Live Web Dashboard & Playground**: https://aihosting.pjohnsonlabs.com
- **Health Check**: `curl https://aihosting.pjohnsonlabs.com/health`
- **Machine Discovery**: `curl https://aihosting.pjohnsonlabs.com/.well-known/agent.json`
- **Test Deployment Endpoint**:
  ```bash
  curl -i -X POST https://aihosting.pjohnsonlabs.com/v1/deploy/static \
    -H "Content-Type: application/json" \
    -d '{"files":[{"path":"index.html","content":"<h1>Hello World</h1>"}]}'
  ```
  *(Returns `402 Payment Required` with valid x402 V2 challenge)*
