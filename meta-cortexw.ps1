$ErrorActionPreference = 'Stop'
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '.meta-cortex-version') -Raw).Trim()
switch -Regex ($version) {
    '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' { }
    default { throw 'Invalid .meta-cortex-version: expected an exact release such as 0.15.0' }
}
switch -Regex ($version) {
    '^0\.([0-9]|1[0-4])\.' { throw 'Project wrapper requires release 0.15.0 or later' }
}
$cacheRoot = $env:META_CORTEX_WRAPPER_CACHE
switch ([string]$cacheRoot) {
    '' { $cacheRoot = Join-Path $env:LOCALAPPDATA 'meta-cortex\wrapper' }
}
$installDir = Join-Path $cacheRoot $version
$binary = Join-Path $installDir 'meta-cortex.exe'
$cacheAvailability = switch (Test-Path -LiteralPath $binary -PathType Leaf) {
    $true { 'Present' }
    $false { 'Missing' }
}
switch ($cacheAvailability) {
    'Present' { }
    'Missing' {
        New-Item -ItemType Directory -Path $installDir -Force | Out-Null
        $installer = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName() + '.ps1')
        $downloadOverrides = @{}
        foreach ($name in @('META_CORTEX_DOWNLOAD_URL', 'INSTALLER_DOWNLOAD_URL', 'META_CORTEX_INSTALLER_GHE_BASE_URL', 'META_CORTEX_INSTALLER_GITHUB_BASE_URL')) {
            $downloadOverrides[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        }
        $oldUnmanaged = $env:META_CORTEX_UNMANAGED_INSTALL
        $oldInstallDir = $env:META_CORTEX_INSTALL_DIR
        $oldForceInstallDir = $env:CARGO_DIST_FORCE_INSTALL_DIR
        try {
            Invoke-WebRequest -Uri "https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/releases/download/v$version/meta-cortex-installer.ps1" -OutFile $installer
            foreach ($name in $downloadOverrides.Keys) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
            $env:META_CORTEX_INSTALL_DIR = $null
            $env:CARGO_DIST_FORCE_INSTALL_DIR = $null
            $env:META_CORTEX_UNMANAGED_INSTALL = $installDir
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
            switch ($LASTEXITCODE) {
                0 { }
                default { exit $LASTEXITCODE }
            }
        } finally {
            foreach ($name in $downloadOverrides.Keys) { [Environment]::SetEnvironmentVariable($name, $downloadOverrides[$name], 'Process') }
            $env:META_CORTEX_UNMANAGED_INSTALL = $oldUnmanaged
            $env:META_CORTEX_INSTALL_DIR = $oldInstallDir
            $env:CARGO_DIST_FORCE_INSTALL_DIR = $oldForceInstallDir
            Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
        }
    }
}
$actualVersion = & $binary --version
switch ($LASTEXITCODE) {
    0 { }
    default { exit $LASTEXITCODE }
}
switch ($actualVersion) {
    "meta-cortex $version" { }
    default { throw "Cached executable version mismatch: expected meta-cortex $version, received $actualVersion ($binary)" }
}
& $binary @args
exit $LASTEXITCODE
