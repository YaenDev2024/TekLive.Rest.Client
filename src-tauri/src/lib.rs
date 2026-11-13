// TekLive Rest · Tauri 2 entry library.
//
// Ronda Piso 1: comandos de impresión térmica RAW (port del printing.rs de
// Abogados: EnumPrintersW + WritePrinter RAW) + probe TCP de impresoras de
// red (réplica printer_probe_service.dart). El updater desktop llega después.

mod printing;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            printing::list_printers,
            printing::print_raw,
            printing::probe_printer
        ])
        .run(tauri::generate_context!())
        .expect("error while running TekLive Rest");
}
