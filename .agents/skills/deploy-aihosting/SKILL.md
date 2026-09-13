---
name: deploy-aihosting
description: >-
  Deploys the Host402 (aihosting) agent cloud hosting and API monetization platform to the production server (aihosting.pjohnsonlabs.com)
  using Node.js, PM2, and Nginx. Enforces mandatory Git commits with informative Conventional Commit messages and pushes to GitHub (https://github.com/drpjohnson/host402).
---

# Deploy Host402 / aihosting Platform Skill

This skill defines the authoritative, repeatable procedure for local TypeScript build verification, mandatory Git versioning, synchronizing changes with the GitHub repository ([https://github.com/drpjohnson/host402](https://github.com/drpjohnson/host402)), deploying the production bundle to the remote server `pjohnsonlabs.com`, configuring PM2 process management (`aihosting-platform` and `host402-showcase`), and conducting live HTTPS health checks.

## 1. Target Environment & Architecture

* **Application Name**: `host402` / `aihosting` (Host402 Agent Cloud Hosting Platform)
* **Production Host**: `root@pjohnsonlabs.com` (Ubuntu Linux, IP `77.42.47.113`)
* **SSH Key**: `~/.ssh/id_rsa` (`$env:USERPROFILE\.ssh\id_rsa`)
* **Remote Project Directory**: `/var/www/aihosting`
* **Process Manager**: PM2
  * Primary Platform Service: `aihosting-platform` (port `4020`, script `dist/index.js`, cwd `/var/www/aihosting`)
  * Showcase Daemon: `host402-showcase` (script `dist/services/showcase-runner.js`, cwd `/var/www/aihosting`)
  * PM2 Ecosystem Config: `deploy/ecosystem.config.cjs`
* **Internal Application Ports**:
  * API Gateway / Web Dashboard: `4020`
  * MCP Server: `4021`
* **Web Server / Reverse Proxy**: Nginx with SSL (`/etc/nginx/sites-available/aihosting.pjohnsonlabs.com` proxying `http://127.0.0.1:4020`)
* **SSL Certificate**: Let's Encrypt TLS (Certbot)
* **Live Production URL**: [https://aihosting.pjohnsonlabs.com](https://aihosting.pjohnsonlabs.com)
* **GitHub Repository**: [https://github.com/drpjohnson/host402](https://github.com/drpjohnson/host402) (`git@github.com:drpjohnson/host402.git`, `master` branch)

---

## 2. Mandatory Git Commit & GitHub Push Protocol

Before any deployment to the production server, all project modifications (source code, frontend assets, configurations, scripts, and documentation) **MUST** be committed to Git and pushed to the GitHub repository [https://github.com/drpjohnson/host402](https://github.com/drpjohnson/host402).

> [!CRITICAL]
> **MANDATORY GITHUB SYNCHRONIZATION**:
> Every single deployment cycle MUST include pushing all committed changes to [https://github.com/drpjohnson/host402](https://github.com/drpjohnson/host402) (`origin master`).
> Deploying to the production server without pushing changes to GitHub is **STRICTLY PROHIBITED**.

> [!IMPORTANT]
> **STRICT COMMIT MESSAGE REQUIREMENT**:
> Commit messages MUST follow the **Conventional Commits** format and clearly, informatively reflect the essence of the actual work completed:
> * Format: `<type>(<scope>): <informative description>`
> * Allowed Types:
>   * `feat`: New feature or user capability (e.g., `feat(api): add batch static upload endpoint`, `feat(showcase): implement autonomous intelligence generation`)
>   * `fix`: Bug fix (e.g., `fix(x402): correct facilitator settlement response parsing`, `fix(storage): sanitize deployment zip extract paths`)
>   * `docs`: Documentation updates (e.g., `docs(architecture): update entity impact graph and deployment guide`)
>   * `refactor`: Code reorganization without behavioral change (e.g., `refactor(gateway): decouple proxy streaming logic`)
>   * `perf`: Performance optimization (e.g., `perf(static): add cache-control headers for static site assets`)
>   * `chore`: Configuration, dependencies, or deployment scripts (e.g., `chore(deploy): configure PM2 ecosystem and local deploy skill`)
>
> Generic or meaningless commit messages such as `"update"`, `"fix"`, `"changes"`, `"wip"`, `"temp"`, or `"minor fixes"` are **STRICTLY FORBIDDEN**.

### Standard Git Workflow:
```powershell
# 1. Review status of modified and untracked files
git status

# 2. Stage all modifications
git add .

# 3. Commit changes with an informative, descriptive message
git commit -m "<type>(<scope>): <clear, informative description of actual work done>"

# 4. ALWAYS push to GitHub repository (https://github.com/drpjohnson/host402)
git push origin master
```

---

## 3. Step-by-Step Deployment Procedure

### Step 1: Pre-Deployment Local Build Verification
Ensure the TypeScript compiler produces clean output without syntax or type errors:
```powershell
npm run build
```

### Step 2: Automated Deployment via Deployment Script (Recommended)
Run the automated deployment script which validates the local build, stages and commits changes, pushes to GitHub (`origin master`), packages project files, uploads bundle to the remote server, runs `npm install --omit=dev`, and starts/reloads PM2:
```powershell
powershell -ExecutionPolicy Bypass -File "deploy/deploy.ps1" -CommitMessage "<type>(<scope>): <informative description>"
```

### Step 3: Manual Deployment Sequence (Fallback / Direct Execution)
If executing steps individually:
```powershell
# 1. Commit and push changes to GitHub
git add .
git commit -m "<type>(<scope>): <informative description>"
git push origin master

# 2. Package deployment bundle (excluding heavy artifacts and data caches)
tar --exclude="*node_modules*" --exclude="*.git*" --exclude="*.tar.gz*" --exclude="*.log*" --exclude="*storage/deployments/*" -czf aihosting_deploy.tar.gz src dist public docs scripts deploy integrations marketing packages .agents package.json package-lock.json tsconfig.json smithery.yaml .gitignore

# 3. Upload archive to production server
scp -o StrictHostKeyChecking=no -i "$env:USERPROFILE\.ssh\id_rsa" aihosting_deploy.tar.gz "root@pjohnsonlabs.com:/var/www/aihosting/deploy_bundle.tar.gz"
Remove-Item aihosting_deploy.tar.gz -Force -ErrorAction SilentlyContinue

# 4. Extract, install dependencies, and reload PM2 ecosystem on server
ssh -o StrictHostKeyChecking=no -i "$env:USERPROFILE\.ssh\id_rsa" root@pjohnsonlabs.com "cd /var/www/aihosting && tar -xzf deploy_bundle.tar.gz && rm -f deploy_bundle.tar.gz && npm install --omit=dev && pm2 startOrRestart deploy/ecosystem.config.cjs --update-env && pm2 save"
```

### Step 4: Health Check & Verification
Verify that both services are online in PM2 and responding with `HTTP 200` on the public domain:
```powershell
# Check PM2 process statuses
ssh -o StrictHostKeyChecking=no -i "$env:USERPROFILE\.ssh\id_rsa" root@pjohnsonlabs.com "pm2 status aihosting-platform host402-showcase"

# Test public live endpoints
curl.exe -Is https://aihosting.pjohnsonlabs.com
curl.exe -s https://aihosting.pjohnsonlabs.com/health
curl.exe -s https://aihosting.pjohnsonlabs.com/api/stats
```

---

## 4. Maintenance & Diagnostics Commands

| Task | Command |
| :--- | :--- |
| **View Real-Time Platform Logs** | `ssh -i "$env:USERPROFILE\.ssh\id_rsa" root@pjohnsonlabs.com "pm2 logs aihosting-platform --lines 50"` |
| **View Showcase Daemon Logs** | `ssh -i "$env:USERPROFILE\.ssh\id_rsa" root@pjohnsonlabs.com "pm2 logs host402-showcase --lines 50"` |
| **Check PM2 Process Details** | `ssh -i "$env:USERPROFILE\.ssh\id_rsa" root@pjohnsonlabs.com "pm2 show aihosting-platform"` |
| **Restart PM2 Services** | `ssh -i "$env:USERPROFILE\.ssh\id_rsa" root@pjohnsonlabs.com "pm2 restart aihosting-platform host402-showcase --update-env"` |
| **Test Nginx & Reload** | `ssh -i "$env:USERPROFILE\.ssh\id_rsa" root@pjohnsonlabs.com "nginx -t && systemctl reload nginx"` |
| **Re-issue SSL Certificate** | `ssh -i "$env:USERPROFILE\.ssh\id_rsa" root@pjohnsonlabs.com "certbot certonly --webroot -w /var/www/certbot -d aihosting.pjohnsonlabs.com --non-interactive --agree-tos --email admin@pjohnsonlabs.com"` |
| **Check SQLite Database** | `ssh -i "$env:USERPROFILE\.ssh\id_rsa" root@pjohnsonlabs.com "ls -la /var/www/aihosting/storage/host402.json"` |
