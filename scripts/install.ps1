$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$baseUrl = "https://github.com/iq-spiral-galaxy/helix/releases/latest/download"
$installer = Join-Path $env:TEMP "Helix-latest-Setup.exe"
$checksums = Join-Path $env:TEMP "Helix-SHA256SUMS.txt"

try {
  Invoke-WebRequest -Uri "$baseUrl/Helix-latest-Setup.exe" -OutFile $installer
  Invoke-WebRequest -Uri "$baseUrl/SHA256SUMS.txt" -OutFile $checksums
  $line = Get-Content $checksums |
    Where-Object { $_ -match "^[a-fA-F0-9]{64}\s+\*?Helix-latest-Setup\.exe$" } |
    Select-Object -First 1
  if (-not $line) {
    throw "설치 파일 체크섬을 찾을 수 없습니다."
  }
  $expected = ($line -split "\s+")[0].ToLowerInvariant()
  $actual = (Get-FileHash -Path $installer -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    throw "설치 파일 체크섬이 일치하지 않습니다."
  }

  Get-Process "Helix" -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Process -FilePath $installer -ArgumentList "/S", "--force-run" -Wait
  Write-Host "Helix 설치를 완료했습니다."
} finally {
  Remove-Item $installer, $checksums -Force -ErrorAction SilentlyContinue
}
