# Optional Authenticode signing for Windows WebView NSIS installers.
# CI deliberately does not require signing secrets: unsigned contributors'
# builds remain possible. Do not log or persist the PFX password.
param(
  [string]$BundleDir = "webview/src-tauri/target/release/bundle/nsis"
)
$ErrorActionPreference = "Stop"
$base64 = $env:WINDOWS_CODESIGN_PFX_BASE64
$password = $env:WINDOWS_CODESIGN_PFX_PASSWORD
if ([string]::IsNullOrWhiteSpace($base64) -and [string]::IsNullOrWhiteSpace($password)) {
  Write-Host "Signing secrets not configured; leaving installer unsigned."
  exit 0
}
if ([string]::IsNullOrWhiteSpace($base64) -or [string]::IsNullOrWhiteSpace($password)) {
  throw "Set both WINDOWS_CODESIGN_PFX_BASE64 and WINDOWS_CODESIGN_PFX_PASSWORD."
}
$kits = Join-Path ([Environment]::GetFolderPath("ProgramFilesX86")) "Windows Kits/10/bin"
$signTool = Get-Command signtool.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if (-not $signTool -and (Test-Path $kits)) {
  $signTool = Get-ChildItem $kits -Filter signtool.exe -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending | Select-Object -ExpandProperty FullName -First 1
}
if (-not $signTool) { throw "signtool.exe (x64 Windows SDK) is required to sign release installers" }
$targets = @(Get-ChildItem -LiteralPath $BundleDir -Filter '*.exe' -File)
if ($targets.Count -eq 0) { throw "No NSIS installers to sign under $BundleDir" }
$pfx = Join-Path $env:RUNNER_TEMP ([Guid]::NewGuid().ToString("N") + ".pfx")
try {
  [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($base64))
  foreach ($target in $targets) {
    Write-Host "Signing $($target.Name)"
    & $signTool sign /fd SHA256 /f $pfx /p $password /tr http://timestamp.digicert.com /td SHA256 $target.FullName
    if ($LASTEXITCODE -ne 0) { throw "signtool failed for $($target.Name)" }
    & $signTool verify /pa $target.FullName
    if ($LASTEXITCODE -ne 0) { throw "Authenticode verification failed for $($target.Name)" }
  }
} finally {
  if (Test-Path $pfx) { Remove-Item -LiteralPath $pfx -Force }
}
