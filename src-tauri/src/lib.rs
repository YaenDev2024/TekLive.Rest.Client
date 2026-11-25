// TekLive Rest · Tauri 2 entry library.
//
// Ronda Piso 1: comandos de impresión térmica RAW (port del printing.rs de
// Abogados: EnumPrintersW + WritePrinter RAW) + probe TCP de impresoras de
// red (réplica printer_probe_service.dart).
//
// Auto-update: updater (minisign) + process (relanzar tras instalar), mismo
// par que Abogados. La llave pública vive en tauri.conf.json > plugins.updater.

mod printing;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            printing::list_printers,
            printing::print_raw,
            printing::probe_printer,
            printing::print_tcp
        ])
        .run(tauri::generate_context!())
        .expect("error while running TekLive Rest");
}
