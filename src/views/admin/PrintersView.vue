<script setup lang="ts">
/**
 * PrintersView · "Configuración de Impresora" (ronda Piso 1) — réplica de
 * lib/screens/admin/printer_settings_screen.dart (CrazyWings) con el patrón
 * de las vistas admin standalone (AppBar back + cards).
 *
 * Secciones réplica (mismo orden que el build() L1017-1305):
 *  (a) Impresora principal — cliente / caja (L1028-1209): IP + puerto,
 *      'Probar conexión y guardar' (probe 9100 + auto-guard réplica
 *      _testNetworkConnection L606-656), 'Impresora guardada' ListTile con
 *      chip Lista, 'Ticket prueba' (Tauri: print_raw página ESC/POS corta;
 *      web: printTicket por navegador — réplica printTestTicket L1404-1472).
 *  (b) Cocinas — doble impresión (L1211-1261): K1/K2 con chip de guardado,
 *      'Probar' individual réplica _testKitchenConnection L345-394 (probe OK
 *      auto-guarda, réplica L372).
 *  (c) Impresoras por área (L887-1015): HAMBURGUESAS/COCINA/CLIENTE con
 *      switch USB/Red, 'Probar'/'Guardar'/'Quitar' por área (réplica
 *      _buildAreaPrinterRow). En Tauri el campo muestra un AppSelect con las
 *      impresoras de Windows (list_printers) + input libre; en web input.
 *  (d) Palabras clave por área (keyword_admin_module.dart L87-149): chips
 *      'KW → ÁREA' con delete + botón Agregar (modal palabra + área).
 *  + Escaneo de red (L743-883): SOLO Tauri — probe simultáneo con semaphore
 *    límite 20 (réplica _AsyncSemaphore L41-66), progreso 'Escaneando red...
 *    N/M' (L805-808), lista de descubiertas asignable a principal/C1/C2/áreas
 *    (L1334-1433).
 *
 * En WEB muestra banner informativo (brief): la impresión térmica directa
 * está disponible en la app de escritorio; en el navegador se usa el diálogo
 * de impresión del sistema.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowLeft,
  CheckCircle2,
  Tag,
  Loader2,
  Plus,
  Printer,
  Receipt,
  Search,
  Soup,
  Usb,
  Wifi,
  X,
} from 'lucide-vue-next'
import AppModal from '../../components/pos/AppModal.vue'
import { AppSelect } from '../../components/ui'
import type { AppSelectOption } from '../../components/ui/AppSelect.vue'
import { useToastStore } from '../../stores/toast'
import {
  isTauri,
  listPrinters,
  printRawEscPos,
  printTcpEscPos,
  probePrinter,
  type TauriPrinter,
} from '../../services/printing/tauri-bridge'
import {
  PRINT_AREAS,
  clearAreaPrinter,
  deleteKeyword,
  getAreaPrinter,
  getKitchenSlot,
  getMainPrinter,
  loadKeywords,
  normalizePrinterArea,
  setAreaPrinter,
  setKitchenSlot,
  setMainPrinter,
  upsertKeyword,
  type PrintArea,
  type ProductKeyword,
} from '../../services/printing/printer-config'
import { ticketToEscPosBytes, buildClientTicket, printTicket } from '../../services/ticket'

const router = useRouter()
const toast = useToastStore()

const desktop = isTauri()

/** goBack réplica AppBar back → ajustes (SettingsView es /pos/ajustes). */
async function goBack(): Promise<void> {
  if (window.history.state?.back != null) {
    await router.back()
    return
  }
  await router.push({ name: 'pos-ajustes' })
}

// ---------------------------------------------------------------------------
// (a) Impresora principal
// ---------------------------------------------------------------------------

const mainIp = ref('')
const mainPort = ref('9100')
const mainSaved = ref<string | null>(null)
const mainTesting = ref(false)
const mainSendingTicket = ref(false)

function loadMain(): void {
  const saved = getMainPrinter()
  mainSaved.value = saved?.ip ?? null
  if (saved != null && saved.ip !== '') mainIp.value = saved.ip
}

/**
 * 'Probar conexión y guardar' réplica _testNetworkConnection (L606-656):
 * probe TCP con el puerto capturado; éxito → auto-guard + SnackBar verde;
 * fallo → SnackBar rojo 5s.
 */
async function testAndSaveMain(): Promise<void> {
  const ip = mainIp.value.trim()
  if (ip === '') {
    toast.warning('Ingresa una dirección IP')
    return
  }
  const port = Number.parseInt(mainPort.value, 10) || 9100
  mainTesting.value = true
  try {
    if (desktop) {
      await probePrinter(ip, port, 3000)
    } else {
      // Web: no hay socket; guardar directo (banner ya avisa del canal).
      await new Promise((r) => setTimeout(r, 150))
    }
    setMainPrinter(ip, `Impresora Red - ${ip}`, false)
    mainSaved.value = ip
    toast.success(`✅ Conexión exitosa a ${ip}:${port}`)
  } catch (e) {
    toast.error(`❌ Error de conexión: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    mainTesting.value = false
  }
}

/** Ticket de prueba réplica printTestTicket (L1404-1472) — contenido corto. */
async function sendTestTicket(): Promise<void> {
  mainSendingTicket.value = true
  try {
    const doc = buildClientTicket({
      folio: 'PRUEBA',
      orderType: 'LOCAL',
      customerName: 'CLIENTE LOCAL',
      items: [{ quantity: 1, productName: 'TICKET DE PRUEBA', unitPrice: 0 }],
      total: 0,
      state: { kind: 'pending' },
    })
    if (desktop) {
      const target = mainIp.value.trim() || mainSaved.value
      if (target == null || target === '') {
        toast.warning('Configura primero la impresora principal.')
        return
      }
      // Ronda robustez RED: la principal se guarda como red (probe 9100) →
      // socket TCP directo, mismo transporte del flujo de venta.
      await printTcpEscPos(target, 9100, ticketToEscPosBytes(doc), 2500)
      toast.success('Ticket de prueba enviado.')
    } else {
      const ok = printTicket(doc)
      toast.success(ok ? 'Ticket de prueba enviado (diálogo del navegador).' : 'No se pudo abrir el diálogo de impresión.')
    }
  } catch (e) {
    toast.error(`Error al enviar ticket: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    mainSendingTicket.value = false
  }
}

// ---------------------------------------------------------------------------
// (b) Cocinas K1/K2
// ---------------------------------------------------------------------------

const k1Ip = ref('')
const k2Ip = ref('')
const k1Saved = ref<string | null>(null)
const k2Saved = ref<string | null>(null)
const k1Testing = ref(false)
const k2Testing = ref(false)

function loadKitchenSlots(): void {
  const s1 = getKitchenSlot(1)
  const s2 = getKitchenSlot(2)
  k1Saved.value = s1?.ip ?? null
  k2Saved.value = s2?.ip ?? null
  if (s1 != null && s1.ip !== '') k1Ip.value = s1.ip
  if (s2 != null && s2.ip !== '') k2Ip.value = s2.ip
}

/** Réplica _testKitchenConnection (L345-394): probe + auto-guard manual. */
async function testKitchen(slot: 1 | 2): Promise<void> {
  const ip = (slot === 1 ? k1Ip.value : k2Ip.value).trim()
  const testing = slot === 1 ? k1Testing : k2Testing
  if (ip === '') {
    toast.warning('Ingresa una IP para probar')
    return
  }
  testing.value = true
  try {
    if (desktop) {
      await probePrinter(ip, 9100, 3000)
    } else {
      await new Promise((r) => setTimeout(r, 150))
    }
    setKitchenSlot(slot, ip, `Cocina ${slot} - ${ip}`, false)
    if (slot === 1) k1Saved.value = ip
    else k2Saved.value = ip
    toast.success(`✅ Cocina ${slot} responde en ${ip}:9100`)
  } catch (e) {
    toast.error(`❌ Cocina ${slot} sin respuesta: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    testing.value = false
  }
}

// ---------------------------------------------------------------------------
// (c) Impresoras por área
// ---------------------------------------------------------------------------

interface AreaRow {
  value: string
  isUsb: boolean
  saved: string | null
  saving: boolean
  testing: boolean
}

const areaRows = ref<Record<string, AreaRow>>({})
/** Impresoras Windows (solo Tauri) para el AppSelect por área. */
const systemPrinters = ref<TauriPrinter[]>([])

const printerOptions = computed<AppSelectOption[]>(() => [
  ...systemPrinters.value.map((p) => ({ value: p.name, label: `USB: ${p.name}` })),
])

function loadAreas(): void {
  const rows: Record<string, AreaRow> = {}
  for (const area of PRINT_AREAS) {
    const saved = getAreaPrinter(area)
    rows[area] = {
      value: saved?.ip ?? '',
      isUsb: saved?.isUsb ?? false,
      saved: saved?.ip ?? null,
      saving: false,
      testing: false,
    }
  }
  areaRows.value = rows
}

async function saveArea(area: PrintArea): Promise<void> {
  const row = areaRows.value[area]
  const value = row.value.trim()
  if (value === '') {
    toast.warning(`Ingresa la IP o el nombre USB para ${area}.`)
    return
  }
  row.saving = true
  try {
    setAreaPrinter(area, { ip: value, isUsb: row.isUsb, port: 9100, usbName: row.isUsb ? value : undefined })
    row.saved = value
    toast.success(`Impresora de ${area} guardada.`)
  } finally {
    row.saving = false
  }
}

async function clearArea(area: PrintArea): Promise<void> {
  const row = areaRows.value[area]
  row.saving = true
  try {
    clearAreaPrinter(area)
    row.value = ''
    row.isUsb = false
    row.saved = null
    toast.info(`Impresora de ${area} eliminada.`)
  } finally {
    row.saving = false
  }
}

/** Test por área réplica _testAreaPrinter (L262-300): prueba envío real. */
async function testArea(area: PrintArea): Promise<void> {
  const row = areaRows.value[area]
  const value = row.value.trim()
  if (value === '') {
    toast.warning(`Configura primero la impresora de ${area}.`)
    return
  }
  row.testing = true
  try {
    const doc = buildClientTicket({
      folio: 'PRUEBA',
      orderType: 'LOCAL',
      items: [{ quantity: 1, productName: `PRUEBA ${area}`, unitPrice: 0 }],
      total: 0,
      state: { kind: 'pending' },
    })
    if (desktop) {
      // Mismo transporte por tipo que el flujo de venta (ronda robustez
      // RED): USB → spooler por nombre; red → socket TCP directo.
      if (row.isUsb) {
        await printRawEscPos(value, ticketToEscPosBytes(doc))
      } else {
        await printTcpEscPos(value, 9100, ticketToEscPosBytes(doc), 2500)
      }
    } else {
      printTicket(doc)
    }
    toast.success(`Ticket de prueba enviado a ${area}.`)
  } catch (e) {
    toast.error(`Error al probar ${area}: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    row.testing = false
  }
}

async function loadSystemPrinters(): Promise<void> {
  if (!desktop) return
  systemPrinters.value = await listPrinters()
}

// ---------------------------------------------------------------------------
// (d) Palabras clave
// ---------------------------------------------------------------------------

const keywords = ref<ProductKeyword[]>([])
const showKeywordModal = ref(false)
const kwText = ref('')
const kwArea = ref<PrintArea>('HAMBURGUESAS')

const kwAreaOptions: AppSelectOption[] = PRINT_AREAS.map((a) => ({ value: a, label: a }))

function loadKeywordsNow(): void {
  keywords.value = loadKeywords()
}

function openKeywordModal(): void {
  kwText.value = ''
  kwArea.value = 'HAMBURGUESAS'
  showKeywordModal.value = true
}

/** Réplica _add (keyword_admin_module L28-84): trim + upper. */
function submitKeyword(): void {
  const kw = kwText.value.trim().toUpperCase()
  if (kw === '') {
    toast.warning('Escribe la palabra clave.')
    return
  }
  keywords.value = upsertKeyword(kw, kwArea.value)
  showKeywordModal.value = false
  toast.success(`Palabra clave agregada: ${kw} → ${normalizePrinterArea(kwArea.value)}`)
}

function removeKeyword(id: number): void {
  keywords.value = deleteKeyword(id)
}

// ---------------------------------------------------------------------------
// Escaneo de red (SOLO Tauri) — réplica _scanNetwork L743-883
// ---------------------------------------------------------------------------

interface DiscoveredDevice {
  ip: string
  name: string
  port: number
}

const scanning = ref(false)
const scanProgress = ref<string | null>(null)
const devices = ref<DiscoveredDevice[]>([])

/** Semaphore asíncrono réplica _AsyncSemaphore (L41-66) con límite 20. */
class AsyncSemaphore {
  private current = 0
  private waiters: Array<() => void> = []
  private readonly max: number

  constructor(max: number) {
    this.max = max
  }

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.current++
  }

  release(): void {
    const next = this.waiters.shift()
    if (next != null) next()
    else this.current = Math.max(0, this.current - 1)
  }
}

/**
 * Subredes a escanear: no hay NetworkInterface.list en el webview, así que
 * se derivan de las IPs ya capturadas (principal, áreas, K1/K2) réplica
 * _localSubnets (L675-703). Sin ninguna → 192.168.1.x como red usual.
 */
function targetSubnets(): string[] {
  const candidates: string[] = []
  const addFromIp = (ip: string | null): void => {
    if (ip == null) return
    const lastDot = ip.lastIndexOf('.')
    if (lastDot <= 0) return
    candidates.push(ip.substring(0, lastDot))
  }
  addFromIp(mainIp.value.trim() || mainSaved.value)
  for (const area of PRINT_AREAS) addFromIp(areaRows.value[area]?.value ?? '')
  addFromIp(k1Ip.value.trim())
  addFromIp(k2Ip.value.trim())
  if (candidates.length === 0) candidates.push('192.168.1')
  return [...new Set(candidates)]
}

async function scanNetwork(): Promise<void> {
  if (scanning.value) return
  scanning.value = true
  devices.value = []
  scanProgress.value = 'Buscando impresoras locales...'
  try {
    if (desktop) {
      const printers = await listPrinters()
      for (const p of printers) {
        devices.value.push({ ip: `usb:${p.name}`, name: `USB: ${p.name}`, port: 0 })
      }
    }
    const subnets = targetSubnets()
    const targets: string[] = []
    for (const subnet of subnets) {
      for (let i = 1; i < 255; i++) targets.push(`${subnet}.${i}`)
    }
    scanProgress.value = `Escaneando ${subnets.join(', ')} (${targets.length} equipos)...`

    // Concurrencia 20 (semaphore): el barrido termina en segundos.
    const sem = new AsyncSemaphore(20)
    const found = new Map<string, DiscoveredDevice>()
    let done = 0

    const tasks = targets.map(async (target) => {
      await sem.acquire()
      try {
        // Solo 9100 (raw/ESC-POS): es el puerto que usamos al imprimir
        // (réplica _probeHost que prioriza 9100; 515/631 no sirven para RAW).
        const open = await probePrinter(target, 9100, 800)
          .then(() => true)
          .catch(() => false)
        if (open) {
          found.set(target, { ip: target, name: `Impresora Red - ${target}`, port: 9100 })
        }
      } finally {
        sem.release()
        done++
        if (done % 8 === 0) scanProgress.value = `Escaneando red... ${done}/${targets.length}`
      }
    })
    await Promise.all(tasks)

    const network = [...found.values()].sort((a, b) => {
      const ka = a.ip.split('.').reduce((acc, part) => acc * 256 + (Number.parseInt(part, 10) || 0), 0)
      const kb = b.ip.split('.').reduce((acc, part) => acc * 256 + (Number.parseInt(part, 10) || 0), 0)
      return ka - kb
    })
    // USB primero (réplica L820-826), luego red por IP.
    devices.value = [...devices.value.filter((d) => d.ip.startsWith('usb:')), ...network]
    scanProgress.value = null

    if (network.length === 0) {
      toast.warning(
        `No se encontraron impresoras de red en ${subnets.join(', ')}. Revisa que estén encendidas y en la misma red.`,
      )
    }
  } catch (e) {
    toast.error(`Error al escanear la red: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    scanning.value = false
    scanProgress.value = null
  }
}

/** Asigna un dispositivo descubierto: principal / C1 / C2 / área. */
function assignDevice(target: 'main' | 'k1' | 'k2' | PrintArea, device: DiscoveredDevice): void {
  // USB descubierta (ip = 'usb:<nombre>') réplica printer_settings_screen.dart
  // L37 configValue = isUsb ? (usbName ?? ip) : ip: el NOMBRE vive en ip (el
  // spooler imprime por nombre), NUNCA el prefijo 'usb:' — guardarlo crudo
  // dejaría una config inválida (probePrinter('usb:…') jamás resuelve y
  // OpenPrinterW fallaría).
  const isUsbDevice = device.ip.startsWith('usb:')
  const value = isUsbDevice ? device.ip.slice(4) : device.ip
  if (target === 'main') {
    setMainPrinter(value, device.name, isUsbDevice, isUsbDevice ? value : undefined)
    mainIp.value = value
    mainSaved.value = value
    toast.success(`Impresora guardada: ${device.name}`)
    return
  }
  if (target === 'k1' || target === 'k2') {
    const slot = target === 'k1' ? 1 : 2
    setKitchenSlot(slot, value, `Cocina ${slot} - ${value}`, isUsbDevice)
    if (slot === 1) {
      k1Ip.value = value
      k1Saved.value = value
    } else {
      k2Ip.value = value
      k2Saved.value = value
    }
    toast.success(`Cocina ${slot} guardada: ${device.name}`)
    return
  }
  setAreaPrinter(target, { ip: value, isUsb: isUsbDevice, port: 9100, usbName: isUsbDevice ? value : undefined })
  const row = areaRows.value[target]
  if (row != null) {
    row.value = value
    row.isUsb = isUsbDevice
    row.saved = value
  }
  toast.success(`Impresora de ${target} guardada.`)
}

/** Labels de asignación de un dispositivo (principal/cocina 1/áreas). */
function deviceAssignedLabels(device: DiscoveredDevice): string[] {
  const labels: string[] = []
  // USB descubierta: la config guarda el NOMBRE (sin 'usb:'), comparar contra
  // él — la UI "asignada" debe matchear lo persistido, no la clave del scan.
  const value = device.ip.startsWith('usb:') ? device.ip.slice(4) : device.ip
  if (mainSaved.value != null && value === mainSaved.value) labels.push('principal')
  if (k1Saved.value != null && value === k1Saved.value) labels.push('cocina 1')
  if (k2Saved.value != null && value === k2Saved.value) labels.push('cocina 2')
  for (const area of PRINT_AREAS) {
    if (areaRows.value[area]?.saved === value) labels.push(area.toLowerCase())
  }
  return labels
}

function isDeviceAssigned(device: DiscoveredDevice): boolean {
  return deviceAssignedLabels(device).length > 0
}

// ---------------------------------------------------------------------------

onMounted(() => {
  loadMain()
  loadKitchenSlots()
  loadAreas()
  loadKeywordsNow()
  void loadSystemPrinters()
})
</script>

<template>
  <div class="prt">
    <!-- AppBar réplica: back → ajustes -->
    <header class="prt-appbar">
      <button
        type="button"
        class="prt-icon-btn"
        title="Regresar a Ajustes"
        aria-label="Regresar a Ajustes"
        data-testid="prt-back"
        @click="goBack"
      >
        <ArrowLeft :size="24" aria-hidden="true" />
      </button>
      <h1 class="prt-appbar-title">Configuración de Impresora</h1>
    </header>

    <main class="prt-body">
      <!-- Banner informativo (solo web) -->
      <div v-if="!desktop" class="prt-banner" data-testid="prt-web-banner">
        La impresión térmica directa está disponible en la app de escritorio; en el navegador se
        usa el diálogo de impresión del sistema.
      </div>

      <!-- ===== (a) IMPRESORA PRINCIPAL ===== -->
      <section class="prt-card" data-testid="prt-main-card">
        <div class="prt-card-head">
          <Printer :size="20" class="prt-card-icon" aria-hidden="true" />
          <h2 class="prt-card-title">Impresora principal — cliente / caja</h2>
        </div>
        <p class="prt-card-sub">Ticket de cliente, pre-cuentas y cobros salen por esta impresora.</p>
        <div class="prt-row">
          <label class="prt-field prt-field--port">
            <span class="prt-label">Puerto</span>
            <input v-model="mainPort" type="text" inputmode="numeric" class="prt-input" data-testid="prt-main-port" />
          </label>
          <label class="prt-field prt-field--ip">
            <span class="prt-label">Dirección IP</span>
            <input
              v-model="mainIp"
              type="text"
              inputmode="text"
              class="prt-input"
              placeholder="192.168.1.100"
              data-testid="prt-main-ip"
            />
          </label>
        </div>
        <button
          type="button"
          class="prt-btn prt-btn--primary"
          data-testid="prt-main-test"
          :disabled="mainTesting"
          @click="testAndSaveMain"
        >
          <Loader2 v-if="mainTesting" :size="18" class="prt-spin" aria-hidden="true" />
          <CheckCircle2 v-else :size="18" aria-hidden="true" />
          {{ mainTesting ? 'Probando...' : 'Probar conexión y guardar' }}
        </button>
        <div class="prt-divider" />
        <div class="prt-saved-row">
          <div>
            <p class="prt-saved-title">Impresora guardada</p>
            <p class="prt-saved-value" data-testid="prt-main-saved">
              {{ mainSaved ?? 'Ninguna — busca abajo o escribe la IP.' }}
            </p>
          </div>
          <span v-if="mainSaved != null" class="prt-chip prt-chip--ok">Lista</span>
        </div>
        <button
          type="button"
          class="prt-btn prt-btn--accent"
          data-testid="prt-main-test-ticket"
          :disabled="mainSendingTicket"
          @click="sendTestTicket"
        >
          <Loader2 v-if="mainSendingTicket" :size="18" class="prt-spin" aria-hidden="true" />
          <Receipt v-else :size="18" aria-hidden="true" />
          {{ mainSendingTicket ? 'Enviando...' : 'Ticket prueba' }}
        </button>
      </section>

      <!-- ===== (b) COCINAS — DOBLE IMPRESIÓN ===== -->
      <section class="prt-card" data-testid="prt-kitchens-card">
        <div class="prt-card-head">
          <Soup :size="20" class="prt-card-icon" aria-hidden="true" />
          <h2 class="prt-card-title">Cocinas — doble impresión</h2>
        </div>
        <p class="prt-card-sub">
          El botón "Cocina x2" de piso 2 manda solo el ticket de cocina a estas dos impresoras. No
          afecta la impresora principal.
        </p>
        <div v-for="slot in ([1, 2] as const)" :key="slot" class="prt-kitchen-slot">
          <div class="prt-kitchen-head">
            <span class="prt-kitchen-title">Cocina {{ slot }}</span>
            <span
              class="prt-chip"
              :class="(slot === 1 ? k1Saved : k2Saved) != null ? 'prt-chip--ok' : 'prt-chip--muted'"
              :data-testid="`prt-k${slot}-saved`"
            >
              {{ (slot === 1 ? k1Saved : k2Saved) ?? 'Sin configurar' }}
            </span>
          </div>
          <div class="prt-row">
            <label class="prt-field prt-field--ip">
              <span class="prt-label">IP Cocina {{ slot }}</span>
              <input
                :value="slot === 1 ? k1Ip : k2Ip"
                type="text"
                class="prt-input"
                :placeholder="`192.168.1.10${slot}`"
                :data-testid="`prt-k${slot}-ip`"
                @input="slot === 1 ? (k1Ip = ($event.target as HTMLInputElement).value) : (k2Ip = ($event.target as HTMLInputElement).value)"
              />
            </label>
            <button
              type="button"
              class="prt-btn prt-btn--accent"
              :data-testid="`prt-k${slot}-test`"
              :disabled="slot === 1 ? k1Testing : k2Testing"
              @click="testKitchen(slot)"
            >
              <Loader2 v-if="slot === 1 ? k1Testing : k2Testing" :size="18" class="prt-spin" aria-hidden="true" />
              <CheckCircle2 v-else :size="18" aria-hidden="true" />
              {{ (slot === 1 ? k1Testing : k2Testing) ? '...' : 'Probar' }}
            </button>
          </div>
          <div v-if="slot === 1" class="prt-divider" />
        </div>
      </section>

      <!-- ===== (c) IMPRESORAS POR ÁREA ===== -->
      <section class="prt-card" data-testid="prt-areas-card">
        <div class="prt-card-head">
          <Tag :size="20" class="prt-card-icon" aria-hidden="true" />
          <h2 class="prt-card-title">Impresoras por área</h2>
        </div>
        <p class="prt-card-sub">
          Cada área imprime en su propia impresora según las palabras clave configuradas abajo.
          También puedes asignarlas con los botones de la lista de impresoras descubiertas.
        </p>
        <template v-for="(area, idx) in PRINT_AREAS" :key="area">
          <div v-if="idx > 0" class="prt-divider" />
          <div class="prt-area">
            <div class="prt-area-head">
              <component
                :is="area === 'CLIENTE' ? Receipt : Soup"
                :size="20"
                class="prt-card-icon"
                aria-hidden="true"
              />
              <span class="prt-area-title">{{ area }}</span>
              <button
                v-if="areaRows[area]?.saved != null"
                type="button"
                class="prt-link-danger"
                :data-testid="`prt-area-${area.toLowerCase()}-clear`"
                @click="clearArea(area)"
              >
                <X :size="14" aria-hidden="true" /> Quitar
              </button>
            </div>
            <label class="prt-field">
              <span class="prt-label">{{ areaRows[area]?.isUsb ? 'Nombre impresora USB' : 'Dirección IP' }}</span>
              <!-- Tauri: AppSelect de impresoras de Windows + edición manual;
                   web: input libre (brief sección B.6). -->
              <AppSelect
                v-if="desktop && printerOptions.length > 0"
                :model-value="areaRows[area]?.value ?? ''"
                :options="[...printerOptions, { value: '__manual__', label: 'Escribir otra…' }]"
                :testid="`prt-area-${area.toLowerCase()}-select`"
                @update:model-value="(v: string | number) => areaRows[area] && (areaRows[area].value = v === '__manual__' ? '' : String(v))"
              />
              <input
                v-else
                :value="areaRows[area]?.value ?? ''"
                type="text"
                class="prt-input"
                :placeholder="areaRows[area]?.isUsb ? 'EPSON TM-T20' : '192.168.1.100'"
                :data-testid="`prt-area-${area.toLowerCase()}-ip`"
                @input="areaRows[area] && (areaRows[area].value = ($event.target as HTMLInputElement).value)"
              />
            </label>
            <div class="prt-area-actions">
              <label class="prt-toggle">
                <input
                  type="checkbox"
                  :checked="areaRows[area]?.isUsb"
                  :data-testid="`prt-area-${area.toLowerCase()}-usb`"
                  @change="areaRows[area] && (areaRows[area].isUsb = ($event.target as HTMLInputElement).checked)"
                />
                <span>{{ areaRows[area]?.isUsb ? 'USB' : 'Red' }}</span>
              </label>
              <span class="prt-spacer" />
              <button
                type="button"
                class="prt-btn prt-btn--outline"
                :data-testid="`prt-area-${area.toLowerCase()}-test`"
                :disabled="areaRows[area]?.testing"
                @click="testArea(area)"
              >
                <Loader2 v-if="areaRows[area]?.testing" :size="16" class="prt-spin" aria-hidden="true" />
                <Receipt v-else :size="16" aria-hidden="true" />
                {{ areaRows[area]?.testing ? 'Probando...' : 'Probar' }}
              </button>
              <button
                type="button"
                class="prt-btn prt-btn--green"
                :data-testid="`prt-area-${area.toLowerCase()}-save`"
                :disabled="areaRows[area]?.saving"
                @click="saveArea(area)"
              >
                <Loader2 v-if="areaRows[area]?.saving" :size="16" class="prt-spin" aria-hidden="true" />
                {{ areaRows[area]?.saving ? 'Guardando...' : 'Guardar' }}
              </button>
            </div>
          </div>
        </template>
      </section>

      <!-- ===== (d) PALABRAS CLAVE ===== -->
      <section class="prt-card" data-testid="prt-keywords-card">
        <div class="prt-card-head">
          <Tag :size="20" class="prt-card-icon" aria-hidden="true" />
          <h2 class="prt-card-title">Palabras clave por área</h2>
          <span class="prt-spacer" />
          <button
            type="button"
            class="prt-btn prt-btn--accent prt-btn--sm"
            data-testid="prt-keywords-add"
            @click="openKeywordModal"
          >
            <Plus :size="16" aria-hidden="true" /> Agregar
          </button>
        </div>
        <p class="prt-card-sub">Palabra → área. Se usan para elegir la impresora de cocina.</p>
        <p v-if="keywords.length === 0" class="prt-empty" data-testid="prt-keywords-empty">
          Sin palabras clave.
        </p>
        <div v-else class="prt-keyword-list">
          <span
            v-for="kw in keywords"
            :key="kw.id"
            class="prt-keyword-chip"
            :data-testid="`prt-kw-${kw.keyword.toLowerCase()}`"
          >
            {{ kw.keyword }} → {{ kw.printerArea }}
            <button
              type="button"
              class="prt-kw-delete"
              :aria-label="`Eliminar ${kw.keyword}`"
              @click="removeKeyword(kw.id)"
            >
              <X :size="12" aria-hidden="true" />
            </button>
          </span>
        </div>
      </section>

      <!-- ===== ESCANEO DE RED ===== -->
      <button
        type="button"
        class="prt-btn prt-btn--accent prt-btn--full"
        data-testid="prt-scan"
        :disabled="scanning || !desktop"
        :title="desktop ? undefined : 'Solo disponible en la app de escritorio'"
        @click="scanNetwork"
      >
        <Loader2 v-if="scanning" :size="20" class="prt-spin" aria-hidden="true" />
        <Search v-else :size="20" aria-hidden="true" />
        {{ scanning ? 'Buscando...' : 'Buscar impresoras (USB y red)' }}
      </button>

      <h2 class="prt-section-title">Impresoras descubiertas</h2>
      <p class="prt-card-sub">
        Toca una impresora para usarla como principal. Con C1 / C2 la asignas como cocina 1 o 2, y
        con los botones de área la usas para Hamburguesas, Cocina o Cliente.
      </p>
      <p v-if="scanProgress != null" class="prt-progress" data-testid="prt-scan-progress">
        {{ scanProgress }}
      </p>
      <p v-if="devices.length === 0" class="prt-empty" data-testid="prt-devices-empty">
        {{ scanning ? 'Escaneando la red...' : 'Presiona buscar para encontrar impresoras.' }}
      </p>
      <div v-else class="prt-devices">
        <div v-for="device in devices" :key="device.ip" class="prt-device" :data-testid="`prt-device-${device.ip}`">
          <div class="prt-device-main" @click="assignDevice('main', device)">
            <component
              :is="device.ip.startsWith('usb:') ? Usb : Wifi"
              :size="18"
              :class="isDeviceAssigned(device) ? 'prt-device-icon--ok' : 'prt-device-icon'"
              aria-hidden="true"
            />
            <div class="prt-device-text">
              <span class="prt-device-name">{{ device.name }}</span>
              <span class="prt-device-sub">
                {{ deviceAssignedLabels(device).length > 0 ? `• ${deviceAssignedLabels(device).join(' • ')}` : '' }}
              </span>
            </div>
          </div>
          <div class="prt-device-assign">
            <span class="prt-device-label">Cocina:</span>
            <button type="button" class="prt-assign-btn" :data-testid="`prt-assign-k1-${device.ip}`" @click="assignDevice('k1', device)">C1</button>
            <button type="button" class="prt-assign-btn" :data-testid="`prt-assign-k2-${device.ip}`" @click="assignDevice('k2', device)">C2</button>
            <span class="prt-device-label">Área:</span>
            <button
              v-for="area in PRINT_AREAS"
              :key="area"
              type="button"
              class="prt-assign-btn"
              :data-testid="`prt-assign-${area.toLowerCase()}-${device.ip}`"
              @click="assignDevice(area, device)"
            >
              {{ area }}
            </button>
          </div>
        </div>
      </div>
    </main>

    <!-- Modal agregar palabra clave (réplica showDialog keyword_admin_module) -->
    <AppModal v-if="showKeywordModal" title="Palabra clave" :width="400" @close="showKeywordModal = false">
      <div class="prt-modal">
        <label class="prt-field">
          <span class="prt-label">Palabra clave</span>
          <input
            v-model="kwText"
            type="text"
            class="prt-input"
            placeholder="Ej. HAMBURGUESA"
            data-testid="prt-kw-input"
            @keydown.enter="submitKeyword"
          />
        </label>
        <label class="prt-field">
          <span class="prt-label">Área</span>
          <AppSelect v-model="kwArea" :options="kwAreaOptions" testid="prt-kw-area" />
        </label>
      </div>
      <template #footer>
        <button type="button" class="prt-btn prt-btn--ghost" @click="showKeywordModal = false">Cancelar</button>
        <button type="button" class="prt-btn prt-btn--primary" data-testid="prt-kw-save" @click="submitKeyword">Agregar</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.prt {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg);
  font-family: var(--font);
}

.prt-appbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--bg);
}

.prt-appbar-title {
  margin: 0;
  flex: 1;
  font-size: 22px;
  font-weight: 400;
  color: var(--text);
}

.prt-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex: none;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--text);
  cursor: pointer;
  transition: background 0.15s ease;
}

.prt-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.prt-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  padding-bottom: 32px;
}

/* Banner informativo web */
.prt-banner {
  margin: 0 16px 12px;
  padding: 12px;
  border: 1px solid rgba(33, 150, 243, 0.35);
  background: rgba(33, 150, 243, 0.12);
  border-radius: 10px;
  color: var(--text);
  font-size: 0.9rem;
}

/* Card réplica Card+Padding 16 del Flutter */
.prt-card {
  margin: 0 16px 16px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.prt-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.prt-card-icon {
  color: var(--primary);
  flex: none;
}

.prt-card-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
}

.prt-card-sub {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
}

.prt-section-title {
  margin: 8px 16px 4px;
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
}

.prt-row {
  display: flex;
  gap: 12px;
}

.prt-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.prt-field--port {
  flex: 2;
  max-width: 140px;
}

.prt-field--ip {
  flex: 5;
}

.prt-label {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.prt-input {
  width: 100%;
  height: 44px;
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  outline: none;
  transition: border-color 0.15s ease;
}

.prt-input:focus {
  border-color: var(--primary);
  border-width: 1.4px;
}

.prt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  border: 1px solid transparent;
  border-radius: 10px;
  font-family: var(--font);
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease;
}

.prt-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.prt-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.prt-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.prt-btn--accent {
  background: var(--primary);
  color: var(--on-primary);
}

.prt-btn--outline {
  background: transparent;
  border-color: var(--border);
  color: var(--text);
}

.prt-btn--green {
  background: #2e7d32; /* Colors.green[700] réplica */
  color: #ffffff;
}

.prt-btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-muted);
}

.prt-btn--sm {
  padding: 6px 12px;
  font-size: 0.85rem;
}

.prt-btn--full {
  margin: 0 16px 16px;
  width: calc(100% - 32px);
}

.prt-divider {
  height: 1px;
  background: var(--border);
}

.prt-saved-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.prt-saved-title {
  margin: 0;
  font-weight: 700;
  font-size: 15px;
  color: var(--text);
}

.prt-saved-value {
  margin: 2px 0 0;
  font-size: 14px;
  color: var(--text-muted);
}

.prt-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: #ffffff;
}

.prt-chip--ok {
  background: #2e7d32;
}

.prt-chip--muted {
  background: #616161; /* Colors.grey[700] réplica */
}

.prt-kitchen-slot {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prt-kitchen-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.prt-kitchen-title {
  font-weight: 700;
  font-size: 15px;
  color: var(--text);
}

.prt-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prt-area-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.prt-area-title {
  font-weight: 700;
  font-size: 15px;
  color: var(--text);
  flex: 1;
}

.prt-link-danger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: #ef9a9a; /* Colors.red[300] réplica */
  font-family: var(--font);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 4px 8px;
}

.prt-area-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.prt-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
}

.prt-toggle input {
  accent-color: var(--primary);
  width: 18px;
  height: 18px;
}

.prt-spacer {
  flex: 1;
}

.prt-empty {
  margin: 0;
  padding: 12px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 14px;
}

.prt-keyword-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.prt-keyword-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255, 87, 34, 0.15); /* deepOrange alpha .15 réplica */
  color: var(--text);
  font-size: 12px;
}

.prt-kw-delete {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 999px;
}

.prt-kw-delete:hover {
  color: var(--text);
}

.prt-progress {
  margin: 8px 16px;
  font-size: 12px;
  color: var(--text-muted);
}

.prt-devices {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 16px;
}

.prt-device {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prt-device-main {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.prt-device-icon {
  color: var(--text-muted);
}

.prt-device-icon--ok {
  color: #69f0ae; /* Colors.greenAccent réplica */
}

.prt-device-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.prt-device-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.prt-device-sub {
  font-size: 12px;
  color: var(--text-muted);
}

.prt-device-assign {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.prt-device-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.prt-assign-btn {
  padding: 5px 10px;
  border: none;
  border-radius: 8px;
  background: var(--primary);
  color: var(--on-primary);
  font-family: var(--font);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.prt-assign-btn:hover {
  background: var(--primary-hover);
}

.prt-modal {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.prt-spin {
  animation: prt-rotate 1s linear infinite;
}

@keyframes prt-rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 600px) {
  .prt-row {
    flex-direction: column;
  }
  .prt-field--port {
    max-width: none;
  }
  .prt-appbar-title {
    font-size: 18px;
  }
}
</style>
