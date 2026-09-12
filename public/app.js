function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  if (tabId === 'static') {
    document.querySelectorAll('.tab-btn')[0].classList.add('active');
    document.getElementById('tabStatic').classList.add('active');
  } else if (tabId === 'api') {
    document.querySelectorAll('.tab-btn')[1].classList.add('active');
    document.getElementById('tabApi').classList.add('active');
  } else if (tabId === 'mcp') {
    document.querySelectorAll('.tab-btn')[2].classList.add('active');
    document.getElementById('tabMcp').classList.add('active');
  }
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById('statNetwork').textContent = data.network.includes('84532') ? 'Base Sepolia' : 'Base Mainnet';
    document.getElementById('statActive').textContent = data.activeDeployments || '0';
    document.getElementById('statVolume').textContent = `${(data.totalVolumeUSDC || 0).toFixed(2)} USDC`;
  } catch (err) {
    console.warn("Failed to load stats:", err);
  }
}

async function runDeployFlow() {
  const logEl = document.getElementById('handshakeLog');
  const statusEl = document.getElementById('stepStatus');
  const resultBox = document.getElementById('liveResultBox');
  const liveLink = document.getElementById('liveSiteLink');
  const iframe = document.getElementById('previewFrame');
  const htmlContent = document.getElementById('htmlInput').value;
  const btn = document.getElementById('btnDeploy');

  btn.disabled = true;
  resultBox.classList.add('hidden');
  logEl.textContent = "";

  const appendLog = (msg) => {
    logEl.textContent += msg + "\n";
    logEl.scrollTop = logEl.scrollHeight;
  };

  try {
    // Step 1: Initial deployment request (No payment header)
    statusEl.textContent = "Step 1: Requesting";
    appendLog("▶ [HTTP Request 1] POST /v1/deploy/static");
    appendLog("  Headers: { 'Content-Type': 'application/json' }");
    appendLog("  Payload: " + JSON.stringify({ files: [{ path: "index.html", size: htmlContent.length }] }));

    const res1 = await fetch('/v1/deploy/static', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{ path: 'index.html', content: htmlContent }]
      })
    });

    appendLog(`◀ [HTTP Response 1] Status: ${res1.status} ${res1.statusText}`);

    if (res1.status === 402) {
      statusEl.textContent = "Step 2: 402 Received";
      const paymentRequiredHeader = res1.headers.get('PAYMENT-REQUIRED');
      appendLog("  Header: PAYMENT-REQUIRED: " + (paymentRequiredHeader ? paymentRequiredHeader.slice(0, 45) + "..." : "present"));

      const data1 = await res1.json();
      const reqDetails = data1.x402?.accepts?.[0];
      appendLog(`  Challenge: Scheme=${reqDetails?.scheme}, Network=${reqDetails?.network}`);
      appendLog(`  Amount: ${reqDetails?.amount} atomic units ($${(Number(reqDetails?.amount)/1000000).toFixed(4)} USDC)`);
      appendLog(`  PayTo: ${reqDetails?.payTo}`);

      // Step 2: Agent signs payment (EIP-712 simulation on Base)
      statusEl.textContent = "Step 3: Signing Payment";
      appendLog("\n⚡ [Agent Wallet] Signing payment payload with private key (EIP-712)...");
      await new Promise(r => setTimeout(r, 600)); // Visual pause for agent thought/signing

      const simulatedPaymentPayload = {
        simulation: true,
        payerWallet: "0xAgent" + Math.random().toString(16).slice(2, 10) + "00000000000000000000000000",
        signature: "0xsimulated_signature_" + Math.random().toString(16).slice(2),
        timestamp: Date.now()
      };
      const signedHeaderValue = btoa(JSON.stringify(simulatedPaymentPayload));

      appendLog("✔ [Agent Wallet] Payment signed. PAYMENT-SIGNATURE generated.");

      // Step 3: Resend request with PAYMENT-SIGNATURE
      statusEl.textContent = "Step 4: Settling";
      appendLog("\n▶ [HTTP Request 2] POST /v1/deploy/static (with payment)");
      appendLog(`  Headers: { 'PAYMENT-SIGNATURE': '${signedHeaderValue.slice(0, 32)}...' }`);

      const res2 = await fetch('/v1/deploy/static', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'PAYMENT-SIGNATURE': signedHeaderValue
        },
        body: JSON.stringify({
          files: [{ path: 'index.html', content: htmlContent }]
        })
      });

      appendLog(`◀ [HTTP Response 2] Status: ${res2.status} ${res2.statusText}`);

      if (res2.ok) {
        const deployResult = await res2.json();
        statusEl.textContent = "Active (200 OK)";
        statusEl.style.color = "var(--success)";
        appendLog("\n🎉 SUCCESS! Settlement confirmed.");
        appendLog(`  Deployment ID: ${deployResult.id}`);
        appendLog(`  Live URL:      ${deployResult.url}`);
        appendLog(`  Expires At:    ${deployResult.expiresAt}`);
        appendLog(`  Tx Hash:       ${deployResult.payment?.txHash}`);

        liveLink.href = deployResult.url;
        liveLink.textContent = deployResult.url;
        iframe.src = deployResult.url;
        resultBox.classList.remove('hidden');

        loadStats();
      } else {
        const errData = await res2.json();
        appendLog("✖ Settlement error: " + JSON.stringify(errData));
      }
    } else {
      appendLog("✖ Expected 402 status, got: " + res1.status);
    }
  } catch (err) {
    appendLog("✖ Flow error: " + err.message);
  } finally {
    btn.disabled = false;
  }
}

async function registerMonetizedApi() {
  const path = document.getElementById('apiPath').value.trim();
  const target = document.getElementById('apiTarget').value.trim();
  const price = document.getElementById('apiPrice').value.trim();
  const wallet = document.getElementById('apiWallet').value.trim();
  const logEl = document.getElementById('apiResultLog');

  logEl.textContent = `[Info] Registering /gateway/${path} with price ${price} USDC...\n`;

  try {
    const res = await fetch('/v1/deploy/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PAYMENT-SIGNATURE': btoa(JSON.stringify({ simulation: true, payer: wallet }))
      },
      body: JSON.stringify({
        path,
        target_url: target,
        price_per_call: price,
        owner_wallet: wallet
      })
    });

    const data = await res.json();
    if (res.ok) {
      logEl.textContent += `✔ Success! API Registered.\n`;
      logEl.textContent += `  Gateway URL:   ${data.gatewayUrl}\n`;
      logEl.textContent += `  Price/Call:    ${data.pricePerCallUSDC} USDC\n`;
      logEl.textContent += `  Owner Wallet:  ${data.ownerWallet}\n`;
      logEl.textContent += `\nTest calling this API without payment to see the 402 challenge:\n`;
      logEl.textContent += `  curl -i ${data.gatewayUrl}`;
      loadStats();
    } else {
      logEl.textContent += `✖ Error: ${data.message || JSON.stringify(data)}`;
    }
  } catch (err) {
    logEl.textContent += `✖ Network error: ${err.message}`;
  }
}

function timeAgo(dateString) {
  const diff = Date.now() - new Date(dateString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

async function loadShowcase() {
  const container = document.getElementById('showcaseFeed');
  if (!container) return;

  try {
    const res = await fetch('/api/showcase');
    if (!res.ok) return;
    const data = await res.json();
    const items = data.items || [];

    if (items.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 2rem;">
          No autonomous deployments found yet. Launch one via the playground below!
        </div>`;
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="showcase-card">
        <div class="showcase-card-header">
          <div>
            <div class="showcase-title">${escapeHtml(item.title || item.id)}</div>
            <span style="font-size: 0.75rem; color: #38bdf8; font-family: monospace;">${item.id}</span>
          </div>
          <span style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; padding: 0.2rem 0.6rem; border-radius: 6px; font-size: 0.75rem; font-weight: 600;">
            $0.02 USDC
          </span>
        </div>
        <div class="showcase-desc">${escapeHtml(item.description || "Autonomous web application")}</div>
        <div class="showcase-footer">
          <div class="showcase-meta">
            <span>🔵 Base Mainnet</span>
            <span>⏱️ ${timeAgo(item.createdAt)}</span>
          </div>
          <a href="${item.url}" target="_blank" class="btn-visit">
            Visit Site ↗
          </a>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.warn("Failed to load showcase:", err);
  }
}

// Initial load
loadStats();
loadShowcase();
setInterval(loadStats, 10000);
setInterval(loadShowcase, 15000);
