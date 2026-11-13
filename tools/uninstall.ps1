# Spotispy — uninstaller. Removes the app + extension, keeps downloaded data
# (IndexedDB) unless you delete the Spotify browser profile by hand.

$ErrorActionPreference = "Stop"
$spicetify = Join-Path $env:APPDATA "spicetify"

$ext = Join-Path $spicetify "Extensions\spotispy.js"
$legacyExt = Join-Path $spicetify "Extensions\playlist-watchtower.js"
$app = Join-Path $spicetify "CustomApps\Spotispy"
$legacyApp = Join-Path $spicetify "CustomApps\PlaylistWatchtower"

# 1. drop our entries from config. The CLI has no remove flag, so the INI is
#    rewritten by hand — line by line, so other values (and their encoding)
#    survive untouched.
$config = Join-Path $spicetify "config-xpui.ini"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $config "$config.spotispy-uninstall-$stamp.bak"

$ours = @("spotispy.js", "playlist-watchtower.js")
$ourApps = @("Spotispy", "PlaylistWatchtower")

$lines = [System.IO.File]::ReadAllLines($config)
$out = New-Object System.Collections.Generic.List[string]
foreach ($line in $lines) {
  if ($line -match '^\s*(extensions|custom_apps)\s*=\s*(.*)$') {
    $key = $Matches[1]
    $value = $Matches[2]
    $remove = if ($key -eq "extensions") { $ours } else { $ourApps }
    $kept = @()
    foreach ($item in ($value -split "\s*\|\s*")) {
      if (-not $item) { continue }
      if ($remove -contains $item.Trim()) { continue }
      $kept += $item.Trim()
    }
    $indent = ($line -replace '^(\s*).*$', '$1')
    $out.Add("$indent$key = " + ($kept -join " | "))
    continue
  }
  $out.Add($line)
}
[System.IO.File]::WriteAllLines($config, $out, (New-Object System.Text.UTF8Encoding($false)))

# 2. remove the files we own
Remove-Item $ext -Force -ErrorAction SilentlyContinue
Remove-Item $legacyExt -Force -ErrorAction SilentlyContinue
if (Test-Path $app) { Remove-Item -Recurse -Force $app }
if (Test-Path $legacyApp) { Remove-Item -Recurse -Force $legacyApp }

spicetify apply
Write-Host "Removed. Backup: $config.spotispy-uninstall-$stamp.bak"
