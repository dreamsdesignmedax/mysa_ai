# MysaAI — Start API server (port 8080)
# Run from the workspace root: .\start-api.ps1

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$apiDir  = Join-Path $rootDir "artifacts\api-server"
$tsx     = Join-Path $rootDir "node_modules\.pnpm\tsx@4.22.4\node_modules\tsx\dist\cli.cjs"
$envFile = Join-Path $rootDir ".env"

Write-Host "Starting MysaAI API server on port 8080..." -ForegroundColor Cyan
Set-Location $apiDir
node --env-file="$envFile" $tsx src/index.ts
