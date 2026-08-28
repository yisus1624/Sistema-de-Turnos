# Instala la voz de sintesis de voz en Español (Colombia) en Windows.
#
# Para que la pantalla de turnos (/pantalla) anuncie los llamados con voz
# colombiana, el computador conectado al televisor debe tener instalada la voz
# "Microsoft (Español - Colombia)". Este script la instala.
#
# COMO USARLO (una sola vez, en el equipo del televisor):
#   1. Clic derecho sobre este archivo -> "Ejecutar con PowerShell".
#      Si Windows pide permisos, acepta (requiere administrador).
#   2. Espera a que termine y REINICIA el equipo.
#   3. Abre la pantalla; abajo debe decir una voz "Spanish (Colombia)".
#
# Si el script no puede instalarla automaticamente (versiones viejas de
# Windows), muestra los pasos para hacerlo a mano.
#
# Alternativa sin instalar nada: abrir la pantalla en Microsoft Edge, que trae
# voces colombianas "en linea" (necesita internet la primera vez).

$ErrorActionPreference = 'Stop'
$idioma = 'es-CO'

Write-Host ''
Write-Host '== Instalador de voz Español (Colombia) para el Sistema de Turnos ==' -ForegroundColor Cyan
Write-Host ''

function Test-Administrador {
    $actual = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    return $actual.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrador)) {
    Write-Host 'Este script necesita permisos de administrador.' -ForegroundColor Yellow
    Write-Host 'Reabriendolo como administrador...' -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$PSCommandPath`""
    return
}

$instalado = $false

# Windows 11 / Windows 10 recientes: Install-Language instala idioma + voz.
if (Get-Command Install-Language -ErrorAction SilentlyContinue) {
    try {
        Write-Host "Instalando el paquete de idioma $idioma (incluye la voz)..." -ForegroundColor Cyan
        Install-Language $idioma -CopyToSettings
        $instalado = $true
    } catch {
        Write-Host "No se pudo con Install-Language: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Alternativa: agregar el idioma a la lista, lo que descarga sus recursos de voz.
if (-not $instalado -and (Get-Command Install-LanguagePack -ErrorAction SilentlyContinue)) {
    try {
        Write-Host "Instalando el paquete de idioma $idioma..." -ForegroundColor Cyan
        Install-LanguagePack -Language $idioma
        $instalado = $true
    } catch {
        Write-Host "No se pudo con Install-LanguagePack: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

if ($instalado) {
    Write-Host ''
    Write-Host 'Listo. La voz de Español (Colombia) quedo instalada.' -ForegroundColor Green
    Write-Host 'REINICIA el equipo y vuelve a abrir la pantalla de turnos.' -ForegroundColor Green
} else {
    Write-Host ''
    Write-Host 'No se pudo instalar automaticamente en esta version de Windows.' -ForegroundColor Yellow
    Write-Host 'Instalala a mano asi:' -ForegroundColor Yellow
    Write-Host '  1. Configuracion > Hora e idioma > Idioma y region.' -ForegroundColor White
    Write-Host '  2. "Agregar idioma" > Español (Colombia) > Siguiente.' -ForegroundColor White
    Write-Host '  3. Marca la casilla de "Voz" (Text-to-speech) e instala.' -ForegroundColor White
    Write-Host '  4. Reinicia el equipo.' -ForegroundColor White
    Write-Host ''
    Write-Host 'O, mas facil: abre la pantalla en Microsoft Edge (trae voz colombiana en linea).' -ForegroundColor White
}

Write-Host ''
Read-Host 'Presiona Enter para cerrar'
