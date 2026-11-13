//! Impresión térmica RAW en Windows (ronda Piso 1 — port del printing.rs de
//! Abogados + probe TCP réplica de printer_probe_service.dart).
//!
//! Port Rust de RawPrinterHelper.cs (cliente Avalonia) via el port de
//! TekLive.Abogados.Client: enumeración vía EnumPrintersW y envío de bytes
//! ESC/POS vía OpenPrinterW/WritePrinter con DataType "RAW" (el spooler no
//! debe cocinar los bytes).
//!
//! Tercer comando `probe_printer`: TcpStream::connect_timeout réplica del
//! probe TCP 9100 del Flutter (printer_probe_service.dart — el scan de red y
//! validatePrinterReadiness usan connect_timeout al 9100).
//!
//! Cuarto comando `print_tcp` (ronda robustez RED): socket TCP directo a
//! ip:9100 con los bytes ESC/POS — el camino REAL de esc_pos_printer_plus del
//! Flutter (printing_service.dart L437-465: Socket.connect → add → flush →
//! delay → destroy). NO pasa por el spooler de Windows ni exige impresora
//! instalada: solo conectividad IP. Réplica del drain del socket Dart: el
//! stream vive ~250ms tras el flush leyendo la respuesta antes de cerrar.
//!
//! Limpieza en todos los caminos de error (mirror de los `finally` del C#):
//! ClosePrinter siempre; EndDocPrinter siempre tras un StartDoc OK; el
//! TcpStream se cierra por Drop en TODOS los caminos de print_tcp.

use serde::Serialize;

/// Impresora instalada (mirror de PrinterInfo del cliente Avalonia).
#[derive(Debug, Clone, Serialize)]
pub struct PrinterInfo {
    pub name: String,
    pub is_default: bool,
}

/// Lista las impresoras instaladas (EnumPrintersW, nivel 4).
/// Solo escritorio Windows; fuera de Windows devuelve lista vacía.
#[tauri::command]
pub fn list_printers() -> Vec<PrinterInfo> {
    imp::enumerate()
}

/// Envía bytes RAW (ESC/POS) a la impresora indicada.
/// `data` llega como arreglo de números desde el frontend (Vec<u8>).
#[tauri::command]
pub fn print_raw(printer_name: String, data: Vec<u8>) -> Result<(), String> {
    imp::send(&printer_name, &data)
}

/// Prueba de conectividad TCP con una impresora de red (réplica de
/// printer_probe_service.dart / Socket.connect(ip, port, timeout)).
/// Devuelve true si el puerto acepta conexión dentro del timeout.
#[tauri::command]
pub fn probe_printer(ip: String, port: u16, timeout_ms: u64) -> Result<bool, String> {
    use std::net::{IpAddr, SocketAddr, TcpStream};
    use std::time::Duration;

    if ip.trim().is_empty() {
        return Err("Dirección IP vacía.".to_string());
    }

    // La UI manda IPs literalmente; también acepta hostname resolviéndolo.
    let addr: SocketAddr = if let Ok(ip_addr) = ip.trim().parse::<IpAddr>() {
        SocketAddr::new(ip_addr, port)
    } else {
        // Hostname: resuelve y prueba la primera dirección (best-effort).
        use std::net::ToSocketAddrs;
        let mut candidates = match (ip.trim(), port).to_socket_addrs() {
            Ok(addrs) => addrs.collect::<Vec<_>>(),
            Err(e) => return Err(format!("No se pudo resolver '{ip}': {e}")),
        };
        match candidates.pop() {
            Some(addr) => addr,
            None => return Err(format!("No se pudo resolver '{ip}'.")),
        }
    };

    match TcpStream::connect_timeout(&addr, Duration::from_millis(timeout_ms)) {
        Ok(stream) => {
            // Mirror de socket.destroy() del Dart: cerrar al instante.
            drop(stream);
            Ok(true)
        }
        Err(e) => Err(format!("Sin respuesta de {ip}:{port}: {e}")),
    }
}

/// Envía bytes ESC/POS por socket TCP DIRECTO a una impresora de red
/// (camino real de esc_pos_printer_plus: NO usa el spooler de Windows ni
/// exige impresora instalada — solo conectividad IP:9100).
///
/// Réplica del flujo del Dart (printing_service.dart L437-465 /
/// _sendRawBytesToNetworkPrinter L646-656):
///   Socket.connect(ip, 9100, timeout) → add(bytes) → flush → esperar
///   procesamiento → socket.destroy().
///
/// El "flush + esperar" del Dart se replica como: write_all + flush +
/// shutdown(Write) + drain de lectura ~250ms (set_read_timeout 250ms hasta
/// WouldBlock/TimedOut/EOF). El drain deja a la térmica terminar de procesar
/// antes de cerrar (el Dart hacía `Future.delayed(300-1000ms)` en el socket).
///
/// `timeout_ms` aplica a connect Y a write (set_write/read_timeout).
#[tauri::command]
pub fn print_tcp(
    ip: String,
    port: u16,
    data: Vec<u8>,
    timeout_ms: u64,
) -> Result<(), String> {
    use std::io::Write;
    use std::net::{IpAddr, Shutdown, SocketAddr, TcpStream, ToSocketAddrs};
    use std::time::Duration;

    let ip_trim = ip.trim().to_string();
    if ip_trim.is_empty() {
        return Err("Dirección IP vacía.".to_string());
    }
    if data.is_empty() {
        return Err("No hay datos de ticket que enviar.".to_string());
    }

    // La UI manda IPs literalmente; también acepta hostname resolviéndolo
    // (mismo criterio que probe_printer).
    let addr: SocketAddr = if let Ok(ip_addr) = ip_trim.parse::<IpAddr>() {
        SocketAddr::new(ip_addr, port)
    } else {
        let mut candidates = match (ip_trim.as_str(), port).to_socket_addrs() {
            Ok(addrs) => addrs.collect::<Vec<_>>(),
            Err(e) => return Err(format!("No se pudo resolver '{ip_trim}': {e}")),
        };
        match candidates.pop() {
            Some(addr) => addr,
            None => return Err(format!("No se pudo resolver '{ip_trim}'.")),
        }
    };

    let timeout = Duration::from_millis(timeout_ms);

    // connect_timeout exige SocketAddr (ya resuelto arriba). Error descriptivo
    // con destino + causa (mirror del mensaje del probe).
    let mut stream = TcpStream::connect_timeout(&addr, timeout).map_err(|e| {
        format!("Sin respuesta de {ip_trim}:{port}: {e} (verifica que esté encendida y en la red)")
    })?;

    // Timeouts de E/S: write y read acotados por el mismo timeout_ms.
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|e| format!("No se pudo configurar el timeout de escritura: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_millis(250)))
        .map_err(|e| format!("No se pudo configurar el timeout de lectura: {e}"))?;

    // write_all + flush: todos los bytes al buffer del socket.
    if let Err(e) = stream.write_all(&data) {
        return Err(format!("Error enviando datos a {ip_trim}:{port}: {e}"));
    }
    if let Err(e) = stream.flush() {
        return Err(format!("Error enviando datos a {ip_trim}:{port}: {e}"));
    }

    // shutdown(Write): señal EOF a la impresora (el Dart cerraba el socket
    // tras el delay; shutdown permite drenar mientras ella procesa).
    if let Err(e) = stream.shutdown(Shutdown::Write) {
        // No fatal: algunas térmicas ya cerraron su lado.
        let _ = e;
    }

    // Drain ~250ms: leer la respuesta de la impresora (status bytes, ACKs)
    // hasta timeout/EOF — réplica del socket Dart que vivía 300-1000ms tras
    // el flush. Sin este delay una térmica lenta puede perder el tail.
    let mut sink = [0u8; 512];
    loop {
        match std::io::Read::read(&mut stream, &mut sink) {
            Ok(0) => break,   // EOF: la impresora cerró.
            Ok(_) => {}       // Bytes de estado: descartados.
            Err(_) => break,  // TimedOut/WouldBlock/interrumpido: fin del drain.
        }
    }

    // Drop del stream: cierre garantizado en todos los caminos.
    Ok(())
}

#[cfg(windows)]
mod imp {
    use super::PrinterInfo;
    use windows::Win32::Graphics::Printing::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, GetDefaultPrinterW,
        OpenPrinterW, StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W,
        PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_HANDLE, PRINTER_INFO_4W,
    };
    use windows::core::{HSTRING, PWSTR};

    /// PWSTR NUL-terminado -> String (pérdida tolerante, nunca falla).
    unsafe fn pwstr_to_string(p: PWSTR) -> String {
        if p.is_null() {
            return String::new();
        }
        let mut len = 0usize;
        // SAFETY: el spooler devuelve cadenas NUL-terminadas válidas.
        while *p.0.add(len) != 0 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(p.0, len))
    }

    fn default_printer() -> Option<String> {
        unsafe {
            let mut needed = 0u32;
            // Primera llamada: tamaño del buffer (incluye el NUL). Falla a propósito.
            let _ = GetDefaultPrinterW(None, &mut needed);
            if needed == 0 {
                return None; // Sin impresora predeterminada.
            }
            let mut buf = vec![0u16; needed as usize];
            let mut len = needed;
            if GetDefaultPrinterW(Some(PWSTR(buf.as_mut_ptr())), &mut len).as_bool() {
                // `len` incluye el NUL final: se recorta.
                let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
                let name = String::from_utf16_lossy(&buf[..end]);
                if !name.is_empty() {
                    return Some(name);
                }
            }
            None
        }
    }

    pub fn enumerate() -> Vec<PrinterInfo> {
        unsafe {
            // Incluye LOCAL + CONNECTIONS; si el spooler no devuelve nada por flags,
            // se intenta fallback con LOCAL solo.
            let flags_primary = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
            let flags_fallback = PRINTER_ENUM_LOCAL;
            let no_server = HSTRING::new();
            let attempt = |flags| -> Vec<PrinterInfo> {
                let mut needed = 0u32;
                let mut returned = 0u32;
                let _ = EnumPrintersW(flags, &no_server, 4, None, &mut needed, &mut returned);
                if needed == 0 {
                    return Vec::new();
                }
                let mut buf = vec![0u8; needed as usize];
                if EnumPrintersW(
                    flags,
                    &no_server,
                    4,
                    Some(buf.as_mut_slice()),
                    &mut needed,
                    &mut returned,
                )
                .is_err()
                {
                    return Vec::new();
                }
                let default = default_printer();
                let stride = std::mem::size_of::<PRINTER_INFO_4W>();
                let mut out = Vec::with_capacity(returned as usize);
                for i in 0..returned as usize {
                    let info = &*(buf.as_ptr().add(i * stride) as *const PRINTER_INFO_4W);
                    let name = pwstr_to_string(info.pPrinterName);
                    if name.is_empty() {
                        continue;
                    }
                    out.push(PrinterInfo {
                        is_default: default
                            .as_deref()
                            .map(|d| d.eq_ignore_ascii_case(&name))
                            .unwrap_or(false),
                        name,
                    });
                }
                out.sort_by(|a, b| {
                    (!a.is_default)
                        .cmp(&(!b.is_default))
                        .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                });
                out
            };
            let primary = attempt(flags_primary);
            if !primary.is_empty() {
                return primary;
            }
            // Fallback: solo LOCAL (algunas térmicas USB aparecen solo como local)
            let fallback = attempt(flags_fallback);
            if !fallback.is_empty() {
                return fallback;
            }
            // Último fallback: nivel 2 (PRINTER_INFO_2W) por compatibilidad
            // Reintenta con struct distinta si nivel 4 falló por driver antiguo
            attempt_level2(flags_primary, &no_server)
        }
    }

    /// Fallback con PRINTER_INFO_2W (nivel 2) para drivers antiguos.
    unsafe fn attempt_level2(flags: u32, no_server: &HSTRING) -> Vec<PrinterInfo> {
        use windows::Win32::Graphics::Printing::PRINTER_INFO_2W;
        let mut needed = 0u32;
        let mut returned = 0u32;
        let _ = EnumPrintersW(flags, no_server, 2, None, &mut needed, &mut returned);
        if needed == 0 {
            return Vec::new();
        }
        let mut buf = vec![0u8; needed as usize];
        if EnumPrintersW(
            flags,
            no_server,
            2,
            Some(buf.as_mut_slice()),
            &mut needed,
            &mut returned,
        )
        .is_err()
        {
            return Vec::new();
        }
        let default = default_printer();
        let stride = std::mem::size_of::<PRINTER_INFO_2W>();
        let mut out = Vec::with_capacity(returned as usize);
        for i in 0..returned as usize {
            let info = &*(buf.as_ptr().add(i * stride) as *const PRINTER_INFO_2W);
            let name = pwstr_to_string(info.pPrinterName);
            if name.is_empty() {
                continue;
            }
            out.push(PrinterInfo {
                is_default: default
                    .as_deref()
                    .map(|d| d.eq_ignore_ascii_case(&name))
                    .unwrap_or(false),
                name,
            });
        }
        out.sort_by(|a, b| {
            (!a.is_default)
                .cmp(&(!b.is_default))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        out
    }

    pub fn send(printer_name: &str, data: &[u8]) -> Result<(), String> {
        if printer_name.trim().is_empty() {
            return Err("Selecciona una impresora primero.".to_string());
        }
        unsafe {
            let name = HSTRING::from(printer_name);
            let mut handle = PRINTER_HANDLE::default();
            if OpenPrinterW(&name, &mut handle, None).is_err() {
                return Err(format!(
                    "No se pudo abrir la impresora '{printer_name}'. Verifica que esté instalada."
                ));
            }
            // A partir de aquí el handle SIEMPRE se cierra (mirror del finally C#).
            let result = (|| {
                let doc = HSTRING::from("TekLive Ticket");
                let dtype = HSTRING::from("RAW");
                // DOC_INFO_1W usa PWSTR; los HSTRING viven en este scope.
                let doc_info = DOC_INFO_1W {
                    pDocName: PWSTR(doc.as_ptr() as *mut u16),
                    pOutputFile: PWSTR::null(),
                    pDatatype: PWSTR(dtype.as_ptr() as *mut u16),
                };
                if StartDocPrinterW(handle, 1, &doc_info) == 0 {
                    return Err("No se pudo iniciar el trabajo de impresión.".to_string());
                }
                // EndDocPrinter corre en TODOS los caminos tras un StartDoc OK.
                let result = (|| {
                    if !StartPagePrinter(handle).as_bool() {
                        return Err("No se pudo iniciar la página de impresión.".to_string());
                    }
                    if !data.is_empty() {
                        let mut written = 0u32;
                        if !WritePrinter(
                            handle,
                            data.as_ptr() as *const std::ffi::c_void,
                            data.len() as u32,
                            &mut written,
                        )
                        .as_bool()
                        {
                            return Err(
                                "No se pudieron escribir los datos en la impresora.".to_string()
                            );
                        }
                    }
                    // Mirror del C#: EndPagePrinter sin chequear el resultado.
                    let _ = EndPagePrinter(handle);
                    Ok(())
                })();
                let _ = EndDocPrinter(handle);
                result
            })();
            // Mirror del finally C#: el handle siempre se cierra.
            let _ = ClosePrinter(handle);
            result
        }
    }
}

/// Fuera de Windows no hay Winspool: la UI ya muestra
/// "Disponible solo en la app de escritorio." (mirror del gate IsDesktop).
#[cfg(not(windows))]
mod imp {
    use super::PrinterInfo;

    pub fn enumerate() -> Vec<PrinterInfo> {
        Vec::new()
    }

    pub fn send(_printer_name: &str, _data: &[u8]) -> Result<(), String> {
        Err("La impresión directa solo está disponible en Windows.".to_string())
    }
}
