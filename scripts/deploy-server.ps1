[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SshTarget,

    [string]$AppName = "anime-ongaku-server",
    [string]$RemoteDockerRoot = "dockers",
    [string]$RemoteDataRoot = "docker-data",
    [int]$HostPort = 48668,
    [string]$EnvFile = "",
    [switch]$AllowDefaultEnv,
    [switch]$SkipBuild,
    [switch]$DryRun,
    [int]$HealthTimeoutSeconds = 90
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Quote-Sh([string]$Value) {
    return "'" + $Value.Replace("'", "'""'""'") + "'"
}

function Resolve-RequiredCommand([string]$Name, [string[]]$FallbackPaths = @()) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    foreach ($path in $FallbackPaths) {
        if ($path -and (Test-Path -LiteralPath $path)) {
            return $path
        }
    }
    throw "Required command '$Name' was not found on PATH or in known fallback locations."
}

function Invoke-Logged([string]$FilePath, [string[]]$Arguments) {
    Write-Host "> $FilePath $($Arguments -join ' ')"
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath"
    }
}

function ConvertTo-RemoteShellScript([string]$Script) {
    return $Script.Replace("`r`n", "`n").Replace("`r", "`n")
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$serverDir = Join-Path $repoRoot "server"
$webDir = Join-Path $repoRoot "web"
$remoteDockerDir = "$RemoteDockerRoot/$AppName"
$remoteServerDir = "$remoteDockerDir/server"
$remoteWebDir = "$remoteDockerDir/web"
$remoteDataDir = "$RemoteDataRoot/$AppName"
$remoteDataDirForCompose = if ($remoteDataDir.StartsWith("/")) { Quote-Sh $remoteDataDir } else { "`$HOME/$(Quote-Sh $remoteDataDir)" }
$remoteArchive = "/tmp/$AppName-deploy.tgz"

$sshCommand = Resolve-RequiredCommand "ssh" @("$env:WINDIR\System32\OpenSSH\ssh.exe")
$scpCommand = Resolve-RequiredCommand "scp" @("$env:WINDIR\System32\OpenSSH\scp.exe")

if ($EnvFile -and -not (Test-Path -LiteralPath $EnvFile)) {
    throw "EnvFile does not exist: $EnvFile"
}
if ($HostPort -lt 1 -or $HostPort -gt 65535) {
    throw "HostPort must be between 1 and 65535."
}

$remoteRootCheck = @"
set -eu
case $(Quote-Sh $remoteDockerDir) in
  $(Quote-Sh $RemoteDockerRoot.TrimEnd("/"))/*) ;;
  *) echo "Refusing to deploy outside $(Quote-Sh $RemoteDockerRoot): $(Quote-Sh $remoteDockerDir)" >&2; exit 2 ;;
esac
mkdir -p $(Quote-Sh $remoteServerDir) $(Quote-Sh $remoteWebDir) $(Quote-Sh "$remoteDataDir/media") $(Quote-Sh "$remoteDataDir/postgres")
if [ -f $(Quote-Sh "$remoteDockerDir/.env") ] && [ ! -f $(Quote-Sh "$remoteServerDir/.env") ]; then
  cp $(Quote-Sh "$remoteDockerDir/.env") $(Quote-Sh "$remoteServerDir/.env")
fi
"@

if ($DryRun) {
    Write-Host "Dry run: would prepare remote directories:"
    Write-Host $remoteRootCheck
} else {
    Invoke-Logged $sshCommand @($SshTarget, (ConvertTo-RemoteShellScript $remoteRootCheck))
}

$rsync = Get-Command "rsync" -ErrorAction SilentlyContinue
if ($rsync) {
    $rsyncArgs = @(
        "-az",
        "--delete",
        "--exclude", "node_modules/",
        "--exclude", "dist/",
        "--exclude", "artifacts/",
        "--exclude", ".env",
        "--exclude", ".env.*",
        "--exclude", "test/",
        "--exclude", "vitest.config.ts"
    )
    if ($DryRun) {
        $rsyncArgs += @("--dry-run", "--itemize-changes")
    }
    Invoke-Logged $rsync.Source ($rsyncArgs + @("$serverDir/", "${SshTarget}:$remoteServerDir/"))
    Invoke-Logged $rsync.Source ($rsyncArgs + @("$webDir/", "${SshTarget}:$remoteWebDir/"))
} else {
    $tarCommand = Resolve-RequiredCommand "tar" @("$env:WINDIR\System32\tar.exe")
    $archivePath = Join-Path ([System.IO.Path]::GetTempPath()) "$AppName-deploy.tgz"
    if (Test-Path -LiteralPath $archivePath) {
        Remove-Item -LiteralPath $archivePath -Force
    }
    $tarInputs = @("server", "web", ".dockerignore")
    $tarExcludes = @(
        "--exclude=server/node_modules",
        "--exclude=server/dist",
        "--exclude=server/test",
        "--exclude=server/.env",
        "--exclude=server/.env.*",
        "--exclude=web/node_modules",
        "--exclude=web/dist",
        "--exclude=web/coverage"
    )
    Invoke-Logged $tarCommand (@("-czf", $archivePath) + $tarExcludes + @("-C", $repoRoot) + $tarInputs)
    if ($DryRun) {
        Write-Host "Dry run: would upload $archivePath to ${SshTarget}:$remoteArchive and extract into $remoteDockerDir"
    } else {
        Invoke-Logged $scpCommand @($archivePath, "${SshTarget}:$remoteArchive")
        $extractCommand = @"
set -eu
cd $(Quote-Sh $remoteDockerDir)
rm -rf server/src server/drizzle server/dist web
tar -xzf $(Quote-Sh $remoteArchive)
rm -f $(Quote-Sh $remoteArchive)
"@
        Invoke-Logged $sshCommand @($SshTarget, (ConvertTo-RemoteShellScript $extractCommand))
    }
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
}

if ($EnvFile) {
    if ($DryRun) {
        Write-Host "Dry run: would copy $EnvFile to ${SshTarget}:$remoteServerDir/.env"
    } else {
        Invoke-Logged $scpCommand @($EnvFile, "${SshTarget}:$remoteServerDir/.env")
    }
}

$allowDefaultEnvValue = if ($AllowDefaultEnv) { "1" } else { "0" }
$buildFlag = if ($SkipBuild) { "" } else { "--build" }
$healthTimeout = [Math]::Max(0, $HealthTimeoutSeconds)
$remoteDeploy = @"
set -eu
cd $(Quote-Sh $remoteServerDir)
export ONGAKU_DATA_ROOT=$remoteDataDirForCompose
export ONGAKU_SERVER_HOST_PORT=$(Quote-Sh ([string]$HostPort))
if [ ! -f .env ] && [ "$allowDefaultEnvValue" != "1" ]; then
  echo "Missing $remoteServerDir/.env. Pass -EnvFile <path> once, or use -AllowDefaultEnv intentionally." >&2
  exit 3
fi
if docker compose version >/dev/null 2>&1; then
  dc() { docker compose --env-file .env "`$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  dc() { docker-compose --env-file .env "`$@"; }
else
  echo "Docker Compose is not installed on the remote host." >&2
  exit 4
fi
dc -p $(Quote-Sh $AppName) -f docker-compose.yml -f docker-compose.lan.yml config >/dev/null
dc -p $(Quote-Sh $AppName) -f docker-compose.yml -f docker-compose.lan.yml up -d $buildFlag
healthcheck() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS http://127.0.0.1:${HostPort}/healthz >/dev/null 2>&1
  else
    wget -qO- http://127.0.0.1:${HostPort}/healthz >/dev/null 2>&1
  fi
}
if [ "$healthTimeout" -gt 0 ]; then
  deadline=`$((`$(date +%s) + $healthTimeout))
  until healthcheck; do
    if [ "`$(date +%s)" -ge "`$deadline" ]; then
      echo "Health check failed after ${healthTimeout}s" >&2
      dc -p $(Quote-Sh $AppName) -f docker-compose.yml -f docker-compose.lan.yml ps >&2
      dc -p $(Quote-Sh $AppName) -f docker-compose.yml -f docker-compose.lan.yml logs --tail=80 api >&2
      exit 5
    fi
    sleep 2
  done
fi
dc -p $(Quote-Sh $AppName) -f docker-compose.yml -f docker-compose.lan.yml ps
"@

if ($DryRun) {
    Write-Host "Dry run: would run remote deploy:"
    Write-Host $remoteDeploy
} else {
    Invoke-Logged $sshCommand @($SshTarget, (ConvertTo-RemoteShellScript $remoteDeploy))
}
