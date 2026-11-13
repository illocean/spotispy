# Spotispy — explicit installer.
#
# Copies dist/ (produced by `node tools/build.js`) into the live Spicetify
# folder, enables the app and the extension, runs `spicetify apply`, and backs
# up the previous config. Review this script first. Nothing here runs unless you
# call it. From the project root:
#
#   powershell -File tools\install.ps1
#
# To undo everything it did:
#
#   powershell -File tools\uninstall.ps1
#
# The config is updated by REWRITING the two INI lines directly, never by
# piping values through `spicetify config` (its argument parsing once wrote
# duplicated, mangled entries into the user's live config).

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $root "dist"
if (-not (Test-Path $dist)) {
  Write-Host "dist\ is missing; run 'node tools/build.js' first."
  exit 1
}

$spicetify = Join-Path $env:APPDATA "spicetify"
$extDest = Join-Path $spicetify "Extensions\spotispy.js"
$legacyExt = Join-Path $spicetify "Extensions\playlist-watchtower.js"
$appDest = Join-Path $spicetify "CustomApps\Spotispy"
$legacyApp = Join-Path $spicetify "CustomApps\PlaylistWatchtower"
$config = Join-Path $spicetify "config-xpui.ini"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$config.spotispy-$stamp.bak"

# 0. read the current lists from the INI itself; rename only what is ours.
$lines = [System.IO.File]::ReadAllLines($config)
function Get-LineList([string[]]$lines, [string]$key) {
  foreach ($line in $lines) {
    if ($line -match "^\s*$key\s*=\s*(.*)$") {
      $items = @()
      foreach ($part in ($Matches[1] -split "\|")) {
        $item = $part.Trim().Trim('"')
        if ($item) { $items += $item }
      }
      return $items
    }
  }
  return @()
}

$currentExtensions = Get-LineList $lines "extensions"
$currentApps = Get-LineList $lines "custom_apps"

$keep = @()
foreach ($e in $currentExtensions) {
  if ($e -eq "spotispy.js" -or $e -eq "playlist-watchtower.js") { continue }
  $keep += $e
}
$keep += "spotispy.js"
$newExtensions = $keep -join "|"

$keepApps = @()
foreach ($a in $currentApps) {
  if ($a -eq "Spotispy" -or $a -eq "PlaylistWatchtower") { continue }
  $keepApps += $a
}
$keepApps += "Spotispy"
$newApps = $keepApps -join "|"

# 1. backup BEFORE any change
Copy-Item $config $backup
Write-Host "Backed up: $backup"

# 2. copy artifacts
Copy-Item (Join-Path $dist "spotispy.js") $extDest -Force
if (Test-Path $appDest) { Remove-Item -Recurse -Force $appDest }
Copy-Item (Join-Path $dist "CustomApps\Spotispy") $appDest -Recurse -Force
Write-Host "Copied: $extDest"
Write-Host "Copied: $appDest"

# 2b. remove the pre-rename copies (same app, older name)
if (Test-Path $legacyExt) { Remove-Item $legacyExt -Force; Write-Host "Removed old: $legacyExt" }
if (Test-Path $legacyApp) { Remove-Item -Recurse -Force $legacyApp; Write-Host "Removed old: $legacyApp" }

# 3. rewrite the two INI lines, leaving every other line byte-identical
$indentExtensions = "extensions            = "
$indentApps = "custom_apps           = "
$out = New-Object System.Collections.Generic.List[string]
$sawExtensions = $false
$sawApps = $false
foreach ($line in $lines) {
  if ($line -match '^\s*extensions\s*=') {
    $sawExtensions = $true
    $out.Add($indentExtensions + $newExtensions)
    continue
  }
  if ($line -match '^\s*custom_apps\s*=') {
    $sawApps = $true
    $out.Add($indentApps + $newApps)
    continue
  }
  $out.Add($line)
}
if (-not $sawExtensions) { $out.Add($indentExtensions + $newExtensions) }
if (-not $sawApps) { $out.Add($indentApps + $newApps) }
[System.IO.File]::WriteAllLines($config, $out, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "extensions  = $newExtensions"
Write-Host "custom_apps = $newApps"

# 4. verify the file we just wrote; restore the backup on any mismatch
$after = [System.IO.File]::ReadAllLines($config)
$gotExtensions = Get-LineList $after "extensions"
$gotApps = Get-LineList $after "custom_apps"
$expectedExtensions = $keep
$expectedApps = $keepApps
if (($gotExtensions -join "|") -ne ($expectedExtensions -join "|") -or ($gotApps -join "|") -ne ($expectedApps -join "|")) {
  Copy-Item $backup $config -Force
  Write-Host "Post-write verification failed; restored the backup. No changes were kept."
  exit 1
}

# 5. apply
spicetify apply
Write-Host ""
Write-Host "Done. Restart Spotify and look for 'Spotispy' in the sidebar."
Write-Host "If anything looks wrong: restore $backup to config-xpui.ini,"
Write-Host "then 'spicetify restore' to revert the app injection."
