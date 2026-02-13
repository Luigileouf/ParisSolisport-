param(
  [string]$BaseUrl = "http://localhost:3000/api/v1",
  [string]$PlayerEmail = "player@example.com",
  [string]$PlayerPassword = "PlayerDemo123!",
  [string]$AdminEmail = "admin@example.com",
  [string]$AdminPassword = "AdminDemo123!",
  [int]$StakePoints = 20,
  [switch]$SkipAdCapTest,
  [switch]$ResetDb
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-Api {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [hashtable]$Headers,
    [object]$Body,
    [string]$ContentType = "application/json"
  )

  try {
    if ($PSBoundParameters.ContainsKey("Body")) {
      $payload = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 10 -Compress }
      return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers -ContentType $ContentType -Body $payload
    }
    return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers
  } catch {
    $statusCode = ""
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $statusCode = [string]([int]$_.Exception.Response.StatusCode)
    }

    $details = $_.ErrorDetails.Message
    if (-not $details) {
      $details = $_.Exception.Message
    }

    throw "HTTP $statusCode on $Method $Uri`n$details"
  }
}

function New-IdemKey {
  param([string]$Prefix)
  return "$Prefix-$([guid]::NewGuid().ToString())"
}

if ($ResetDb) {
  Write-Step "Reset DB schema + reapply migrations (-ResetDb)"
  $backendDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  Push-Location $backendDir
  try {
    $resetDbNodeScript = @'
import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required in backend/.env");
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
await client.end();
console.log("Database schema reset complete.");
'@

    $resetDbNodeScript | node --input-type=module -
    if ($LASTEXITCODE -ne 0) {
      throw "Database reset failed (node exit code $LASTEXITCODE)."
    }

    npm run migrate
    if ($LASTEXITCODE -ne 0) {
      throw "Migration failed after reset (npm exit code $LASTEXITCODE)."
    }
  } finally {
    Pop-Location
  }
}

Write-Step "Health check"
$health = Invoke-Api -Method "GET" -Uri "$BaseUrl/health"
if (-not $health.ok) {
  throw "Health endpoint is not OK."
}

Write-Step "Login player + admin"
$playerLogin = Invoke-Api -Method "POST" -Uri "$BaseUrl/auth/login" -Body @{
  email = $PlayerEmail
  password = $PlayerPassword
}
$adminLogin = Invoke-Api -Method "POST" -Uri "$BaseUrl/auth/login" -Body @{
  email = $AdminEmail
  password = $AdminPassword
}

$playerToken = $playerLogin.accessToken
$adminToken = $adminLogin.accessToken
if (-not $playerToken -or -not $adminToken) {
  throw "Missing access token(s)."
}

$playerHeaders = @{ Authorization = "Bearer $playerToken" }
$adminHeaders = @{ Authorization = "Bearer $adminToken" }

Write-Step "Read player profile (before flow)"
$meBefore = Invoke-Api -Method "GET" -Uri "$BaseUrl/me" -Headers $playerHeaders

Write-Step "Create a fresh market via admin API"
$now = Get-Date
$eventRef = "SMOKE-$($now.ToString('yyyyMMddHHmmss'))"
$createdMarket = Invoke-Api -Method "POST" -Uri "$BaseUrl/admin/markets" -Headers $adminHeaders -Body @{
  title = "Smoke Market $eventRef"
  sport = "football"
  eventRef = $eventRef
  openAt = $now.AddMinutes(-1).ToString("o")
  closeAt = $now.AddHours(3).ToString("o")
  options = @(
    @{ label = "Rouge"; oddsDecimal = 2.0 },
    @{ label = "Bleu"; oddsDecimal = 2.5 },
    @{ label = "Noir"; oddsDecimal = 3.0 }
  )
}

$marketId = $createdMarket.id
if (-not $marketId) {
  throw "Market creation failed: missing market id."
}

Invoke-Api -Method "PATCH" -Uri "$BaseUrl/admin/markets/$marketId/status" -Headers $adminHeaders -Body @{
  status = "OPEN"
} | Out-Null

$market = Invoke-Api -Method "GET" -Uri "$BaseUrl/markets/$marketId"
if (-not $market.options -or $market.options.Count -lt 1) {
  throw "No options found on created market."
}

$winnerOption = $market.options | Where-Object { $_.label -eq "Rouge" } | Select-Object -First 1
if (-not $winnerOption) {
  $winnerOption = $market.options | Select-Object -First 1
}
$winnerOptionId = $winnerOption.id

Write-Step "Place player bet"
$bet = Invoke-Api -Method "POST" -Uri "$BaseUrl/bets" -Headers @{
  Authorization = "Bearer $playerToken"
  "Idempotency-Key" = (New-IdemKey -Prefix "smoke-bet")
} -Body @{
  marketId = $marketId
  optionId = $winnerOptionId
  stakePoints = $StakePoints
}

Write-Step "Settle market as admin"
$settle = Invoke-Api -Method "POST" -Uri "$BaseUrl/admin/markets/$marketId/settle" -Headers $adminHeaders -Body @{
  winnerOptionId = $winnerOptionId
  proofUrl = "https://example.test/smoke-proof"
  note = "smoke test run"
}

Write-Step "Read player profile (after settlement)"
$meAfterSettle = Invoke-Api -Method "GET" -Uri "$BaseUrl/me" -Headers $playerHeaders

Write-Step "Create and redeem a dedicated smoke reward"
$smokeReward = Invoke-Api -Method "POST" -Uri "$BaseUrl/admin/rewards" -Headers $adminHeaders -Body @{
  partnerName = "Smoke Partner"
  title = "Smoke Reward"
  description = "Generated by smoke-test.ps1"
  pointsCost = 10
  stock = 1
  isActive = $true
}

$redeem = Invoke-Api -Method "POST" -Uri "$BaseUrl/rewards/$($smokeReward.id)/redeem" -Headers @{
  Authorization = "Bearer $playerToken"
  "Idempotency-Key" = (New-IdemKey -Prefix "smoke-redeem")
} -Body @{}

$adAcceptedCount = 0
$adBlockedCount = 0

if (-not $SkipAdCapTest) {
  Write-Step "Ad reward flow"
  try {
    Invoke-Api -Method "POST" -Uri "$BaseUrl/ads/reward-callback" -Body @{
      network = "demo_network"
      networkEventId = "smoke-ad-$([guid]::NewGuid().ToString())"
      userExternalId = $meAfterSettle.id
      watched = $true
      signature = "signed"
    } | Out-Null
    $adAcceptedCount += 1
  } catch {
    if ($_.Exception.Message -match "AD_DAILY_LIMIT_REACHED") {
      $adBlockedCount += 1
    } else {
      throw
    }
  }

  Write-Step "Push ad callbacks until cap is observed"
  for ($i = 1; $i -le 6; $i++) {
    if ($adBlockedCount -gt 0) {
      break
    }

    try {
      Invoke-Api -Method "POST" -Uri "$BaseUrl/ads/reward-callback" -Body @{
        network = "demo_network"
        networkEventId = "smoke-ad-cap-$([guid]::NewGuid().ToString())"
        userExternalId = $meAfterSettle.id
        watched = $true
        signature = "signed"
      } | Out-Null
      $adAcceptedCount += 1
    } catch {
      if ($_.Exception.Message -match "AD_DAILY_LIMIT_REACHED") {
        $adBlockedCount += 1
      } else {
        throw
      }
    }
  }

  if ($adBlockedCount -eq 0) {
    throw "Ad daily cap was not observed after multiple callbacks."
  }
} else {
  Write-Step "Ad reward flow skipped (-SkipAdCapTest)"
}

$meFinal = Invoke-Api -Method "GET" -Uri "$BaseUrl/me" -Headers $playerHeaders
$myBets = Invoke-Api -Method "GET" -Uri "$BaseUrl/me/bets" -Headers $playerHeaders
$latestBet = $myBets.items | Where-Object { $_.marketId -eq $marketId } | Select-Object -First 1

Write-Host ""
Write-Host "Smoke test completed." -ForegroundColor Green
Write-Host "----------------------------------------"
Write-Host ("MarketId:            {0}" -f $marketId)
Write-Host ("WinnerOptionId:      {0}" -f $winnerOptionId)
Write-Host ("BetId:               {0}" -f $bet.betId)
Write-Host ("BetStatus:           {0}" -f $latestBet.status)
Write-Host ("SettleWinCount:      {0}" -f $settle.winCount)
Write-Host ("RedeemStatus:        {0}" -f $redeem.status)
Write-Host ("SmokeRewardId:       {0}" -f $smokeReward.id)
Write-Host ("AdAcceptedCount:     {0}" -f $adAcceptedCount)
Write-Host ("AdBlockedCount:      {0}" -f $adBlockedCount)
Write-Host ("BalanceBefore:       {0}" -f $meBefore.pointsBalance)
Write-Host ("BalanceAfterSettle:  {0}" -f $meAfterSettle.pointsBalance)
Write-Host ("BalanceFinal:        {0}" -f $meFinal.pointsBalance)
