<#
  bootstrap-platform-admin.ps1  (ASCII-only - Windows PowerShell 5.1 safe)

  One-time utility: creates (or promotes) the single cross-org PLATFORM_ADMIN
  login by calling POST /api/platform/bootstrap.

  Requires PLATFORM_BOOTSTRAP_SECRET to be set as an env var on the live
  server (the server's server/.env). The endpoint returns
  404 if it is not set.

  SECURITY: never write the real secret or password into this file - it is
  committed to git. Set them for the current PowerShell session only:

      $env:PLATFORM_BOOTSTRAP_SECRET = "<the secret from Render>"
      $env:PLATFORM_ADMIN_EMAIL      = "you@example.com"
      $env:PLATFORM_ADMIN_PASSWORD   = "<a strong password>"
      $env:PLATFORM_ADMIN_NAME       = "Your Name"
      .\bootstrap-platform-admin.ps1

  Safe to re-run later (e.g. to reset the password) - it upserts by email.
  Remove PLATFORM_BOOTSTRAP_SECRET from Render after use to disable the
  endpoint.
#>

$ServerUrl = $env:PLATFORM_SERVER_URL   # e.g. https://crm.example.com - no default, so it can never hit someone else's server
$Secret    = $env:PLATFORM_BOOTSTRAP_SECRET
$Email     = $env:PLATFORM_ADMIN_EMAIL
$Password  = $env:PLATFORM_ADMIN_PASSWORD
$Name      = if ($env:PLATFORM_ADMIN_NAME) { $env:PLATFORM_ADMIN_NAME } else { "Platform Admin" }

if (-not $ServerUrl -or -not $Secret -or -not $Email -or -not $Password) {
    Write-Host "Set PLATFORM_SERVER_URL, PLATFORM_BOOTSTRAP_SECRET, PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD as env vars first - see the comment at the top of this script." -ForegroundColor Yellow
    exit 1
}

$body = @{ email = $Email; password = $Password; name = $Name } | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$ServerUrl/api/platform/bootstrap" `
        -Method Post `
        -Headers @{ "x-platform-bootstrap-secret" = $Secret } `
        -ContentType "application/json" `
        -Body $body

    Write-Host "Platform admin account ready:" -ForegroundColor Green
    $response | Format-List
    Write-Host "Sign in on your app's login page with the email and password above." -ForegroundColor Cyan
}
catch {
    Write-Host "Request failed:" -ForegroundColor Red
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        Write-Host $reader.ReadToEnd()
    } else {
        Write-Host $_.Exception.Message
    }
}
