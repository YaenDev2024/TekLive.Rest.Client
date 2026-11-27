//! Ícono de ventana dinámico por empresa (desktop).
//!
//! Puerto del `window_icon.rs` de TekLive Abogados: el frontend descarga el
//! logo de la empresa, lo rasteriza a RGBA en canvas y envía los bytes crudos
//! aquí. `set_window_icon` aplica el icono pequeño; en Windows también se
//! actualiza el icono grande de la barra de tareas/Alt-Tab (Win32) y los
//! accesos directos del usuario (escritorio, menú inicio, barra de tareas).

use tauri::image::Image;
use tauri::Manager;

#[cfg(windows)]
use std::{fs, os::windows::ffi::OsStrExt, path::Path, sync::Mutex};

#[cfg(windows)]
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{LPARAM, WPARAM},
        UI::WindowsAndMessaging::{
            DestroyIcon, LoadImageW, SendMessageW, SetClassLongPtrW, GCLP_HICON, HICON, ICON_BIG,
            IMAGE_ICON, LR_DEFAULTSIZE, LR_LOADFROMFILE, WM_SETICON,
        },
    },
};

#[cfg(windows)]
static CURRENT_TASKBAR_ICON: Mutex<Option<isize>> = Mutex::new(None);

fn validate_ico(icon_ico: &[u8]) -> Result<(), String> {
    if icon_ico.len() < 22 || icon_ico[0..4] != [0, 0, 1, 0] {
        return Err("archivo ICO inválido".into());
    }

    let image_count = u16::from_le_bytes([icon_ico[4], icon_ico[5]]);
    if image_count != 1 {
        return Err("el ICO debe contener exactamente una imagen".into());
    }

    let image_length =
        u32::from_le_bytes([icon_ico[14], icon_ico[15], icon_ico[16], icon_ico[17]]) as usize;
    let image_offset =
        u32::from_le_bytes([icon_ico[18], icon_ico[19], icon_ico[20], icon_ico[21]]) as usize;
    let image_end = image_offset
        .checked_add(image_length)
        .ok_or_else(|| "tamaño ICO inválido".to_string())?;
    if image_offset < 22 || image_end > icon_ico.len() {
        return Err("contenido ICO incompleto".into());
    }
    let signature_end = image_offset
        .checked_add(8)
        .ok_or_else(|| "tamaño ICO inválido".to_string())?;
    if icon_ico.get(image_offset..signature_end) != Some(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        return Err("el ICO debe contener una imagen PNG".into());
    }

    Ok(())
}

#[cfg(windows)]
fn update_windows_shortcuts(icon_path: &Path) -> Result<(), String> {
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$executable = [IO.Path]::GetFullPath($env:TEKLIVE_APP_EXECUTABLE)
$icon = [IO.Path]::GetFullPath($env:TEKLIVE_COMPANY_ICON)
$shell = New-Object -ComObject WScript.Shell
$folders = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('Programs'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
)
foreach ($folder in $folders) {
  if (-not (Test-Path -LiteralPath $folder)) { continue }
  Get-ChildItem -LiteralPath $folder -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue |
    ForEach-Object {
      $shortcut = $shell.CreateShortcut($_.FullName)
      if ([string]::IsNullOrWhiteSpace($shortcut.TargetPath)) { return }
      $target = [IO.Path]::GetFullPath($shortcut.TargetPath)
      if ([string]::Equals($target, $executable, [StringComparison]::OrdinalIgnoreCase)) {
        $shortcut.IconLocation = "$icon,0"
        $shortcut.Save()
      }
    }
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TekLiveShellNotify {
  [DllImport("shell32.dll")]
  public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
}
'@
[TekLiveShellNotify]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
"#;

    let executable = std::env::current_exe()
        .map_err(|error| format!("no se pudo obtener la ruta de la aplicación: {error}"))?;
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .env("TEKLIVE_APP_EXECUTABLE", executable)
        .env("TEKLIVE_COMPANY_ICON", icon_path)
        .output()
        .map_err(|error| format!("no se pudo actualizar los accesos directos: {error}"))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "PowerShell no pudo actualizar los accesos directos: {detail}"
        ));
    }

    Ok(())
}

#[cfg(windows)]
fn update_windows_taskbar_icon(
    window: &tauri::WebviewWindow,
    icon_path: &Path,
) -> Result<(), String> {
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("no se pudo obtener el HWND de la ventana: {error}"))?;
    let mut current_icon = CURRENT_TASKBAR_ICON
        .lock()
        .map_err(|_| "no se pudo actualizar el icono de la barra de tareas".to_string())?;
    let wide_path = icon_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let loaded_icon = unsafe {
        LoadImageW(
            None,
            PCWSTR(wide_path.as_ptr()),
            IMAGE_ICON,
            0,
            0,
            LR_DEFAULTSIZE | LR_LOADFROMFILE,
        )
    }
    .map_err(|error| format!("Windows no pudo cargar el icono ICO: {error}"))?;
    let icon = HICON(loaded_icon.0);

    unsafe {
        SetClassLongPtrW(hwnd, GCLP_HICON, icon.0 as isize);
        SendMessageW(
            hwnd,
            WM_SETICON,
            Some(WPARAM(ICON_BIG as usize)),
            Some(LPARAM(icon.0 as isize)),
        );
    }

    let previous_icon = current_icon.replace(icon.0 as isize);
    if let Some(previous_icon) = previous_icon {
        // Destruir el anterior libera el handle; si falla, el SO lo recicla al
        // cerrar el proceso, así que no es fatal.
        let _ = unsafe { DestroyIcon(HICON(previous_icon as *mut _)) };
    }

    Ok(())
}

/// Aplica un ícono RGBA (row-major, 4 bytes/pixel) a la ventana principal.
#[tauri::command]
pub fn set_window_icon(
    app: tauri::AppHandle,
    webview_window: tauri::WebviewWindow,
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    icon_ico: Vec<u8>,
) -> Result<(), String> {
    let expected = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "dimensiones inválidas".to_string())?;
    if rgba.len() != expected {
        return Err(format!(
            "tamaño RGBA inválido: {} bytes, se esperaban {} ({}x{})",
            rgba.len(),
            expected,
            width,
            height
        ));
    }
    if width == 0 || height == 0 {
        return Err("dimensiones inválidas".into());
    }
    validate_ico(&icon_ico)?;

    let img = Image::new_owned(rgba, width, height);
    webview_window
        .set_icon(img)
        .map_err(|e| format!("no se pudo aplicar el ícono de ventana: {e}"))?;

    #[cfg(windows)]
    {
        let icon_directory = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("no se pudo resolver el directorio de datos: {error}"))?
            .join("icons");
        fs::create_dir_all(&icon_directory)
            .map_err(|error| format!("no se pudo crear el directorio de iconos: {error}"))?;
        let icon_path = icon_directory.join("company-logo.ico");
        fs::write(&icon_path, icon_ico)
            .map_err(|error| format!("no se pudo guardar el icono ICO: {error}"))?;
        update_windows_taskbar_icon(&webview_window, &icon_path)?;
        update_windows_shortcuts(&icon_path)?;
    }

    #[cfg(not(windows))]
    {
        let _ = (app, icon_ico);
    }

    Ok(())
}
