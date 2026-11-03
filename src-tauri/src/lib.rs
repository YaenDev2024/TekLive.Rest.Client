// TekLive Rest · Tauri 2 entry library.
//
// Fase 2 scaffold: no custom commands yet. Printing (Winspool RAW ESC/POS)
// arrives in Fase 4 as a port of the Abogados `printing.rs`, and the desktop
// updater in Fase 5.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running TekLive Rest");
}
