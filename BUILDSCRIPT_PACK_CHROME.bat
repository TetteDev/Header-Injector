@echo off
setlocal enabledelayedexpansion

REM Check if extension path is provided
if "%~1"=="" (
    echo Usage: BUILDSCRIPT_PACK_CHROME.bat "path\to\extension\folder"
    pause
    exit /b 1
)

set "EXTENSION_PATH=%~1"
set "SCRIPT_DIR=%~dp0"
set "TEMP_BUILD_DIR=%SCRIPT_DIR%temp_extension_build"

REM Define files and extensions to exclude (easily editable)
set "EXCLUDE_EXTENSIONS=.bat .cmd .ps1 .sh .git .gitignore .md .txt .log .tmp .bak .gitattributes .xpi .crx .pem .zip .rar .7z"
set "EXCLUDE_FILES=README.md LICENSE CHANGELOG.md .gitignore .gitattributes package.json package-lock.json node_modules"
set "EXCLUDE_FOLDERS=.git node_modules .vscode .idea temp build dist"

REM Find Chrome installation
set "CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_PATH%" (
    set "CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
)
if not exist "%CHROME_PATH%" (
    echo Chrome not found in standard locations
    pause
    exit /b 1
)

REM Check if extension folder exists
if not exist "%EXTENSION_PATH%" (
    echo Extension folder not found: %EXTENSION_PATH%
    pause
    exit /b 1
)

REM Check for manifest.json
if not exist "%EXTENSION_PATH%\manifest.json" (
    echo manifest.json not found in extension folder
    pause
    exit /b 1
)

echo =====================================
echo Chrome Extension Packaging Script
echo =====================================
echo Extension path: %EXTENSION_PATH%
echo Temp build dir: %TEMP_BUILD_DIR%
echo Chrome path: %CHROME_PATH%
echo Output directory: %SCRIPT_DIR%
echo =====================================

REM Safety check - ensure temp directory is NOT the same as extension directory
if /I "%TEMP_BUILD_DIR%"=="%EXTENSION_PATH%" (
    echo ERROR: Temp build directory cannot be the same as extension directory!
    echo This would cause data loss!
    pause
    exit /b 1
)

REM Clean up any existing temp directory
if exist "%TEMP_BUILD_DIR%" (
    echo Cleaning up previous build directory: %TEMP_BUILD_DIR%
    rmdir /s /q "%TEMP_BUILD_DIR%"
    if exist "%TEMP_BUILD_DIR%" (
        echo ERROR: Failed to clean up temp directory
        pause
        exit /b 1
    )
)

REM Create temporary build directory
echo Creating temporary build directory: %TEMP_BUILD_DIR%
mkdir "%TEMP_BUILD_DIR%"
if not exist "%TEMP_BUILD_DIR%" (
    echo ERROR: Failed to create temp directory
    pause
    exit /b 1
)

REM Copy ALL files from extension to temp directory
echo Copying extension files to temp directory...
xcopy "%EXTENSION_PATH%\*" "%TEMP_BUILD_DIR%\" /E /I /H /K /X /Y
if errorlevel 1 (
    echo ERROR: Failed to copy files to temp directory
    pause
    exit /b 1
)

echo Files copied successfully. Now cleaning temp directory...

REM Remove excluded file extensions from temp directory ONLY
echo Removing excluded file types from temp directory...
for %%E in (%EXCLUDE_EXTENSIONS%) do (
    echo   Checking for *%%E files in temp directory...
    for /R "%TEMP_BUILD_DIR%" %%F in (*%%E) do (
        if exist "%%F" (
            echo     Removing: %%F
            del /Q "%%F" 2>nul
        )
    )
)

REM Remove excluded specific files from temp directory ONLY
echo Removing excluded files from temp directory...
for %%F in (%EXCLUDE_FILES%) do (
    echo   Checking for %%F in temp directory...
    for /R "%TEMP_BUILD_DIR%" %%G in (%%F) do (
        if exist "%%G" (
            echo     Removing: %%G
            del /Q "%%G" 2>nul
        )
    )
)

REM Remove excluded folders from temp directory ONLY
echo Removing excluded folders from temp directory...
for %%D in (%EXCLUDE_FOLDERS%) do (
    echo   Checking for folder %%D in temp directory...
    if exist "%TEMP_BUILD_DIR%\%%D" (
        echo     Removing folder: %TEMP_BUILD_DIR%\%%D
        rmdir /s /q "%TEMP_BUILD_DIR%\%%D" 2>nul
    )
    REM Also remove from subdirectories within temp directory
    for /R "%TEMP_BUILD_DIR%" %%H in (.) do (
        if exist "%%H\%%D" (
            echo     Removing subfolder: %%H\%%D
            rmdir /s /q "%%H\%%D" 2>nul
        )
    )
)

echo Cleanup completed. Contents of temp directory:
dir "%TEMP_BUILD_DIR%" /B

REM Pack the cleaned extension from temp directory
echo =====================================
echo Packing cleaned extension from temp directory...
echo =====================================
"%CHROME_PATH%" --pack-extension="%TEMP_BUILD_DIR%"

REM Check if .crx was created and move to script directory
if exist "%TEMP_BUILD_DIR%.crx" (
    echo Successfully created .crx file!
    
    REM Get extension name from manifest for better naming
    set "EXT_NAME=extension"
    if exist "%TEMP_BUILD_DIR%\manifest.json" (
        for /f "tokens=2 delims=:" %%A in ('findstr /C:"\"name\"" "%TEMP_BUILD_DIR%\manifest.json"') do (
            set "EXT_NAME_RAW=%%A"
            set "EXT_NAME_RAW=!EXT_NAME_RAW:~1!"
            set "EXT_NAME_RAW=!EXT_NAME_RAW:,=!"
            set "EXT_NAME_RAW=!EXT_NAME_RAW:"=!"
            set "EXT_NAME_RAW=!EXT_NAME_RAW: =_!"
            set "EXT_NAME=!EXT_NAME_RAW!"
        )
    )
    
    echo Moving .crx file to: %SCRIPT_DIR%%EXT_NAME%.crx
    move "%TEMP_BUILD_DIR%.crx" "%SCRIPT_DIR%%EXT_NAME%.crx"
    
    if exist "%TEMP_BUILD_DIR%.pem" (
        echo Moving .pem file to: %SCRIPT_DIR%%EXT_NAME%.pem
        move "%TEMP_BUILD_DIR%.pem" "%SCRIPT_DIR%%EXT_NAME%.pem"
    )
    
    echo =====================================
    echo SUCCESS! Extension packed successfully!
    echo .crx file: %SCRIPT_DIR%%EXT_NAME%.crx
    if exist "%SCRIPT_DIR%%EXT_NAME%.pem" echo .pem file: %SCRIPT_DIR%%EXT_NAME%.pem
    echo =====================================
) else (
    echo =====================================
    echo ERROR: Failed to create .crx file
    echo Note: Newer Chrome versions may not support the --pack-extension flag
    echo Temp directory preserved for inspection: %TEMP_BUILD_DIR%
    echo =====================================
    pause
    exit /b 1
)

REM Clean up temporary directory
echo Cleaning up temporary files...
if exist "%TEMP_BUILD_DIR%" (
    rmdir /s /q "%TEMP_BUILD_DIR%"
)

echo =====================================
echo Build process completed successfully!
echo =====================================
pause