<#
  Actualizează Săniuța la vale pe VPS, de pe Windows:
  rulează local testele, typecheck-ul și build-ul de producție; pune server/dist/index.js și client/dist
  într-o singură arhivă .tar.gz; o copiază cu scp; pe server o despachetează într-o versiune nouă și comută
  atomic pe ea (versiunea anterioară rămâne ca current.prev); repornește serviciul saniuta și verifică
  /health pe server și calea publică prin Caddy (/colyseus/status). Dacă health check-ul pică, revine automat la versiunea anterioară.
  Nu conține parole sau chei.
  Exemple:
    .\deploy\push.ps1                                       # alias "oracle" din ~/.ssh/config (utilizator, cheie, port de acolo)
    .\deploy\push.ps1 -Server 203.0.113.10 -Key <cheie>     # fără alias: cheia dată explicit (utilizator implicit: ubuntu)
    .\deploy\push.ps1 -WhatIf                               # testele, build-ul și arhiva local + comenzile care s-ar rula; serverul nu e atins
    .\deploy\push.ps1 -Rollback                             # revine la versiunea anterioară, fără build
  (Instalarea inițială se face cu deploy/setup.sh, vezi deploy/README.md.)
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Server = 'oracle',
  [string]$User = '',
  [string]$Key = '',
  [switch]$Rollback
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
# Public path through Caddy to the server (Caddy answers 404 to /colyseus/health from outside).
$publicHealth = 'https://saniuta-la-vale.duckdns.org/colyseus/status'
$remoteDir = '/tmp/saniuta-push'
$work = Join-Path $env:TEMP 'saniuta-push'
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'   # bsdtar din Windows 10+

if ($Key -and -not (Test-Path $Key)) { throw "Nu găsesc cheia $Key" }
if ($Key -and -not $User) { $User = 'ubuntu' }   # utilizatorul implicit al VPS-ului Oracle
$target = if ($User) { "$User@$Server" } else { $Server }
# BatchMode: no hidden password/passphrase prompt; the timeouts turn a dead connection into an error.
$sshOpts = @('-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=3')
if ($Key) { $sshOpts = @('-i', $Key) + $sshOpts }

function Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }

# The command about to run, as it would be typed.
function Show-Command([string]$Line) { Write-Host "    > $Line" -ForegroundColor DarkGray }

# ssh with stdin closed (-n). Without it, Windows OpenSSH launched from a script whose output PowerShell
# captures keeps reading the console after the remote command has ended, and never exits.
function Invoke-Ssh([string]$Remote) {
  Show-Command "ssh -n $($sshOpts -join ' ') $target `"$Remote`""
  & ssh -n @sshOpts $target $Remote
}

# scp with stdin closed too (an empty pipe), for the same reason.
function Invoke-Scp([string[]]$Files, [string]$Destination) {
  Show-Command "scp $($sshOpts -join ' ') $($Files -join ' ') $Destination"
  $null | & scp @sshOpts @Files $Destination
}

# Rulează o comandă externă și se oprește dacă iese cu cod nenul. Doar codul de ieșire contează:
# Vite, npm și ssh scriu și mesaje normale pe stderr, pe care PowerShell 5.1 le-ar trata ca erori.
function Invoke-Checked([string]$What, [scriptblock]$Command) {
  $ErrorActionPreference = 'Continue'
  & $Command
  if ($LASTEXITCODE) { throw "$What a eșuat (cod $LASTEXITCODE)" }
}

function Test-PublicHealth {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  for ($i = 1; $i -le 10; $i++) {
    try {
      $res = Invoke-WebRequest -Uri $publicHealth -UseBasicParsing -TimeoutSec 5
      # /colyseus/status answers {"ok":true} from the game server itself (not Caddy's index.html fallback).
      if ($res.StatusCode -eq 200 -and $res.Content -match '"ok"\s*:\s*true') {
        Write-Host $res.Content
        return $true
      }
    } catch {
      Write-Host "   încercarea $i/10: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

Push-Location $root
try {
  $dirty = @(git status --porcelain 2>$null)
  if ($dirty.Count -gt 0) {
    Write-Warning "Ai modificări necomise ($($dirty.Count) fișiere); se publică exact ce e acum pe disc."
  }

  # Scriptul rulat de bash pe server: fără CRLF (git pe Windows îl poate scoate cu CRLF).
  New-Item -ItemType Directory -Force -Path $work -WhatIf:$false | Out-Null
  $remoteScript = Join-Path $work 'remote-update.sh'
  $script = (Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'remote-update.sh')) -replace "`r", ''
  [IO.File]::WriteAllText($remoteScript, $script, (New-Object Text.UTF8Encoding $false))
  $upload = @($remoteScript)
  $mode = if ($Rollback) { 'rollback' } else { 'deploy' }

  if (-not $Rollback) {
    Step 'Teste'
    Show-Command 'npm test'
    Invoke-Checked 'npm test' { npm.cmd test }
    Step 'Typecheck'
    Show-Command 'npm run typecheck'
    Invoke-Checked 'npm run typecheck' { npm.cmd run typecheck }
    Step 'Build de producție'
    Show-Command 'npm run build'
    Invoke-Checked 'npm run build' { npm.cmd run build }

    Step 'Arhivez server/dist/index.js și client/dist'
    $stage = Join-Path $work 'release'
    if (Test-Path $stage) { Remove-Item -Recurse -Force $stage -WhatIf:$false }
    New-Item -ItemType Directory -Force -Path (Join-Path $stage 'server') -WhatIf:$false | Out-Null
    Copy-Item 'server\dist\index.js' (Join-Path $stage 'server\index.js') -WhatIf:$false
    # Stack traces in journalctl point at the TypeScript sources (NODE_OPTIONS=--enable-source-maps).
    if (Test-Path 'server\dist\index.js.map') { Copy-Item 'server\dist\index.js.map' (Join-Path $stage 'server\index.js.map') -WhatIf:$false }
    Copy-Item 'client\dist' (Join-Path $stage 'client') -Recurse -WhatIf:$false
    $version = "$(git rev-parse --short HEAD)$(if ($dirty.Count -gt 0) { '-dirty' }) $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    [IO.File]::WriteAllText((Join-Path $stage 'VERSION'), "$version`n", (New-Object Text.UTF8Encoding $false))
    $archive = Join-Path $work 'release.tar.gz'
    Show-Command "tar -czf $archive -C $stage ."
    Invoke-Checked 'tar' { & $tar -czf $archive -C $stage . }
    $upload += $archive
    Write-Host ("   {0} ({1:N2} MB), versiunea {2}" -f $archive, ((Get-Item $archive).Length / 1MB), $version)
  }

  $prepare = "rm -rf $remoteDir && mkdir -p $remoteDir"
  $run = "bash $remoteDir/remote-update.sh $mode"
  $cleanup = "rm -rf $remoteDir"
  $action = if ($Rollback) { 'revin la versiunea anterioară a saniuta' } else { "public versiunea $version și repornesc saniuta" }
  if (-not $PSCmdlet.ShouldProcess($target, $action)) {
    Write-Host "ssh -n $($sshOpts -join ' ') $target `"$prepare`""
    Write-Host "scp $($sshOpts -join ' ') $($upload -join ' ') ${target}:$remoteDir/"
    Write-Host "ssh -n $($sshOpts -join ' ') $target `"$run`""
    Write-Host "verific $publicHealth$(if (-not $Rollback) { ' (dacă pică: rollback automat)' })"
    Write-Host "ssh -n $($sshOpts -join ' ') $target `"$cleanup`""
    return
  }

  Step "Copiez pe $target"
  Invoke-Checked 'ssh (pregătire)' { Invoke-Ssh $prepare }
  Invoke-Checked 'scp' { Invoke-Scp $upload "${target}:$remoteDir/" }

  Step $(if ($Rollback) { 'Revin la versiunea anterioară' } else { 'Instalez și repornesc serviciul' })
  $ErrorActionPreference = 'Continue'   # de aici, doar codurile de ieșire ale ssh decid
  Invoke-Ssh $run
  $code = $LASTEXITCODE
  if ($code -eq 3) { throw 'Serverul nu a pornit sănătos; a revenit automat la versiunea anterioară. Vezi: ssh oracle journalctl -u saniuta -n 50' }
  if ($code) { throw "Actualizarea pe server a eșuat (cod $code). Vezi: ssh oracle journalctl -u saniuta -n 50" }

  Step "Verific $publicHealth"
  Show-Command "Invoke-WebRequest $publicHealth (până la 10 încercări)"
  if (-not (Test-PublicHealth)) {
    if ($Rollback) { throw 'Health check-ul public pică și după rollback: verifică Caddy și DNS-ul.' }
    Write-Warning 'Health check-ul public a eșuat: revin la versiunea anterioară.'
    Invoke-Ssh "bash $remoteDir/remote-update.sh rollback"
    Invoke-Ssh $cleanup
    throw 'Am revenit la versiunea anterioară. Dacă e primul deploy, verifică DNS-ul, porturile 80/443 și Caddy.'
  }
  Step 'Curăț fișierele temporare de pe server'
  Invoke-Ssh $cleanup
  Step 'Gata.'
} finally {
  Pop-Location
}
