<#
.SYNOPSIS
  Sign EC_Tools.exe with an Authenticode code-signing certificate.
  Run this AFTER building with PyInstaller.

.PARAMETER Exe
  Path to the built exe (default: dist\EC_Tools.exe).

.PARAMETER CertThumbprint
  SHA1 thumbprint of the certificate in your Personal certificate store.

.PARAMETER CertFile
  Path to a .pfx certificate file (alternative to CertThumbprint).

.PARAMETER CertPassword
  Password for the .pfx file.

.EXAMPLE
  .\sign_exe.ps1 -Exe dist\EC_Tools.exe -CertThumbprint "A1B2C3D4E5F6..."
  .\sign_exe.ps1 -Exe dist\EC_Tools.exe -CertFile mycert.pfx -CertPassword "***"
#>
param(
  [string]$Exe = "dist\EC_Tools.exe",
  [string]$CertThumbprint = "",
  [string]$CertFile = "",
  [string]$CertPassword = ""
)

$ErrorActionPreference = "Stop"
$exe = (Resolve-Path $Exe).Path
Write-Host "Signing: $exe"

# Locate signtool (Windows SDK / VS Build Tools)
$signtool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\*\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) {
  $signtool = Get-Command signtool -ErrorAction SilentlyContinue
}
if (-not $signtool) {
  throw "signtool.exe not found. Install the Windows SDK (https://developer.microsoft.com/windows/downloads/windows-sdk/) or Visual Studio Build Tools."
}
Write-Host "Using signtool: $($signtool.FullName)"

$argsList = @("sign", "/fd", "SHA256", "/tr", "http://timestamp.digicert.com", "/td", "SHA256")
if ($CertThumbprint) {
  $argsList += @("/sha1", $CertThumbprint)
} elseif ($CertFile) {
  $argsList += @("/f", $CertFile)
  if ($CertPassword) { $argsList += @("/p", $CertPassword) }
} else {
  # Fall back to the strongest certificate in the current user's store
  $argsList += @("/a")
}
$argsList += $exe

& $($signtool.FullName) @argsList
if ($LASTEXITCODE -ne 0) { throw "Signing failed with code $LASTEXITCODE" }

# Verify the signature
& $($signtool.FullName) verify /pa /v $exe

Write-Host ""
Write-Host "Signed successfully."
Write-Host "Next steps (see CODE_SIGNING.md):"
Write-Host "  1. Upload the signed exe to VirusTotal (https://www.virustotal.com)"
Write-Host "  2. Submit it to Microsoft Security Intelligence (https://www.microsoft.com/wdsi/filesubmission)"
Write-Host "  3. Create the GitHub release with the signed exe"
