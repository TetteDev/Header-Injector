@echo off
setlocal enabledelayedexpansion

REM Define files to exclude (add more as needed)
set "EXCLUDE_FILES=.git .gitignore node_modules package-lock.json *.log *.tmp .gitattributes *.bat zip_exclude_*.txt *.xpi *.crx *.pem *.zip *.rar *.7z"

REM Get current directory name for zip file
for %%i in ("%CD%") do set "FOLDER_NAME=%%~ni"
set "ZIP_NAME=%FOLDER_NAME%.zip"
set "XPI_NAME=%FOLDER_NAME%.xpi"

REM Create temporary files in current directory
set "EXCLUDE_LIST=zip_exclude_%RANDOM%.txt"

REM Create exclude patterns file
(
    for %%f in (%EXCLUDE_FILES%) do (
        echo %%f
    )
) > "%EXCLUDE_LIST%"

REM Use PowerShell to create zip with exclusions while preserving folder structure
powershell -Command "& {" ^
    "$excludePatterns = Get-Content '%EXCLUDE_LIST%';" ^
    "$allItems = Get-ChildItem -Recurse -Force;" ^
    "$filteredItems = $allItems | Where-Object {" ^
        "$item = $_;" ^
        "$shouldExclude = $false;" ^
        "foreach ($pattern in $excludePatterns) {" ^
            "$pattern = $pattern.Trim();" ^
            "if ($item.Name -like $pattern -or $item.FullName -like '*\' + $pattern + '\*' -or $item.FullName -like '*\' + $pattern) {" ^
                "$shouldExclude = $true;" ^
                "break;" ^
            "}" ^
        "};" ^
        "return -not $shouldExclude;" ^
    "};" ^
    "$tempDir = New-TemporaryFile | ForEach-Object { Remove-Item $_; New-Item -ItemType Directory -Path $_.FullName };" ^
    "$basePath = Get-Location;" ^
    "foreach ($item in $filteredItems) {" ^
        "$relativePath = $item.FullName.Substring($basePath.Path.Length + 1);" ^
        "$targetPath = Join-Path $tempDir.FullName $relativePath;" ^
        "$targetDir = Split-Path $targetPath -Parent;" ^
        "if (-not (Test-Path $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null };" ^
        "if ($item.PSIsContainer) {" ^
            "if (-not (Test-Path $targetPath)) { New-Item -ItemType Directory -Path $targetPath -Force | Out-Null }" ^
        "} else {" ^
            "Copy-Item $item.FullName $targetPath -Force;" ^
        "}" ^
    "};" ^
    "Compress-Archive -Path (Join-Path $tempDir.FullName '*') -DestinationPath '%ZIP_NAME%' -Force;" ^
    "Remove-Item $tempDir.FullName -Recurse -Force;" ^
"}"

REM Rename .zip to .xpi
if exist "%ZIP_NAME%" (
    if exist "%XPI_NAME%" del "%XPI_NAME%"
    ren "%ZIP_NAME%" "%XPI_NAME%"
)

REM Cleanup temporary files
if exist "%EXCLUDE_LIST%" del "%EXCLUDE_LIST%"

echo Created %XPI_NAME% successfully!
echo Excluded files: %EXCLUDE_FILES%
pause