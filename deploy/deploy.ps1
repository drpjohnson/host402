# ====================================================================
# Deployment Script for Host402 Platform -> aihosting.pjohnsonlabs.com
# GitHub: https://github.com/drpjohnson/host402
# ====================================================================

param (
    [string]$CommitMessage = ""
)

$ErrorActionPreference = "Stop"
$SSH_KEY = "$env:USERPROFILE\.ssh\id_rsa"
$REMOTE_HOST = "root@pjohnsonlabs.com"
$REMOTE_DIR = "/var/www/aihosting"

Write-Host "🚀 1. Building local TypeScript project to verify integrity..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Local build failed! Aborting deployment." -ForegroundColor Red
    exit 1
}

Write-Host "🐙 2. Staging changes and checking Git status..." -ForegroundColor Cyan
git add .
$status = git status --porcelain
if ($status) {
    if (-not $CommitMessage -or $CommitMessage -match "^(update|fix|changes|wip|temp|minor|fixes)$") {
        Write-Host "⚠️ Warning: Generic or missing commit message detected! Please provide an informative Conventional Commit message." -ForegroundColor Yellow
        $CommitMessage = "chore(deploy): sync Host402 platform updates and deployment configurations"
    }
    Write-Host "📝 Committing changes: $CommitMessage" -ForegroundColor Green
    git commit -m $CommitMessage
} else {
    Write-Host "ℹ️ No uncommitted changes detected." -ForegroundColor Gray
}

Write-Host "⬆️ Pushing changes to GitHub (https://github.com/drpjohnson/host402)..." -ForegroundColor Cyan
git push origin master
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Git push to origin master failed! Deployment aborted because GitHub sync is mandatory." -ForegroundColor Red
    exit 1
}

Write-Host "📁 3. Ensuring remote directories exist..." -ForegroundColor Cyan
ssh -o StrictHostKeyChecking=no -i $SSH_KEY $REMOTE_HOST "mkdir -p $REMOTE_DIR $REMOTE_DIR/deploy $REMOTE_DIR/docs $REMOTE_DIR/storage/deployments /var/www/certbot"

Write-Host "📦 4. Packaging project archive..." -ForegroundColor Cyan
$excludeArgs = @(
    "--exclude=*node_modules*",
    "--exclude=*.git*",
    "--exclude=*.tar.gz*",
    "--exclude=*.log*",
    "--exclude=*storage/deployments/*"
)
tar @excludeArgs -czf aihosting_deploy.tar.gz src dist public docs scripts deploy integrations marketing packages .agents package.json package-lock.json tsconfig.json smithery.yaml .gitignore

Write-Host "📤 5. Uploading deployment bundle to server..." -ForegroundColor Cyan
scp -o StrictHostKeyChecking=no -i $SSH_KEY aihosting_deploy.tar.gz "$REMOTE_HOST`:$REMOTE_DIR/deploy_bundle.tar.gz"
Remove-Item aihosting_deploy.tar.gz -Force -ErrorAction SilentlyContinue

Write-Host "⚡ 6. Extracting, updating dependencies, and restarting PM2 ecosystem on remote server..." -ForegroundColor Cyan
$REMOTE_SCRIPT = @"
set -e
cd $REMOTE_DIR
tar -xzf deploy_bundle.tar.gz
rm -f deploy_bundle.tar.gz

# Install production dependencies if needed
npm install --omit=dev

# Nginx setup verification
if [ -f "$REMOTE_DIR/deploy/aihosting.pjohnsonlabs.com.conf" ]; then
    cp $REMOTE_DIR/deploy/aihosting.pjohnsonlabs.com.conf /etc/nginx/sites-available/aihosting.pjohnsonlabs.com
    ln -sf /etc/nginx/sites-available/aihosting.pjohnsonlabs.com /etc/nginx/sites-enabled/aihosting.pjohnsonlabs.com
    nginx -t && systemctl reload nginx
fi

# PM2 Ecosystem start or reload
pm2 startOrRestart deploy/ecosystem.config.cjs --update-env
pm2 save
"@

ssh -o StrictHostKeyChecking=no -i $SSH_KEY $REMOTE_HOST $REMOTE_SCRIPT

Write-Host "🔍 7. Validating deployment & live health check..." -ForegroundColor Cyan
ssh -o StrictHostKeyChecking=no -i $SSH_KEY $REMOTE_HOST "pm2 status aihosting-platform host402-showcase"

Start-Sleep -Seconds 2
Write-Host "🌐 Testing HTTPS endpoint https://aihosting.pjohnsonlabs.com ..." -ForegroundColor Cyan
curl.exe -Is https://aihosting.pjohnsonlabs.com

Write-Host "📊 Verifying platform status API..." -ForegroundColor Cyan
curl.exe -s https://aihosting.pjohnsonlabs.com/health
Write-Host ""
curl.exe -s https://aihosting.pjohnsonlabs.com/api/stats
Write-Host ""

Write-Host "`n✅ HOST402 PLATFORM DEPLOYMENT FINISHED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "🌐 Live Endpoint: https://aihosting.pjohnsonlabs.com" -ForegroundColor Yellow
