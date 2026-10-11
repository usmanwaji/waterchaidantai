# setup-live.ps1 - one-time setup of RID telemetry (telerid) live mode on the Thai-IP Windows PC
#
# Live mode is installed in its own folder: %LOCALAPPDATA%\telerid-live
# (plain ASCII path, outside any Git/OneDrive-synced project folder, so nothing wipes its files).
#
# Does everything in one go:
#   1. stops old live copies, downloads the latest scraper files from GitHub (main branch)
#   2. checks Node.js (offers to install it with winget)
#   3. installs packages + Chromium
#   4. checks / saves the GitHub token (GH_TOKEN)
#   5. disables old telerid tasks (run-hidden.vbs / run-auto.bat) and creates the
#      "telerid live" task (at log on + every 15 minutes, never runs twice)
#   6. starts live mode now and waits for the first upload
#
# Run it (from any folder):
#   - double-click setup-live.bat, or
#   - open PowerShell and paste:
#       irm https://raw.githubusercontent.com/usmanwaji/waterchaidantai/main/telerid-scraper/setup-live.ps1 | iex
#
# Safe to run again any time (updates the files and restarts live mode with the new code).
# This file is ASCII only on purpose: Windows PowerShell 5.1 misreads UTF-8 without BOM.

function Invoke-TeleridSetup {
  $ErrorActionPreference = 'Stop'
  $Repo = 'usmanwaji/waterchaidantai'
  $Branch = 'main'
  if ($env:TELERID_SETUP_BRANCH) { $Branch = $env:TELERID_SETUP_BRANCH }
  $TaskName = 'telerid live'
  $here = Join-Path $env:LOCALAPPDATA 'telerid-live'
  New-Item -ItemType Directory -Force -Path $here | Out-Null
  Set-Location $here

  function Step($n, $t) { Write-Host ''; Write-Host "[$n/6] $t" -ForegroundColor Cyan }
  function Ok($t) { Write-Host "   OK  $t" -ForegroundColor Green }
  function Warn($t) { Write-Host "   !!  $t" -ForegroundColor Yellow }
  function Yes($q) { return ((Read-Host "   $q (y/n)") -match '^\s*[yY]') }

  Write-Host '=== RID telemetry (telerid) live mode setup ===' -ForegroundColor Cyan
  Write-Host "Live mode folder: $here"

  # ---- 1) stop old copies + latest files ----
  Step 1 'Stop old live copies, download the latest scraper files'
  $running = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.CommandLine -and ($_.CommandLine -match 'scrape\.mjs"?\s+--watch' -or $_.CommandLine -match '\brun-live\.bat') })
  foreach ($p in $running) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($running.Count) { Ok "Stopped $($running.Count) old live process(es)" }
  Remove-Item (Join-Path $here 'telerid-live.lock') -Force -ErrorAction SilentlyContinue
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $files = @('scrape.mjs', 'publish-github.mjs', 'package.json', 'run-live.bat', 'run-live-hidden.vbs', 'README.md', '.gitignore')
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('telerid-setup-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $bust = [DateTime]::UtcNow.Ticks
    foreach ($f in $files) {
      Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/$Repo/$Branch/telerid-scraper/${f}?t=$bust" -OutFile (Join-Path $tmp $f)
    }
    # all downloaded fine -> replace (never leave a half-updated folder)
    foreach ($f in $files) { Copy-Item -Force (Join-Path $tmp $f) (Join-Path $here $f) }
  } finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
  Ok ("Updated: " + ($files -join ', '))

  # ---- 2) Node.js ----
  Step 2 'Check Node.js'
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Warn 'Node.js is not installed.'
    if ((Get-Command winget -ErrorAction SilentlyContinue) -and (Yes 'Install Node.js LTS now?')) {
      winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
      $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
      throw 'Node.js not found. Install the LTS version from https://nodejs.org, then run this setup again.'
    }
  }
  $nodeExe = (Get-Command node).Source
  # scheduled tasks may not see a freshly changed PATH -> run-live.bat uses this exact path
  [IO.File]::WriteAllText((Join-Path $here 'node-path.txt'), $nodeExe)
  Ok ('Node.js ' + (& $nodeExe -v) + "  ($nodeExe)")

  # ---- 3) packages ----
  Step 3 'Install packages + Chromium (first time takes 2-3 minutes)'
  npm.cmd install --no-audit --no-fund   # .cmd: npm.ps1 is blocked by the default script policy
  if ($LASTEXITCODE) { throw 'npm install failed (see messages above).' }
  npx.cmd playwright install chromium
  if ($LASTEXITCODE) { throw 'Chromium install failed (see messages above).' }
  Ok 'Packages ready'

  # ---- 4) GitHub token ----
  Step 4 'GitHub token (GH_TOKEN)'
  $tok = [Environment]::GetEnvironmentVariable('GH_TOKEN', 'User')
  if (-not $tok) { $tok = $env:GH_TOKEN }
  for ($try = 0; $try -lt 3; $try++) {
    if (-not $tok) {
      Write-Host '   Paste your GitHub token (starts with github_pat_). How to make one: README.md step 2.'
      $tok = (Read-Host '   GH_TOKEN').Trim()
    }
    $hdr = @{ Authorization = "Bearer $tok"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'telerid-setup' }
    try { Invoke-RestMethod -Headers $hdr -Uri "https://api.github.com/repos/$Repo/branches/main" | Out-Null; break }
    catch { Warn "GitHub did not accept this token ($($_.Exception.Message))."; $tok = '' }
  }
  if (-not $tok) { throw 'No working GitHub token.' }
  [Environment]::SetEnvironmentVariable('GH_TOKEN', $tok, 'User')
  $env:GH_TOKEN = $tok
  Ok 'Token works and is saved for this Windows user'

  # ---- 5) scheduled task ----
  Step 5 'Task Scheduler: turn off the old task, add "telerid live"'
  $old = @(Get-ScheduledTask | Where-Object {
      $_.TaskName -ne $TaskName -and
      ((@($_.Actions) | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' ') -match 'run-hidden\.vbs|run-auto\.bat|run-local\.bat'
    })
  foreach ($t in $old) {
    if ($t.State -ne 'Disabled') { Disable-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath | Out-Null }
    Ok "Old task turned off: $($t.TaskPath)$($t.TaskName)"
  }
  if (-not $old.Count) { Ok 'No old telerid task found' }

  $vbs = Join-Path $here 'run-live-hidden.vbs'
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`"" -WorkingDirectory $here
  $every15 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)
  $logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  # no time limit: Windows must never stop live mode after N minutes
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
  $desc = 'naraflood.com: RID telemetry live scraper (telerid-scraper/run-live-hidden.vbs). Re-launch is safe: exits at once if already running.'
  try {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($every15, $logon) -Settings $settings -Description $desc -Force | Out-Null
    Ok "Task '$TaskName' created: at log on + every 15 minutes"
  } catch {
    # some PCs do not allow a log-on trigger without admin rights; every-15-minutes alone also restarts it after log on
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $every15 -Settings $settings -Description $desc -Force | Out-Null
    Ok "Task '$TaskName' created: every 15 minutes"
  }

  # ---- 6) start now ----
  Step 6 'Start live mode now'
  $log = Join-Path $here 'telerid-live.log'
  $errLog = Join-Path $here 'telerid-live-error.log'
  $seen = 0
  if (Test-Path $log) { $seen = @(Get-Content $log -Encoding UTF8).Count }
  Start-ScheduledTask -TaskName $TaskName
  Write-Host '   Waiting for the first round (up to 3 minutes)...'
  $line = $null
  for ($i = 0; $i -lt 90 -and -not $line; $i++) {
    Start-Sleep -Seconds 2
    if (Test-Path $log) {
      $line = @(Get-Content $log -Encoding UTF8) | Select-Object -Skip $seen | Where-Object { $_ -match '\[(sent|no change|error)\]' } | Select-Object -First 1
    }
  }

  if (-not $line) {
    Warn 'No result yet. Check telerid-live.log and telerid-live-error.log in a few minutes:'
    Write-Host "   $here"
    if (Test-Path $errLog) { Get-Content $errLog -Encoding UTF8 -Tail 15 | ForEach-Object { Write-Host "   $_" } }
  } elseif ($line -match '\[error\]') {
    Warn 'Live mode started but the first round failed:'
    Write-Host "   $line"
    Warn "It retries by itself. If this keeps happening, send telerid-live.log from $here"
    if (Test-Path $errLog) { Get-Content $errLog -Encoding UTF8 -Tail 15 | ForEach-Object { Write-Host "   $_" } }
  } else {
    Ok 'Live mode is running and uploading to GitHub:'
    Write-Host "   $line"
  }

  Write-Host ''
  Write-Host '   The PC must stay on with Thai internet. Sleep stops the updates.'
  if (Yes 'Set this PC to never sleep while plugged in?') {
    powercfg /change standby-timeout-ac 0
    Ok 'Sleep while plugged in: never'
  }

  Write-Host ''
  Write-Host '=== Done ===' -ForegroundColor Green
  Write-Host '   Map: https://naraflood.com/map.html  (layer: RID telemetry) - new readings appear within ~2-5 minutes'
  Write-Host "   Folder: $here"
  Write-Host '   Log: telerid-live.log (one line every 2 minutes) - startup errors: telerid-live-error.log'
  Write-Host '   Old telerid-scraper folders (e.g. inside your project) are no longer used by live mode.'
  Write-Host "   Stop: Task Scheduler > '$TaskName' > Disable, then end node.exe in Task Manager"
}

try { Invoke-TeleridSetup }
catch { Write-Host ''; Write-Host "SETUP FAILED: $($_.Exception.Message)" -ForegroundColor Red }
