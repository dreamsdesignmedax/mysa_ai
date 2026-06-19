# MysaAI — Restore database (run ONCE after PostgreSQL service restart)
# Run from the workspace root: .\restore-db.ps1

$pg     = "C:\Program Files\PostgreSQL\18\bin"
$dump   = "D:\Dreams Design Internship Data\mysaai-full-backup\database.sql"

Write-Host "Restoring mysaai database..." -ForegroundColor Cyan
& "$pg\psql.exe" -U postgres -d mysaai -f $dump
Write-Host "Done." -ForegroundColor Green
