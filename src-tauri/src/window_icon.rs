//! Ícono de ventana dinámico por empresa (desktop).
//!
//! El frontend descarga el logo (empresa o default TekLive), lo rasteriza a
//! RGBA en canvas y envía los bytes crudos aquí. `set_window_icon` aplica el
//! icono pequeño; en Windows también actualiza el icono grande de la barra de
//! tareas y Alt-Tab mediante Win32.
//!
//! Los accesos directos (escritorio, menú inicio, pins de la barra de tareas)
//! se actualizan en un comando SEPARADO (`sync_shortcut_icons`), que solo
//! encola el trabajo y retorna: un worker propio hace el recorrido con COM
//! nativo en segundo plano. Antes ese recorrido se hacía dentro de
//! `set_window_icon` lanzando `powershell.exe` de forma bloqueante, lo que
//! abría una consola negra y congelaba la app en cada arranque/login.

use std::path::PathBuf;
use tauri::image::Image;
use tauri::Manager;

#[cfg(any(windows, test))]
use std::sync::mpsc::{Receiver, Sender};

#[cfg(windows)]
use std::{
    ffi::OsString,
    fs,
    os::windows::ffi::{OsStrExt, OsStringExt},
    path::Path,
    sync::{mpsc, Mutex, OnceLock},
};

#[cfg(windows)]
use windows::Win32::Globalization::{CompareStringOrdinal, CSTR_EQUAL};

#[cfg(windows)]
use windows::{
    core::{Interface, GUID, PCWSTR},
    Win32::{
        Foundation::{LPARAM, WPARAM},
        Storage::FileSystem::WIN32_FIND_DATAW,
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IPersistFile,
            CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READWRITE,
        },
        System::Environment::ExpandEnvironmentStringsW,
        UI::Shell::{
            FOLDERID_Desktop, FOLDERID_Programs, IShellLinkW, SHChangeNotify, SHGetKnownFolderPath,
            ShellLink, KNOWN_FOLDER_FLAG, SHCNE_ASSOCCHANGED, SHCNF_IDLIST,
        },
        UI::WindowsAndMessaging::{
            DestroyIcon, LoadImageW, SendMessageW, SetClassLongPtrW, GCLP_HICON, HICON, ICON_BIG,
            IMAGE_ICON, LR_DEFAULTSIZE, LR_LOADFROMFILE, WM_SETICON,
        },
    },
};

#[cfg(windows)]
static SHORTCUT_SYNC_SENDER: OnceLock<Result<Sender<PathBuf>, String>> = OnceLock::new();

#[cfg(windows)]
static CURRENT_TASKBAR_ICON: Mutex<Option<isize>> = Mutex::new(None);

#[cfg(any(windows, test))]
fn enqueue_shortcut_request<T>(sender: &Sender<T>, request: T) -> Result<(), String> {
    sender
        .send(request)
        .map_err(|_| "el canal de sincronización de accesos directos está cerrado".to_string())
}

/// Procesa solo la petición más reciente: si llegaron varias mientras el
/// worker estaba ocupado, las superadas se descartan para que el estado final
/// corresponda siempre al último logo pedido.
#[cfg(any(windows, test))]
fn run_latest_shortcut_requests<T>(receiver: Receiver<T>, mut process: impl FnMut(T)) {
    while let Ok(mut latest_request) = receiver.recv() {
        while let Ok(next_request) = receiver.try_recv() {
            latest_request = next_request;
        }
        process(latest_request);
    }
}

#[cfg(windows)]
fn enqueue_shortcut_sync(icon_path: PathBuf) -> Result<(), String> {
    let sender = SHORTCUT_SYNC_SENDER.get_or_init(|| {
        let (sender, receiver) = mpsc::channel::<PathBuf>();
        std::thread::Builder::new()
            .name("teklive-shortcut-icon-sync".into())
            .spawn(move || {
                run_latest_shortcut_requests(receiver, |icon_path| match update_windows_shortcuts(
                    &icon_path,
                ) {
                    Ok(summary) => {
                        eprintln!(
                            "[teklive] accesos directos actualizados: {}",
                            summary.updated
                        );
                        report_shortcut_update_errors(&summary.errors, |error| {
                            eprintln!("[teklive] {error}");
                        });
                    }
                    Err(error) => {
                        eprintln!("[teklive] no se pudo sincronizar accesos directos: {error}");
                    }
                });
            })
            .map_err(|error| {
                format!("no se pudo iniciar el worker de accesos directos: {error}")
            })?;
        Ok(sender)
    });

    let sender = sender.as_ref().map_err(Clone::clone)?;
    enqueue_shortcut_request(sender, icon_path)
}

#[cfg(not(windows))]
fn enqueue_shortcut_sync(_icon_path: PathBuf) -> Result<(), String> {
    Ok(())
}

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
fn collect_shortcut_paths(roots: &[PathBuf]) -> Vec<PathBuf> {
    fn collect_directory(directory: &Path, shortcuts: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(directory) else {
            return;
        };

        for entry in entries {
            let Ok(entry) = entry else {
                continue;
            };
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if file_type.is_dir() {
                collect_directory(&path, shortcuts);
            } else if file_type.is_file()
                && path.extension().is_some_and(|extension| {
                    extension.to_string_lossy().eq_ignore_ascii_case("lnk")
                })
            {
                shortcuts.push(path);
            }
        }
    }

    let mut shortcuts = Vec::new();
    for root in roots {
        let Ok(metadata) = fs::symlink_metadata(root) else {
            continue;
        };
        if metadata.file_type().is_dir() {
            collect_directory(root, &mut shortcuts);
        }
    }
    shortcuts
}

#[cfg(windows)]
fn known_folder_path(folder_id: &GUID, name: &str) -> Result<PathBuf, String> {
    let wide_path = unsafe { SHGetKnownFolderPath(folder_id, KNOWN_FOLDER_FLAG(0), None) }
        .map_err(|error| format!("no se pudo resolver la carpeta conocida {name}: {error}"))?;
    let path = unsafe { wide_path.to_string() };
    unsafe {
        CoTaskMemFree(Some(wide_path.0.cast()));
    }
    path.map(PathBuf::from)
        .map_err(|error| format!("no se pudo convertir la ruta de {name}: {error}"))
}

#[cfg(windows)]
fn known_shortcut_roots() -> Result<Vec<PathBuf>, String> {
    let desktop = known_folder_path(&FOLDERID_Desktop, "Desktop")?;
    let programs = known_folder_path(&FOLDERID_Programs, "Programs")?;
    let mut roots = vec![desktop, programs];
    if let Some(taskbar_pins) = taskbar_shortcut_root(std::env::var_os("APPDATA")) {
        roots.push(taskbar_pins);
    }
    Ok(roots)
}

#[cfg(windows)]
fn taskbar_shortcut_root(appdata: Option<OsString>) -> Option<PathBuf> {
    appdata.map(|appdata| {
        PathBuf::from(appdata)
            .join("Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar")
    })
}

/// Expande variables de entorno (`%LOCALAPPDATA%\...`) que Windows deja
/// literales en el destino de algunos accesos directos.
#[cfg(windows)]
fn resolve_shortcut_target(target: &Path) -> Result<PathBuf, String> {
    let target_wide = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut expanded = vec![0u16; 260];

    loop {
        let required =
            unsafe { ExpandEnvironmentStringsW(PCWSTR(target_wide.as_ptr()), Some(&mut expanded)) }
                as usize;
        if required == 0 {
            return Err(format!(
                "no se pudieron expandir las variables del destino: {}",
                windows::core::Error::from_thread()
            ));
        }
        if required <= expanded.len() {
            return Ok(PathBuf::from(OsString::from_wide(
                &expanded[..required - 1],
            )));
        }
        expanded.resize(required, 0);
    }
}

#[cfg(windows)]
fn report_shortcut_update_errors(errors: &[String], mut report: impl FnMut(&str)) {
    for error in errors {
        report(error);
    }
}

#[cfg(windows)]
struct ShortcutUpdateSummary {
    updated: usize,
    errors: Vec<String>,
}

/// Cambia el icono de UN acceso directo. `Ok(false)` = no es nuestro destino.
#[cfg(windows)]
fn update_shortcut_icon(
    shortcut_path: &Path,
    executable: &Path,
    icon_path: &Path,
) -> Result<bool, String> {
    let link: IShellLinkW = unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) }
        .map_err(|error| {
            format!(
                "no se pudo crear el objeto Shell Link para {}: {error}",
                shortcut_path.display()
            )
        })?;
    let persist: IPersistFile = link.cast().map_err(|error| {
        format!(
            "no se pudo acceder al archivo del acceso directo {}: {error}",
            shortcut_path.display()
        )
    })?;
    let shortcut_wide = shortcut_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe {
        persist
            .Load(PCWSTR(shortcut_wide.as_ptr()), STGM_READWRITE)
            .map_err(|error| {
                format!(
                    "no se pudo cargar el acceso directo {}: {error}",
                    shortcut_path.display()
                )
            })?;
    }

    let mut target_buffer = vec![0u16; 32_768];
    let mut find_data = WIN32_FIND_DATAW::default();
    unsafe {
        link.GetPath(&mut target_buffer, &mut find_data, 0)
            .map_err(|error| {
                format!(
                    "no se pudo leer el destino del acceso directo {}: {error}",
                    shortcut_path.display()
                )
            })?;
    }
    let target_length = target_buffer
        .iter()
        .position(|character| *character == 0)
        .unwrap_or(target_buffer.len());
    let target = PathBuf::from(OsString::from_wide(&target_buffer[..target_length]));
    let target = resolve_shortcut_target(&target).map_err(|error| {
        format!(
            "no se pudo resolver el destino del acceso directo {}: {error}",
            shortcut_path.display()
        )
    })?;
    if !same_executable_path(&target, executable) {
        return Ok(false);
    }

    let icon_wide = icon_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe {
        link.SetIconLocation(PCWSTR(icon_wide.as_ptr()), 0)
            .map_err(|error| {
                format!(
                    "no se pudo cambiar el icono del acceso directo {}: {error}",
                    shortcut_path.display()
                )
            })?;
        persist
            .Save(PCWSTR(shortcut_wide.as_ptr()), true)
            .map_err(|error| {
                format!(
                    "no se pudo guardar el acceso directo {}: {error}",
                    shortcut_path.display()
                )
            })?;
    }

    Ok(true)
}

#[cfg(windows)]
fn update_windows_shortcuts(icon_path: &Path) -> Result<ShortcutUpdateSummary, String> {
    let initialization = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    initialization.ok().map_err(|error| {
        format!("no se pudo inicializar COM para los accesos directos: {error}")
    })?;
    struct ComUninitializer;
    impl Drop for ComUninitializer {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }
    let _com_uninitializer = ComUninitializer;

    let executable = std::env::current_exe()
        .map_err(|error| format!("no se pudo obtener la ruta de la aplicación: {error}"))?;
    let roots = known_shortcut_roots()?;
    let shortcuts = collect_shortcut_paths(&roots);
    let mut summary = ShortcutUpdateSummary {
        updated: 0,
        errors: Vec::new(),
    };

    for shortcut_path in shortcuts {
        match update_shortcut_icon(&shortcut_path, &executable, icon_path) {
            Ok(true) => summary.updated += 1,
            Ok(false) => {}
            Err(error) => summary.errors.push(error),
        }
    }

    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
    }
    Ok(summary)
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

#[cfg(windows)]
fn persist_active_icon(icon_directory: &Path, icon_ico: &[u8]) -> Result<PathBuf, String> {
    fs::create_dir_all(icon_directory).map_err(|error| {
        format!(
            "no se pudo crear el directorio de iconos {}: {error}",
            icon_directory.display()
        )
    })?;
    let icon_path = icon_directory.join("window-icon.ico");
    fs::write(&icon_path, icon_ico).map_err(|error| {
        format!(
            "no se pudo guardar el icono activo {}: {error}",
            icon_path.display()
        )
    })?;
    Ok(icon_path)
}

/// ICO que consumen los accesos directos. Solo se escribe cuando se pidió
/// sincronizarlos: al cerrar sesión el reset visual no debe pisar el logo de
/// la empresa que conservan los accesos.
#[cfg(windows)]
fn persist_shortcut_icon(
    icon_directory: &Path,
    icon_ico: &[u8],
    update_shortcut_icon: bool,
) -> Result<(), String> {
    if !update_shortcut_icon {
        return Ok(());
    }

    let icon_path = icon_directory.join("company-logo.ico");
    fs::write(&icon_path, icon_ico).map_err(|error| {
        format!(
            "no se pudo guardar el icono de los accesos directos {}: {error}",
            icon_path.display()
        )
    })
}

/// Aplica un ícono RGBA (row-major, 4 bytes/pixel) a la ventana principal.
///
/// `update_shortcut_icon` decide si además se persiste el ICO que luego usa
/// `sync_shortcut_icons`. Este comando NUNCA recorre accesos directos: eso es
/// trabajo del worker y no debe bloquear la UI.
#[tauri::command]
pub fn set_window_icon(
    app: tauri::AppHandle,
    webview_window: tauri::WebviewWindow,
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    icon_ico: Vec<u8>,
    update_shortcut_icon: bool,
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
        let icon_path = persist_active_icon(&icon_directory, &icon_ico)?;
        update_windows_taskbar_icon(&webview_window, &icon_path)?;
        persist_shortcut_icon(&icon_directory, &icon_ico, update_shortcut_icon)?;
    }

    #[cfg(not(windows))]
    {
        let _ = (app, icon_ico, update_shortcut_icon);
    }

    Ok(())
}

/// Encola la actualización de los accesos directos y retorna sin esperar el
/// recorrido. El ICO ya quedó escrito por `set_window_icon`.
#[tauri::command]
pub fn sync_shortcut_icons(app: tauri::AppHandle) -> Result<(), String> {
    let icon_path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("no se pudo resolver el directorio de datos: {error}"))?
        .join("icons")
        .join("company-logo.ico");
    enqueue_shortcut_sync(icon_path)
}

#[cfg(windows)]
fn same_path_ordinal_ignore_case(target: &Path, executable: &Path) -> bool {
    let target = target.as_os_str().encode_wide().collect::<Vec<_>>();
    let executable = executable.as_os_str().encode_wide().collect::<Vec<_>>();
    unsafe { CompareStringOrdinal(&target, &executable, true) == CSTR_EQUAL }
}

/// true solo si ambos existen y apuntan al mismo archivo real. `canonicalize`
/// resuelve mayúsculas, separadores y enlaces del sistema de archivos.
#[cfg(windows)]
fn same_executable_path(target: &Path, executable: &Path) -> bool {
    let (Ok(target), Ok(executable)) = (target.canonicalize(), executable.canonicalize()) else {
        return false;
    };
    same_path_ordinal_ignore_case(&target, &executable)
}

#[cfg(all(test, windows))]
mod shortcut_path_tests {
    use super::{
        collect_shortcut_paths, persist_active_icon, persist_shortcut_icon,
        report_shortcut_update_errors, resolve_shortcut_target, same_executable_path,
        same_path_ordinal_ignore_case, taskbar_shortcut_root, update_shortcut_icon,
    };
    use std::{
        ffi::OsString,
        fs,
        os::windows::ffi::{OsStrExt, OsStringExt},
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };
    use windows::{
        core::{Interface, PCWSTR},
        Win32::{
            Storage::FileSystem::WIN32_FIND_DATAW,
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile,
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ,
            },
            UI::Shell::{IShellLinkW, ShellLink},
        },
    };

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock is after the Unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "teklive-shortcut-path-test-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("create unique test directory");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    struct TestEnvironmentVariable {
        name: String,
        previous_value: Option<OsString>,
    }

    impl TestEnvironmentVariable {
        fn set(name: String, value: &Path) -> Self {
            let previous_value = std::env::var_os(&name);
            std::env::set_var(&name, value);
            Self {
                name,
                previous_value,
            }
        }
    }

    impl Drop for TestEnvironmentVariable {
        fn drop(&mut self) {
            if let Some(value) = self.previous_value.take() {
                std::env::set_var(&self.name, value);
            } else {
                std::env::remove_var(&self.name);
            }
        }
    }

    struct ComApartment;

    impl ComApartment {
        fn new() -> Self {
            unsafe {
                CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                    .ok()
                    .expect("initialize COM apartment for shortcut test");
            }
            Self
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    fn wide_path(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn path_from_buffer(buffer: &[u16]) -> PathBuf {
        let length = buffer
            .iter()
            .position(|character| *character == 0)
            .unwrap_or(buffer.len());
        PathBuf::from(OsString::from_wide(&buffer[..length]))
    }

    fn create_shortcut(shortcut_path: &Path, target: &Path, icon_path: &Path) {
        let link: IShellLinkW = unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) }
            .expect("create Shell Link");
        let target = wide_path(target);
        let icon = wide_path(icon_path);
        unsafe {
            link.SetPath(PCWSTR(target.as_ptr()))
                .expect("set shortcut target");
            link.SetIconLocation(PCWSTR(icon.as_ptr()), 0)
                .expect("set shortcut icon");
        }

        let persist: IPersistFile = link.cast().expect("query IPersistFile");
        let shortcut = wide_path(shortcut_path);
        unsafe {
            persist
                .Save(PCWSTR(shortcut.as_ptr()), true)
                .expect("save test shortcut");
        }
    }

    fn read_shortcut(shortcut_path: &Path) -> (PathBuf, PathBuf) {
        let link: IShellLinkW = unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) }
            .expect("create Shell Link");
        let persist: IPersistFile = link.cast().expect("query IPersistFile");
        let shortcut = wide_path(shortcut_path);
        unsafe {
            persist
                .Load(PCWSTR(shortcut.as_ptr()), STGM_READ)
                .expect("load test shortcut");
        }

        let mut target = vec![0u16; 32_768];
        let mut icon = vec![0u16; 32_768];
        let mut icon_index = 0;
        let mut find_data = WIN32_FIND_DATAW::default();
        unsafe {
            link.GetPath(&mut target, &mut find_data, 0)
                .expect("read shortcut target");
            link.GetIconLocation(&mut icon, &mut icon_index)
                .expect("read shortcut icon");
        }
        (path_from_buffer(&target), path_from_buffer(&icon))
    }

    #[test]
    fn matches_same_executable_path_but_not_an_unrelated_path() {
        let executable = std::env::current_exe().expect("current executable exists");
        let unrelated_dir = TestDirectory::new();
        let unrelated = unrelated_dir.0.join("rest-unrelated.exe");
        fs::write(&unrelated, b"test executable placeholder").expect("create unrelated file");

        assert!(executable.canonicalize().is_ok());
        assert!(unrelated.canonicalize().is_ok());

        assert!(same_executable_path(&executable, &executable));
        assert!(!same_executable_path(&unrelated, &executable));
    }

    #[test]
    fn compares_unicode_paths_ordinally_without_ascii_case_sensitivity() {
        let target = Path::new(r"C:\Rest\Compañía-Ä.exe");
        let executable = Path::new(r"c:\rest\compañía-ä.EXE");

        assert!(same_path_ordinal_ignore_case(target, executable));
    }

    #[test]
    fn collects_nested_shortcuts_only() {
        let directory = TestDirectory::new();
        let top_level_shortcut = directory.0.join("desktop.lnk");
        let nested_directory = directory.0.join("nested");
        fs::create_dir(&nested_directory).expect("create nested directory");
        let nested_shortcut = nested_directory.join("program.LNK");
        let other_file = directory.0.join("readme.txt");
        fs::write(&top_level_shortcut, b"shortcut").expect("create top-level shortcut");
        fs::write(&nested_shortcut, b"shortcut").expect("create nested shortcut");
        fs::write(&other_file, b"not a shortcut").expect("create other file");

        let mut actual = collect_shortcut_paths(&[directory.0.clone()]);
        actual.sort();
        let mut expected = vec![top_level_shortcut, nested_shortcut];
        expected.sort();

        assert_eq!(actual, expected);
    }

    #[test]
    fn taskbar_root_exists_only_when_appdata_is_configured() {
        assert_eq!(taskbar_shortcut_root(None), None);

        let appdata = OsString::from(r"C:\Users\tester\AppData\Roaming");
        let expected = PathBuf::from(&appdata)
            .join("Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar");
        assert_eq!(taskbar_shortcut_root(Some(appdata)), Some(expected));
    }

    #[test]
    fn keeps_company_shortcut_icon_when_resetting_active_icon() {
        let directory = TestDirectory::new();
        let icons = directory.0.join("icons");
        let company_icon = b"company ico bytes";
        let default_icon = b"default ico bytes";

        persist_active_icon(&icons, company_icon).expect("persist company active icon");
        persist_shortcut_icon(&icons, company_icon, true).expect("persist shortcut icon");
        // El reset de logout (sin sync) no debe tocar el ICO de los accesos.
        persist_active_icon(&icons, default_icon).expect("persist default active icon");
        persist_shortcut_icon(&icons, default_icon, false).expect("skip shortcut icon");

        assert_eq!(
            fs::read(icons.join("window-icon.ico")).expect("read active icon"),
            default_icon
        );
        assert_eq!(
            fs::read(icons.join("company-logo.ico")).expect("read shortcut icon"),
            company_icon
        );
    }

    #[test]
    fn resolves_environment_variables_in_shortcut_targets() {
        let directory = TestDirectory::new();
        let target = directory.0.join("TekLive Rest.exe");
        fs::write(&target, b"placeholder").expect("create placeholder executable");

        let _variable = TestEnvironmentVariable::set(
            "TEKLIVE_TEST_ICON_TARGET".to_string(),
            &target,
        );
        let unresolved = Path::new(r"%TEKLIVE_TEST_ICON_TARGET%");

        assert_eq!(
            resolve_shortcut_target(unresolved).expect("expand environment variable"),
            target
        );
    }

    #[test]
    fn reports_every_shortcut_update_error() {
        let errors = vec![
            "no se pudo cargar el acceso directo A".to_string(),
            "no se pudo guardar el acceso directo B".to_string(),
        ];
        let mut reported = Vec::new();

        report_shortcut_update_errors(&errors, |error| reported.push(error.to_string()));

        assert_eq!(reported, errors);
    }

    #[test]
    fn updates_only_matching_shortcut_icons() {
        let _apartment = ComApartment::new();
        let directory = TestDirectory::new();
        let executable = std::env::current_exe().expect("current executable exists");
        let unrelated_executable = directory.0.join("unrelated.exe");
        fs::write(&unrelated_executable, b"unrelated executable")
            .expect("create unrelated executable");
        let old_icon = directory.0.join("old.ico");
        let new_icon = directory.0.join("new.ico");
        let matching_shortcut = directory.0.join("matching.lnk");
        let unrelated_shortcut = directory.0.join("unrelated.lnk");
        fs::write(&old_icon, b"old icon").expect("create old icon path");
        fs::write(&new_icon, b"new icon").expect("create new icon path");
        create_shortcut(&matching_shortcut, &executable, &old_icon);
        create_shortcut(&unrelated_shortcut, &unrelated_executable, &old_icon);

        assert!(
            update_shortcut_icon(&matching_shortcut, &executable, &new_icon)
                .expect("update matching shortcut")
        );
        let (target_after_update, icon_after_update) = read_shortcut(&matching_shortcut);
        assert_eq!(target_after_update, executable);
        assert_eq!(icon_after_update, new_icon);

        assert!(
            !update_shortcut_icon(&unrelated_shortcut, &executable, &new_icon)
                .expect("ignore unrelated shortcut")
        );
        let (unrelated_target, unrelated_icon) = read_shortcut(&unrelated_shortcut);
        assert_eq!(unrelated_target, unrelated_executable);
        assert_eq!(unrelated_icon, old_icon);
    }
}

#[cfg(test)]
mod shortcut_sync_queue_tests {
    use super::{enqueue_shortcut_request, run_latest_shortcut_requests};
    use std::{
        sync::mpsc::{channel, RecvTimeoutError},
        thread,
        time::Duration,
    };

    #[test]
    fn coalesces_pending_requests_and_does_not_wait_for_a_scan() {
        let (sender, receiver) = channel();
        enqueue_shortcut_request(&sender, "stale-before-scan").expect("queue stale request");
        enqueue_shortcut_request(&sender, "latest-before-scan").expect("queue latest request");

        let (started_tx, started_rx) = channel();
        let (resume_tx, resume_rx) = channel();
        let (processed_tx, processed_rx) = channel();
        let worker = thread::spawn(move || {
            let mut first_scan = true;
            run_latest_shortcut_requests(receiver, |request| {
                processed_tx
                    .send(request)
                    .expect("report processed request");
                if first_scan {
                    first_scan = false;
                    started_tx.send(()).expect("report scan start");
                    resume_rx.recv().expect("wait for scan release");
                }
            });
        });

        assert_eq!(
            processed_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("first scan starts"),
            "latest-before-scan"
        );
        started_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("worker is scanning");

        let queued_sender = sender.clone();
        let (enqueue_done_tx, enqueue_done_rx) = channel();
        let enqueuer = thread::spawn(move || {
            let result = enqueue_shortcut_request(&queued_sender, "stale-during-scan")
                .and_then(|()| enqueue_shortcut_request(&queued_sender, "latest-during-scan"));
            enqueue_done_tx
                .send(result)
                .expect("report enqueue completion");
        });
        let enqueue_result = enqueue_done_rx.recv_timeout(Duration::from_secs(1));
        resume_tx.send(()).expect("release current scan");
        enqueue_result
            .expect("enqueue must not wait for the active scan")
            .expect("queue requests");
        enqueuer.join().expect("enqueuer thread completes");

        assert_eq!(
            processed_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("worker processes the latest queued request"),
            "latest-during-scan"
        );
        assert!(matches!(
            processed_rx.recv_timeout(Duration::from_millis(50)),
            Err(RecvTimeoutError::Timeout)
        ));

        drop(sender);
        worker.join().expect("worker exits after channel closes");
    }
}
