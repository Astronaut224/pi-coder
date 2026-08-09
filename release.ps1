param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Version
)

$ErrorActionPreference = "Stop"

# ==========================================
# Pi Coder Release Script
# Usage:
#   .\release.ps1 0.87.3
#   .\release.ps1 v0.87.3
# ==========================================

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Pi Coder Release" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------
# 1. 处理版本号
# ------------------------------------------

if ($Version.StartsWith("v")) {
    $Version = $Version.Substring(1)
}

if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
    throw "版本号格式错误: $Version。示例: 0.87.3"
}

$Tag = "v$Version"

Write-Host "准备发布版本: $Version" -ForegroundColor Green
Write-Host "Git Tag:       $Tag" -ForegroundColor Green
Write-Host ""

# ------------------------------------------
# 2. 检查是否在 Git 仓库
# ------------------------------------------

git rev-parse --is-inside-work-tree 2>$null | Out-Null

if ($LASTEXITCODE -ne 0) {
    throw "当前目录不是 Git 仓库"
}

# ------------------------------------------
# 3. 检查 package.json
# ------------------------------------------

if (-not (Test-Path "package.json")) {
    throw "当前目录不存在 package.json，请在项目根目录执行脚本"
}

# ------------------------------------------
# 4. 检查当前分支
# ------------------------------------------

$CurrentBranch = (git branch --show-current).Trim()

Write-Host "当前分支: $CurrentBranch"

if ($CurrentBranch -ne "main") {
    throw "当前分支不是 main。请先切换到 main 后再发布"
}

# ------------------------------------------
# 5. 检查未提交修改
# ------------------------------------------

$GitStatus = git status --porcelain

if ($GitStatus) {
    Write-Host ""
    Write-Host "检测到未提交的修改：" -ForegroundColor Yellow
    Write-Host $GitStatus
    Write-Host ""

    throw "请先提交或处理当前修改，再执行版本发布"
}

# ------------------------------------------
# 6. 获取远程最新信息
# ------------------------------------------

Write-Host ""
Write-Host "[1/6] 获取远程仓库信息..." -ForegroundColor Cyan

git fetch origin --tags

if ($LASTEXITCODE -ne 0) {
    throw "git fetch 失败"
}

# ------------------------------------------
# 7. 检查 Tag 是否已经存在
# ------------------------------------------

$LocalTag = git tag -l $Tag

if ($LocalTag) {
    throw "本地 Tag $Tag 已经存在，请使用新的版本号"
}

$RemoteTag = git ls-remote --tags origin "refs/tags/$Tag"

if ($RemoteTag) {
    throw "远程 Tag $Tag 已经存在，请使用新的版本号"
}

# ------------------------------------------
# 8. 拉取 main 最新代码
# ------------------------------------------

Write-Host ""
Write-Host "[2/6] 更新 main 分支..." -ForegroundColor Cyan

git pull --ff-only origin main

if ($LASTEXITCODE -ne 0) {
    throw "git pull 失败，请检查本地分支和远程分支状态"
}

# ------------------------------------------
# 9. 显示当前 package.json 版本
# ------------------------------------------

$Package = Get-Content "package.json" -Raw | ConvertFrom-Json
$CurrentVersion = $Package.version

Write-Host ""
Write-Host "当前版本: $CurrentVersion"
Write-Host "目标版本: $Version"

if ($CurrentVersion -eq $Version) {
    throw "package.json 当前已经是 $Version，请更换版本号或手动检查 Tag 状态"
}

# ------------------------------------------
# 10. 更新 package.json + package-lock.json
#     同时创建 commit + git tag
# ------------------------------------------

Write-Host ""
Write-Host "[3/6] 更新项目版本..." -ForegroundColor Cyan

npm version $Version -m "chore(release): v%s"

if ($LASTEXITCODE -ne 0) {
    throw "npm version 执行失败"
}

# ------------------------------------------
# 11. 验证修改结果
# ------------------------------------------

$Package = Get-Content "package.json" -Raw | ConvertFrom-Json
$UpdatedVersion = $Package.version

if ($UpdatedVersion -ne $Version) {
    throw "package.json 版本更新失败"
}

Write-Host ""
Write-Host "package.json version: $UpdatedVersion" -ForegroundColor Green

$CreatedTag = git tag -l $Tag

if (-not $CreatedTag) {
    throw "Git Tag $Tag 创建失败"
}

Write-Host "Git Tag: $Tag" -ForegroundColor Green

# ------------------------------------------
# 12. Push main
# ------------------------------------------

Write-Host ""
Write-Host "[4/6] 推送 main 分支..." -ForegroundColor Cyan

git push origin main

if ($LASTEXITCODE -ne 0) {
    throw "main 分支推送失败"
}

# ------------------------------------------
# 13. Push Tag
# ------------------------------------------

Write-Host ""
Write-Host "[5/6] 推送 Git Tag..." -ForegroundColor Cyan

git push origin $Tag

if ($LASTEXITCODE -ne 0) {
    throw "Tag $Tag 推送失败"
}

# ------------------------------------------
# 完成
# ------------------------------------------

Write-Host ""
Write-Host "[6/6] 发布操作完成" -ForegroundColor Green
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  Pi Coder $Tag 发布成功" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "package.json : $Version"
Write-Host "Git Tag      : $Tag"
Write-Host "Branch       : main"
Write-Host ""
Write-Host "GitHub Actions 应已被 Tag push 自动触发。" -ForegroundColor Cyan
Write-Host ""