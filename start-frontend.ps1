# MysaAI — Start B2C v3 frontend (port 5173)
# Run from the workspace root: .\start-frontend.ps1

$rootDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $rootDir "artifacts\mysa-b2c-v3"

Write-Host "Starting MysaAI frontend on http://localhost:5173" -ForegroundColor Cyan
Set-Location $frontendDir
node_modules\.bin\vite --config vite.config.ts
