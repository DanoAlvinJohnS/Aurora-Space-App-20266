@echo off
setlocal
title FireGlobe - FIRMS downloader
REM ============================================================
REM  Downloads NASA FIRMS active-fire CSVs (MODIS + VIIRS) into
REM  .\dataset\raw  so preprocess.py can read them.
REM  Put this file in the fireglobe folder (next to preprocess.py).
REM  Needs: Windows 10/11 (curl + PowerShell are built in).
REM ============================================================

REM ---- your settings -----------------------------------------
set "MAPKEY=f4c6b9a3bb03523241e4d26df77ac661"
set "START_YEAR=2020"
set "END_YEAR=2025"
REM  Each year is about 73 requests per sensor. Start small (a few years) to test;
REM  MODIS goes back to 2000, VIIRS S-NPP to 2012, VIIRS NOAA-20 to 2018.
REM  Full history is many GB and many hours.
REM ------------------------------------------------------------

set "OUT=%~dp0dataset\raw"
if not exist "%OUT%" mkdir "%OUT%"

echo Downloading %START_YEAR%-%END_YEAR% to %OUT%
echo Already-downloaded files are skipped, so you can stop and re-run any time.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$m='##'+'PS##'; Invoke-Expression ((Get-Content -LiteralPath '%~f0' -Raw) -split $m)[1]"

echo.
set /p RUN=Run preprocess.py now? (Y/N): 
if /i "%RUN%"=="Y" (
  pip install numpy pandas shapely
  python "%~dp0preprocess.py"
)
echo.
pause
exit /b

##PS##
$key   = $env:MAPKEY
$y0    = [int]$env:START_YEAR
$y1    = [int]$env:END_YEAR
$out   = $env:OUT
$step  = 5                                   # days per request (FIRMS area API limit)
$today = (Get-Date).Date
$fail  = @()

# archive (standard processing) sources; recent days automatically use the NRT version
$sources = @(
  @{ n = 'MODIS_SP';         from = [datetime]'2000-11-01' },
  @{ n = 'VIIRS_SNPP_SP';    from = [datetime]'2012-01-20' },
  @{ n = 'VIIRS_NOAA20_SP';  from = [datetime]'2018-01-01' }
)

# quick key check
try {
  $st = Invoke-RestMethod "https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=$key" -TimeoutSec 30
  Write-Host ("Key status: " + ($st | ConvertTo-Json -Compress))
} catch { Write-Host "Could not check key status (continuing): $($_.Exception.Message)" }

foreach ($s in $sources) {
  $dir = Join-Path $out $s.n
  New-Item -ItemType Directory -Force $dir | Out-Null
  $d   = [datetime]"$y0-01-01"
  $end = [datetime]"$y1-12-31"
  if ($end -gt $today) { $end = $today }
  if ($d -lt $s.from) { $d = $s.from }
  Write-Host ""
  Write-Host "=== $($s.n) : $($d.ToString('yyyy-MM-dd')) to $($end.ToString('yyyy-MM-dd')) ==="
  $total = [math]::Ceiling(($end - $d).TotalDays / $step) + 1
  $i = 0
  while ($d -le $end) {
    $i++
    $ds   = $d.ToString('yyyy-MM-dd')
    $file = Join-Path $dir ("{0}_{1}.csv" -f $s.n, $d.ToString('yyyyMMdd'))
    if (-not (Test-Path $file)) {
      $src = $s.n
      if (($today - $d).TotalDays -lt 100) { $src = $src -replace '_SP$', '_NRT' }
      $url = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/$key/$src/world/$step/$ds"
      $ok = $false
      for ($t = 1; $t -le 3 -and -not $ok; $t++) {
        & curl.exe -sS -f --max-time 900 -o "$file.part" $url 2>$null
        if ((Test-Path "$file.part") -and ((Get-Content "$file.part" -TotalCount 1) -match '^latitude')) {
          Move-Item "$file.part" $file -Force
          $ok = $true
        } else {
          Remove-Item "$file.part" -ErrorAction SilentlyContinue
          Start-Sleep -Seconds (10 * $t)
        }
      }
      if ($ok) { $mb = [math]::Round((Get-Item $file).Length / 1MB, 1); Write-Host ("[{0}/{1}] {2} {3}  {4} MB" -f $i, $total, $src, $ds, $mb) }
      else     { Write-Host ("[{0}/{1}] {2} {3}  FAILED" -f $i, $total, $src, $ds); $fail += $url }
    } else {
      Write-Host ("[{0}/{1}] {2} {3}  already have" -f $i, $total, $s.n, $ds)
    }
    $d = $d.AddDays($step)
  }
}

Write-Host ""
if ($fail.Count) {
  Write-Host "$($fail.Count) request(s) failed. Re-run this file to retry them:"
  $fail | ForEach-Object { Write-Host "  $_" }
} else {
  Write-Host "All downloads finished."
}
