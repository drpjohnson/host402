import { app } from "../index.js";
import { Server } from "node:http";

const TEST_PORT = 4022;
let server: Server;

async function runTests() {
  console.log("🚀 Starting Host402 E2E Test Suite...\n");

  server = app.listen(TEST_PORT);
  const baseUrl = `http://localhost:${TEST_PORT}`;

  try {
    // Test 1: Healthcheck
    console.log("1. Testing Health Endpoint (GET /health)...");
    const healthRes = await fetch(`${baseUrl}/health`);
    assert(healthRes.status === 200, `Expected 200, got ${healthRes.status}`);
    const healthData = (await healthRes.json()) as any;
    assert(healthData.status === "healthy", "Expected healthy status");
    console.log("   ✔ Health check passed\n");

    // Test 2: Bazaar Catalog
    console.log("2. Testing Bazaar Discovery (GET /discovery/resources)...");
    const bazaarRes = await fetch(`${baseUrl}/discovery/resources`);
    assert(bazaarRes.status === 200, `Expected 200, got ${bazaarRes.status}`);
    const bazaarData = (await bazaarRes.json()) as any;
    assert(Array.isArray(bazaarData.items), "Expected items array");
    assert(bazaarData.items.length >= 2, "Expected at least 2 core discovery services");
    console.log(`   ✔ Bazaar discovery returned ${bazaarData.items.length} services\n`);

    // Test 3: Deploy without payment (Expect HTTP 402)
    console.log("3. Testing 402 Payment Required Challenge (POST /v1/deploy/static)...");
    const testHtml = "<h1>Agent E2E Verified</h1><p>Test content live</p>";
    const noPayRes = await fetch(`${baseUrl}/v1/deploy/static`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ path: "index.html", content: testHtml }],
      }),
    });

    assert(noPayRes.status === 402, `Expected status 402, got ${noPayRes.status}`);
    const payReqHeader = noPayRes.headers.get("PAYMENT-REQUIRED");
    assert(payReqHeader !== null, "Expected PAYMENT-REQUIRED header");
    const noPayData = (await noPayRes.json()) as any;
    assert(noPayData.x402?.x402Version === 2, "Expected x402Version 2");
    assert(noPayData.x402?.accepts?.[0]?.scheme === "exact", "Expected exact scheme");
    console.log(`   ✔ HTTP 402 Challenge validated: ${noPayData.x402.accepts[0].amount} atomic units USDC\n`);

    // Test 4: Deploy WITH Payment (Expect HTTP 200)
    console.log("4. Testing Autonomous Settlement & Deploy (POST /v1/deploy/static with PAYMENT-SIGNATURE)...");
    const simulatedPayment = {
      simulation: true,
      payerWallet: "0x1111111111111111111111111111111111111111",
      signature: "0xe2e_test_signature",
      timestamp: Date.now(),
    };
    const paymentHeaderValue = Buffer.from(JSON.stringify(simulatedPayment)).toString("base64");

    const payRes = await fetch(`${baseUrl}/v1/deploy/static`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-SIGNATURE": paymentHeaderValue,
      },
      body: JSON.stringify({
        files: [
          { path: "index.html", content: testHtml },
          { path: "styles.css", content: "body { background: black; color: cyan; }" },
        ],
        ttl_days: 30,
      }),
    });

    assert(payRes.status === 200, `Expected 200, got ${payRes.status}`);
    const deployData = (await payRes.json()) as any;
    assert(deployData.success === true, "Expected success: true");
    assert(deployData.id.startsWith("dep_"), "Expected id starting with dep_");
    assert(deployData.fileCount === 2, `Expected 2 files, got ${deployData.fileCount}`);
    const deploymentId = deployData.id;
    console.log(`   ✔ Deployment succeeded: ID=${deploymentId}, URL=${deployData.url}\n`);

    // Test 5: Verify Static Asset Serving
    console.log("5. Testing Asset Serving (GET /sites/:id/index.html)...");
    const serveRes = await fetch(`${baseUrl}/sites/${deploymentId}/index.html`);
    assert(serveRes.status === 200, `Expected 200, got ${serveRes.status}`);
    assert(serveRes.headers.get("x-served-by") === "Host402-Agent-Gateway", "Expected custom server header");
    const serveText = await serveRes.text();
    assert(serveText.includes("Agent E2E Verified"), "Served content does not match uploaded file");
    console.log("   ✔ Static file served accurately with proper headers\n");

    // Test 6: Verify CSS Sub-asset Serving
    console.log("6. Testing Sub-asset Serving (GET /sites/:id/styles.css)...");
    const cssRes = await fetch(`${baseUrl}/sites/${deploymentId}/styles.css`);
    assert(cssRes.status === 200, `Expected 200, got ${cssRes.status}`);
    assert((cssRes.headers.get("content-type") || "").includes("text/css"), "Expected CSS content-type");
    console.log("   ✔ CSS sub-asset served with correct MIME type\n");

    // Test 7: Query Site Status
    console.log("7. Testing Site Metadata Status (GET /v1/sites/:id)...");
    const statusRes = await fetch(`${baseUrl}/v1/sites/${deploymentId}`);
    assert(statusRes.status === 200, `Expected 200, got ${statusRes.status}`);
    const statusData = (await statusRes.json()) as any;
    assert(statusData.status === "active", "Expected active status");
    console.log(`   ✔ Status verified: ${statusData.status}, expiresAt: ${statusData.expiresAt}\n`);

    // Test 8: Renew Lease
    console.log("8. Testing Lease Renewal (POST /v1/sites/:id/renew)...");
    const renewRes = await fetch(`${baseUrl}/v1/sites/${deploymentId}/renew`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-SIGNATURE": paymentHeaderValue,
      },
    });
    assert(renewRes.status === 200, `Expected 200, got ${renewRes.status}`);
    const renewData = (await renewRes.json()) as any;
    assert(renewData.success === true, "Expected renewal success");
    console.log(`   ✔ Lease renewed to: ${renewData.newExpiresAt}\n`);

    // Test 9: Monetize API Registration
    const uniqueApiPath = `test-api-${Date.now()}`;
    console.log(`9. Testing Reverse-402 API Registration (POST /v1/deploy/api for ${uniqueApiPath})...`);
    const apiRegRes = await fetch(`${baseUrl}/v1/deploy/api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-SIGNATURE": paymentHeaderValue,
      },
      body: JSON.stringify({
        path: uniqueApiPath,
        target_url: "https://httpbin.org/anything",
        price_per_call: "0.005",
        owner_wallet: "0xAgentCreatorWallet1234567890",
      }),
    });
    assert(apiRegRes.status === 200, `Expected 200, got ${apiRegRes.status}`);
    const apiRegData = (await apiRegRes.json()) as any;
    assert(apiRegData.success === true, "Expected API reg success");
    console.log(`   ✔ API registered: Gateway URL=${apiRegData.gatewayUrl}\n`);

    // Test 10: Call Monetized Gateway without payment (Expect 402)
    console.log(`10. Testing Calling Monetized API Gateway (GET /gateway/${uniqueApiPath})...`);
    const callWithoutPayRes = await fetch(`${baseUrl}/gateway/${uniqueApiPath}`);
    assert(callWithoutPayRes.status === 402, `Expected 402, got ${callWithoutPayRes.status}`);
    const call402Data = (await callWithoutPayRes.json()) as any;
    assert(call402Data.x402?.accepts?.[0]?.payTo === "0xAgentCreatorWallet1234567890", "Expected payTo to be agent's wallet");
    console.log(`   ✔ Gateway properly challenged caller with 402: price=${call402Data.x402.accepts[0].amount} units\n`);

    // Test 11: Site Deletion
    console.log("11. Testing Site Deletion (DELETE /v1/sites/:id)...");
    const delRes = await fetch(`${baseUrl}/v1/sites/${deploymentId}`, {
      method: "DELETE",
    });
    assert(delRes.status === 200, `Expected 200, got ${delRes.status}`);
    console.log("   ✔ Site marked deleted\n");

    // Test 12: Platform Stats
    console.log("12. Testing Platform Statistics (GET /api/stats)...");
    const statsRes = await fetch(`${baseUrl}/api/stats`);
    assert(statsRes.status === 200, `Expected 200, got ${statsRes.status}`);
    const statsData = (await statsRes.json()) as any;
    assert(statsData.totalDeployments >= 1, "Expected at least 1 deployment in stats");
    console.log(`   ✔ Platform stats verified: Total Deployments=${statsData.totalDeployments}, Volume=${statsData.totalVolumeUSDC} USDC\n`);

    console.log("=================================================");
    console.log("✨ ALL 12 E2E TESTS PASSED SUCCESSFULLY! ✨");
    console.log("=================================================");
    server.close(() => {
      process.exit(0);
    });
  } finally {
    if (server) server.close();
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  if (server) server.close();
  process.exit(1);
});
