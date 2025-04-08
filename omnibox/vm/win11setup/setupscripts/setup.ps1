# Définir la gestion des erreurs
$ErrorActionPreference = "Stop"

# Définir le protocole TLS requis (TLS 1.2/1.3)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13

# Définir quelques variables de chemins
$scriptFolder = "\\host.lan\Data"
$toolsFolder = "C:\Users\$env:USERNAME\Tools"

# Load the shared setup-tools module
Import-Module (Join-Path $scriptFolder -ChildPath "setup-tools.psm1")

# S'assurer que le dossier Tools existe et l'ajouter au PATH système
if (-not (Test-Path $toolsFolder)) {
    New-Item -ItemType Directory -Path $toolsFolder -Force
    $envPath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
    $newPath = "$envPath;$toolsFolder"
    [Environment]::SetEnvironmentVariable("PATH", $newPath, "Machine")
}

# Configuration de la langue et du fuseau horaire
Write-Host "Configuration du clavier français et du fuseau horaire..."
$languageList = New-WinUserLanguageList -Language "fr-FR"
$languageList[0].InputMethodTips.Add("0c0c:0000040c")
Set-WinUserLanguageList -LanguageList $languageList -Force
Set-TimeZone -Id "Romance Standard Time"
Write-Host "Configuration terminée."

# Installation de Chocolatey si nécessaire
if (-not (Get-Command choco.exe -ErrorAction SilentlyContinue)) {
    Write-Host "Chocolatey n'est pas installé. Installation en cours..."
    Set-ExecutionPolicy Bypass -Scope Process -Force
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    Write-Host "Chocolatey est installé."
} else {
    Write-Host "Chocolatey est déjà présent."
}

# Liste des paquets à installer via Chocolatey
$simplePackages = @(
    "git",
    "7zip.install",
    "googlechrome",
    "libreoffice-still",
    "vlc",
    "gimp",
    "vscode",
    "thunderbird"
)

$complexPackages = @(
    @{ name = "python"; version = "3.10.0" },
    @{ name = "ffmpeg"; params = "/EnableOpenH264" }
)

# Installer tous les paquets simples en une seule commande
Write-Host "Installation des paquets simples..."
choco install $simplePackages -y

# Installer les paquets avec des versions ou paramètres spécifiques
foreach ($pkg in $complexPackages) {
    $pkgName = $pkg.name
    $pkgVersion = $pkg.version
    if ($pkgVersion) {
        Write-Host "Installation de $pkgName version $pkgVersion..."
        if ($pkg.params) {
            choco install $pkgName --version=$pkgVersion --params="$($pkg.params)" -y
        } else {
            choco install $pkgName --version=$pkgVersion -y
        }
    } else {
        Write-Host "Installation de $pkgName..."
        if ($pkg.params) {
            choco install $pkgName --params="$($pkg.params)" -y
        } else {
            choco install $pkgName -y
        }
    }
}


Write-Host "Installation de la librairie openh264..."

# Définir la version d'openh264 et les chemins
$openh264Version = "1.8.0"
$openh264FileName = "openh264-$openh264Version-win64.dll"      # Nom du fichier DLL après extraction
$openh264ArchiveName = "$openh264FileName.bz2"                 # Nom du fichier compressé
$openh264DownloadUrl = "https://github.com/cisco/openh264/releases/download/v$openh264Version/$openh264ArchiveName"

# Dossier d'installation de ffmpeg via Chocolatey
$ffmpegPath = (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue).Source
if (-not $ffmpegPath) {
    Write-Error "FFmpeg n'est pas trouvé dans le PATH. Assurez-vous qu'il est correctement installé via Chocolatey."
    return
}
$ffmpegBinFolder = Split-Path -Parent $ffmpegPath

# Dossier et fichier temporaire
$openh264ArchiveTempPath = Join-Path $env:TEMP $openh264ArchiveName
$openh264DllTempPath     = Join-Path $env:TEMP $openh264FileName

try {
    # Vérifier les permissions d'écriture dans le dossier de destination
    $acl = Get-Acl $ffmpegBinFolder
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
    $adminRole = [System.Security.Principal.WindowsBuiltInRole]::Administrator
    
    if (-not $principal.IsInRole($adminRole)) {
        Write-Error "Ce script doit être exécuté en tant qu'administrateur pour copier la DLL dans $ffmpegBinFolder"
        return
    }

    # Téléchargement depuis GitHub
    Write-Host "Téléchargement de $openh264DownloadUrl..."
    Invoke-WebRequest -Uri $openh264DownloadUrl -OutFile $openh264ArchiveTempPath -UseBasicParsing

    # Extraction du .bz2
    Write-Host "Extraction de la DLL..."
    7z x -y -o"$env:TEMP" $openh264ArchiveTempPath | Out-Null

    # Copie/Remplacement dans le répertoire de ffmpeg
    Write-Host "Copie de la DLL dans $ffmpegBinFolder..."
    Copy-Item $openh264DllTempPath -Destination (Join-Path $ffmpegBinFolder $openh264FileName) -Force

    # Nettoyage
    Remove-Item $openh264ArchiveTempPath -Force -ErrorAction SilentlyContinue
    Remove-Item $openh264DllTempPath -Force -ErrorAction SilentlyContinue

    Write-Host "La librairie openh264 a été installée dans $ffmpegBinFolder"
    
    # Vérification finale
    if (Test-Path (Join-Path $ffmpegBinFolder $openh264FileName)) {
        Write-Host "Installation de openh264 réussie !"
    } else {
        Write-Error "La DLL n'a pas été correctement copiée dans le dossier de destination."
    }
}
catch {
    Write-Host "Erreur lors de l'installation de la librairie openh264 : $($_.Exception.Message)"
}

# Actualiser les variables d'environnement (PATH) pour que les installations récentes soient reconnues
Write-Host "Actualisation des variables d'environnement..."
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")

# Désactivation des mises à jour automatiques d'Edge
Write-Host "Désactivation des mises à jour automatiques d'Edge..."
try {
    Stop-Process -Name "MicrosoftEdgeUpdate" -Force -ErrorAction SilentlyContinue
} catch {
    Write-Host "Processus de mise à jour Edge non actif."
}
$edgeUpdatePath = "${env:ProgramFiles(x86)}\Microsoft\EdgeUpdate"
if (Test-Path $edgeUpdatePath) {
    Remove-Item -Path $edgeUpdatePath -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host "Mises à jour d'Edge désactivées."

# (Optionnel) Ajout d'alias dans le profil PowerShell, par exemple pour Python
$profilePath = $PROFILE
if (-not (Test-Path $profilePath)) {
    New-Item -ItemType File -Path $profilePath -Force
}
$pythonExe = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
if ($pythonExe) {
    $aliasCmd = "Set-Alias -Name py -Value `"$pythonExe`""
    if (-not (Select-String -Path $profilePath -Pattern "Set-Alias -Name py -Value")) {
        Add-Content -Path $profilePath -Value $aliasCmd
    }
}


# Fix le problème de synchronisation de l'heure
w32tm /config /manualpeerlist:"0.pool.ntp.org,1.pool.ntp.org,2.pool.ntp.org,3.pool.ntp.org" /syncfromflags:manual /reliable:yes /update; Restart-Service w32time; w32tm /resync /force

# -------------------------------
# SECTION: Configuration du serveur Python
# -------------------------------
$pythonServerPort = 5000
$requirementsFile = Join-Path $scriptFolder "server\requirements.txt"
$pythonExecutablePath = "c:\Python310\python.exe"
$onLogonTaskName = "Server_OnLogon"

if (Test-Path $requirementsFile) {
    Write-Host "Mise à jour de pip et installation des packages Python serveur..."
    & python -m pip install --upgrade pip
    & python -m pip install wheel pywinauto
    & python -m pip install -r $requirementsFile
} else {
    Write-Error "Fichier requirements introuvable : $requirementsFile"
}

# Add a firewall rule to allow incoming connections on the specified port for the Python executable
$pythonServerRuleName = "PythonHTTPServer-$pythonServerPort"
if (-not (Get-NetFirewallRule -Name $pythonServerRuleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $pythonServerRuleName -Direction Inbound -Program $pythonExecutablePath -Protocol TCP -LocalPort $pythonServerPort -Action Allow -Profile Any
    Write-Host "Firewall rule added to allow traffic on port $pythonServerPort for Python"
} else {
    Write-Host "Firewall rule already exists. $pythonServerRuleName "
}

$onLogonScriptPath = "$scriptFolder\on-logon.ps1"
# Check if the scheduled task exists before unregistering it
if (Get-ScheduledTask -TaskName $onLogonTaskName -ErrorAction SilentlyContinue) {
    Write-Host "Scheduled task $onLogonTaskName already exists."
} else {
    Write-Host "Registering new task $onLogonTaskName..."
    Register-LogonTask -TaskName $onLogonTaskName -ScriptPath $onLogonScriptPath -LocalUser "Docker"
}

Start-Sleep -Seconds 10
Start-ScheduledTask -TaskName $onLogonTaskName