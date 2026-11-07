<script setup lang="ts">
/**
 * CashDrawerView · pantalla CAJA del rail — réplica PIXEL-FIEL de
 * lib/screens/admin/cash_drawer_screen.dart (CrazyWings, 1189 líneas).
 *
 * Constantes de layout (L22-25): _inputHeight=44, _cardPadding=18,
 * _qtyWidth=110, _valueWidth=140. Inputs monetarios 160x44 prefix 'MXN '
 * hint '0.00' align end fill white .06 border white .12 / primario 1.4 (L52-73).
 * Moneda 'MXN ' con formato es-MX (L50).
 *
 * Estructura (L486-566): AppBar 'Arqueo y Cierre de Caja' → estado sin sesión
 * (L496-500 texto EXACTO + diálogo Iniciar caja de module_selection_screen
 * L113-168) → Card 1 'Resumen de la Sesion' (L570-647) → Card 2 'Desglose de
 * Efectivo' (L649-739) → botón 'Cerrar Caja y Sesión' (L535-556) + barra
 * inferior fija (L125-168).
 *
 * FÓRMULA REACTIVA (L429-452): totalCash = startingAmount + totalSales -
 * canceledTotal - expenses - cardTotal - transferTotal; difference =
 * denominationsTotal - totalCash. didiCash NO se suma (ya está en totalSales,
 * L434-435). cardTotal/transferTotal son del SISTEMA (breakdown), no los
 * capturados.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Plus,
  ReceiptText,
  SlidersHorizontal,
  TriangleAlert,
  Wallet,
  X,
} from 'lucide-vue-next'
import { ApiError } from '../../api/client'
import type { CardTerminalEntry, DenominationEntry } from '../../api/pos-types'
import { useCashStore } from '../../stores/cash'
import { useToastStore } from '../../stores/toast'
import { POS_PLANT_ID, POS_SUCURSAL_ID } from '../../stores/catalog'
import { clearSession, session } from '../../services/auth'
import { AppBanner, AppSpinner } from '../../components/ui'
import AppModal from '../../components/pos/AppModal.vue'

const cashStore = useCashStore()
const toast = useToastStore()
const router = useRouter()

// --- Constantes de layout (cash_drawer_screen.dart L22-25): _inputHeight=44,
// _cardPadding=18, _qtyWidth=110, _valueWidth=140 — replicadas 1:1 en el CSS
// de abajo (ver comentarios por regla).

// --- Formato moneda (L50): 'MXN ' + es-MX ------------------------------------
function formatMoney(amount: number): string {
  const formatted = new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
  return `MXN ${formatted}`
}

/** Diferencia con signo (L400-403): '+MXN X' si > 0. */
function formatDifference(amount: number): string {
  const prefix = amount > 0 ? '+' : ''
  return `${prefix}${formatMoney(amount)}`
}

function parseDouble(value: string | null | undefined): number {
  if (value == null) return 0
  const normalized = value.replaceAll(',', '.')
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

// --- Guardas de rol (L215-218) ------------------------------------------------
const hasCashierAccess = computed<boolean>(() => {
  const role = session.role
  // 'solo si role existe y no es admin/cashier' — roles del Rest + legacy.
  if (role == null) return true
  const upper = role.toUpperCase()
  return (
    upper === 'RESTCASHIER' ||
    upper === 'RESTADMIN' ||
    upper === 'CAJERO' ||
    upper === 'ADMINISTRADOR' ||
    upper === 'ADMIN'
  )
})

// --- Carga inicial --------------------------------------------------------------
const isLoading = ref(true)

onMounted(async () => {
  if (!hasCashierAccess.value) {
    isLoading.value = false
    return
  }
  await cashStore.fetchCurrent()
  if (cashStore.hasOpenSession) {
    await Promise.all([
      cashStore.fetchBreakdown(),
      cashStore.fetchReconciliation(),
      cashStore.fetchDollarRate(),
    ])
    hydrateFromReconciliation()
    maybeShowLongSessionAlert()
  }
  isLoading.value = false
})

// --- Estado del arqueo (inputs reactivos) -------------------------------------

const didiCashText = ref('')
const expensesText = ref('')
const transferCountedText = ref('')
const notesText = ref('')

/** Terminales de tarjeta editables (réplica _CardTerminalEntry). */
interface CardTerminalRow {
  name: string
  amountText: string
}
const cardTerminals = ref<CardTerminalRow[]>([{ name: '', amountText: '' }])

/** Filas del desglose (réplica _DenominationRow L178-188). */
interface DenominationRow {
  label: string
  unitValue: number | null
  isEditableValue: boolean
  isUsd: boolean
  singleInput: boolean
  qtyText: string
  valueText: string
}
const denominations = ref<DenominationRow[]>([
  { label: 'Guardado', unitValue: null, isEditableValue: true, isUsd: false, singleInput: false, qtyText: '', valueText: '' },
  { label: '500', unitValue: 500, isEditableValue: false, isUsd: false, singleInput: false, qtyText: '', valueText: '' },
  { label: '200', unitValue: 200, isEditableValue: false, isUsd: false, singleInput: false, qtyText: '', valueText: '' },
  { label: '100', unitValue: 100, isEditableValue: false, isUsd: false, singleInput: false, qtyText: '', valueText: '' },
  { label: '50', unitValue: 50, isEditableValue: false, isUsd: false, singleInput: false, qtyText: '', valueText: '' },
  { label: '20', unitValue: 20, isEditableValue: false, isUsd: false, singleInput: false, qtyText: '', valueText: '' },
  { label: 'Dlls', unitValue: null, isEditableValue: false, isUsd: true, singleInput: true, qtyText: '', valueText: '' },
  { label: 'Cambio', unitValue: null, isEditableValue: true, isUsd: false, singleInput: true, qtyText: '', valueText: '' },
])

/** Hidrata inputs desde el arqueo persistido (réplica _loadReconciliation L326-366). */
function hydrateFromReconciliation(): void {
  const rec = cashStore.reconciliation
  if (rec == null) {
    // Réplica L275-277: sin arqueo, DIDI efectivo prefilled con el del sistema.
    if (systemDidiCash.value > 0) {
      didiCashText.value = systemDidiCash.value.toFixed(2)
    }
    return
  }
  didiCashText.value = (rec.didiCash ?? 0).toString()
  expensesText.value = (rec.expenses ?? 0).toString()
  transferCountedText.value = rec.transferCountedTotal?.toString() ?? ''
  notesText.value = rec.notes ?? ''

  if (rec.cardTerminals != null && rec.cardTerminals.length > 0) {
    cardTerminals.value = rec.cardTerminals.map((t: CardTerminalEntry) => ({
      name: t.name ?? '',
      amountText: t.amount?.toString() ?? '',
    }))
  }
  if (rec.denominations != null) {
    for (const row of denominations.value) {
      const match = rec.denominations.find((d: DenominationEntry) => (d.label ?? '') === row.label)
      if (match != null) {
        row.qtyText = (match.qty ?? 0).toString()
        row.valueText = (match.value ?? '').toString()
      }
    }
  }
}

// --- Datos del sistema (breakdown) ---------------------------------------------

const sessionData = computed(() => cashStore.current)
const breakdown = computed(() => cashStore.breakdown)

const totalSales = computed(() => breakdown.value?.totalSales ?? 0)
const startingAmount = computed(() => sessionData.value?.startingAmount ?? 0)
const cardTotal = computed(() => breakdown.value?.cardTotal ?? 0)
const transferTotal = computed(() => breakdown.value?.transferTotal ?? 0)
const didiUberCardTotal = computed(() => breakdown.value?.didiUberCardTotal ?? 0)
const systemDidiCash = computed(() => breakdown.value?.didiUberCashTotal ?? 0)
const canceledTotal = computed(() => breakdown.value?.canceledTotal ?? 0)
/** Métodos no parseables (fix QA: el backend lo excluye del esperado). */
const unclassifiedTotal = computed(() => breakdown.value?.unclassifiedTotal ?? 0)

// --- Cálculos del arqueo (réplica L374-452) -----------------------------------

/** Tarjeta esperada en terminales (L380-383): cardTotal − didiUberCard. */
const cardTotalWithoutDidiUber = computed<number>(() => {
  const local = cardTotal.value - didiUberCardTotal.value
  return local < 0 ? 0 : local
})

const cardTerminalsCountedTotal = computed<number>(() =>
  cardTerminals.value.reduce((sum, t) => sum + parseDouble(t.amountText), 0))

const cardTerminalsDifference = computed<number>(
  () => cardTerminalsCountedTotal.value - cardTotalWithoutDidiUber.value)

const transferCountedTotal = computed<number>(() => parseDouble(transferCountedText.value))
const transferDifference = computed<number>(() => transferCountedTotal.value - transferTotal.value)

const dollarRate = computed<number>(() => cashStore.rate)

/** Total del desglose (L405-427): qty*unit | valor libre | USD*rate. */
const denominationsTotal = computed<number>(() => {
  let total = 0
  for (const row of denominations.value) {
    const qty = parseDouble(row.qtyText)
    if (row.unitValue != null) {
      total += qty * row.unitValue
      continue
    }
    const value = parseDouble(row.valueText)
    const amount = row.singleInput
      ? qty
      : row.isEditableValue && value === 0
        ? qty
        : value
    if (row.isUsd && dollarRate.value > 0) {
      total += amount * dollarRate.value
    } else {
      total += amount
    }
  }
  return total
})

const expenses = computed<number>(() => parseDouble(expensesText.value))
const didiCash = computed<number>(() => parseDouble(didiCashText.value))

/**
 * FÓRMULA REACTIVA EXACTA (L429-452): didiCash NO se suma (ya está en
 * totalSales); cardTotal/transferTotal son del SISTEMA.
 * Fix QA: se resta unclassifiedTotal — el backend lo EXCLUYE del esperado
 * (nunca lo trata como efectivo), así la difference del diálogo coincide
 * con la difference persistida server-side.
 */
const totalCash = computed<number>(() =>
  startingAmount.value +
  totalSales.value -
  unclassifiedTotal.value -
  canceledTotal.value -
  expenses.value -
  cardTotal.value -
  transferTotal.value)

const difference = computed<number>(() => denominationsTotal.value - totalCash.value)

const isButtonDisabled = computed<boolean>(() => denominationsTotal.value <= 0)

/** Warning DIDI (L449-450): solo si difiere del sistema. */
const showDidiCashWarning = computed<boolean>(() =>
  systemDidiCash.value > 0 && Math.abs(didiCash.value - systemDidiCash.value) > 0.01)

// --- Diálogos -------------------------------------------------------------------

type DialogState =
  | { kind: 'none' }
  | { kind: 'start-session' }
  | { kind: 'long-session'; message: string }
  | { kind: 'confirm-close' }
  | { kind: 'closing' }

const dialog = ref<DialogState>({ kind: 'none' })
const startAmountText = ref('')
const startError = ref<string | null>(null)
const closing = ref(false)

/** Iniciar caja (diálogo réplica module_selection_screen.dart L113-168). */
function openStartSessionDialog(): void {
  startAmountText.value = ''
  startError.value = null
  dialog.value = { kind: 'start-session' }
}

async function confirmStartSession(): Promise<void> {
  const amount = Number.parseFloat(startAmountText.value.replaceAll(',', '.'))
  if (!Number.isFinite(amount) || amount < 0) {
    startError.value = 'Monto inválido'
    return
  }
  try {
    await cashStore.openSession(amount)
    dialog.value = { kind: 'none' }
    toast.success('Caja iniciada')
    // Recarga datos de la sesión recién abierta.
    await Promise.all([
      cashStore.fetchBreakdown(),
      cashStore.fetchReconciliation(),
      cashStore.fetchDollarRate(),
    ])
    hydrateFromReconciliation()
  } catch (err) {
    startError.value = err instanceof ApiError && err.status !== 0
      ? err.message
      : 'No se pudo iniciar la caja. Verifica tu conexión.'
  }
}

/** Alerta sesión ≥24h (L282-287 + L303-324) — se muestra UNA vez al cargar. */
let longSessionAlertShown = false
function maybeShowLongSessionAlert(): void {
  if (longSessionAlertShown) return
  const startTime = sessionData.value?.startTime
  if (startTime == null) return
  const start = new Date(startTime)
  if (start.getTime() <= new Date(2000, 0, 1).getTime()) return
  const durationMs = Date.now() - start.getTime()
  const hours = Math.floor(durationMs / 3_600_000)
  if (hours < 24) return
  longSessionAlertShown = true
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  const daysPart = days > 0 ? `${days} día${days > 1 ? 's' : ''} y ` : ''
  dialog.value = {
    kind: 'long-session',
    message:
      `Esta sesión lleva abierta ${daysPart}${restHours} horas.\n\n` +
      'Se recomienda cerrar la sesión diariamente para mantener registros precisos.',
  }
}

/** Botón 'Cerrar Caja y Sesión' (L545-551): abre la confirmación EXACTA. */
function openConfirmClose(): void {
  if (isButtonDisabled.value) return
  dialog.value = { kind: 'confirm-close' }
}

/** Texto de confirmación EXACTO (L1010-1015). */
const confirmCloseMessage = computed<string>(() =>
  `Efectivo: diferencia ${formatMoney(difference.value)}.\n` +
  `Tarjeta: diferencia capturado - sistema de ${formatDifference(cardTerminalsDifference.value)}.\n` +
  `Transferencias: diferencia capturado - sistema de ${formatDifference(transferDifference.value)}.\n\n` +
  '¿Estás seguro de que deseas cerrar esta caja? Esta acción no se puede deshacer.')

/** Continuar y Cerrar (L1021-1143): PUT reconciliation + POST close + logout. */
async function confirmClose(): Promise<void> {
  dialog.value = { kind: 'closing' }
  closing.value = true
  try {
    // 1) Persistir arqueo con los inputs actuales (L1086-1116).
    // Filas de terminal sin nombre (vacías del '+ Agregar terminal') se
    // excluyen: el backend exige Name (400 si va vacío).
    await cashStore.saveReconciliation({
      didiCash: didiCash.value,
      expenses: expenses.value,
      cardTerminals: cardTerminals.value
        .filter((t) => t.name.trim() !== '' || parseDouble(t.amountText) !== 0)
        .map((t) => ({
          name: t.name.trim(),
          amount: parseDouble(t.amountText),
        })),
      cardTerminalsCountedTotal: cardTerminalsCountedTotal.value,
      transferCountedTotal: transferCountedTotal.value,
      denominations: denominations.value.map((row) => ({
        label: row.label,
        qty: parseDouble(row.qtyText),
        value: parseDouble(row.valueText),
        isUsd: row.isUsd,
      })),
      denominationsTotal: denominationsTotal.value,
      notes: notesText.value.trim(),
    })

    // 2) Cierre definitivo (L1118-1121).
    await cashStore.closeSession({
      denominationsTotal: denominationsTotal.value,
      notes: notesText.value.trim(),
    })

    // 3) Logout + login (réplica L1128-1133: authProvider.logout + /login).
    clearSession()
    await router.push({ name: 'login' })
  } catch (err) {
    dialog.value = { kind: 'none' }
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error al cerrar la sesión: ${err.message}`
        : 'Error al cerrar la sesión. Verifica tu conexión.',
    )
  } finally {
    closing.value = false
  }
}

// --- Helpers de fecha (formato dd/MM/yyyy hh:mm a, L594) -----------------------

function formatSessionStart(iso: string | null | undefined): string {
  if (iso == null) return 'N/A'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'N/A'
  const pad = (n: number): string => String(n).padStart(2, '0')
  const hour12 = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12
  const meridiem = d.getHours() < 12 ? 'a.m.' : 'p.m.'
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(hour12)}:${pad(d.getMinutes())} ${meridiem}`
}

/** Valor de una fila del desglose (réplica _buildDenominationRow L913-928). */
function denominationRowTotal(row: DenominationRow): number {
  const qty = parseDouble(row.qtyText)
  if (row.unitValue != null) return qty * row.unitValue
  const value = parseDouble(row.valueText)
  const amount = row.singleInput
    ? qty
    : row.isEditableValue && value === 0
      ? qty
      : value
  if (row.isUsd && dollarRate.value > 0) return amount * dollarRate.value
  return amount
}

const differenceColor = computed<string>(() =>
  difference.value < 0 ? '#e53935' : '#43a047') // red.shade700 / green.shade800 (L719-720)
</script>

<template>
  <div class="cash">
    <!-- AppBar (L487-489) -->
    <header class="cash-appbar" data-testid="cash-appbar">
      <h1 class="cash-appbar-title">Arqueo y Cierre de Caja</h1>
    </header>

    <!-- Loading (L490-491) -->
    <div v-if="isLoading" class="cash-state">
      <AppSpinner :size="32" tone="primary" />
    </div>

    <!-- Guarda de rol (L492-495, texto EXACTO) -->
    <div v-else-if="!hasCashierAccess" class="cash-state" data-testid="cash-forbidden">
      <p>Acceso restringido a caja. Solo cajero.</p>
    </div>

    <!-- Estado SIN sesión (L496-500, texto EXACTO + botón Iniciar caja) -->
    <div v-else-if="!cashStore.hasOpenSession" class="cash-state" data-testid="cash-empty">
      <p>No hay sesión de caja activa.</p>
      <button
        type="button"
        class="cash-start-btn"
        data-testid="cash-start"
        @click="openStartSessionDialog"
      >
        <Wallet :size="18" aria-hidden="true" />
        Iniciar caja
      </button>
      <AppBanner v-if="cashStore.error" type="error">{{ cashStore.error }}</AppBanner>
    </div>

    <!-- ===== CON SESIÓN: arqueo completo ===== -->
    <template v-else>
      <div class="cash-body">
        <!-- ======== CARD 1: RESUMEN DE LA SESION (L570-647) ======== -->
        <section class="cash-card" data-testid="cash-info-card">
          <div class="cash-section-title">
            <span class="cash-section-icon"><ReceiptText :size="18" aria-hidden="true" /></span>
            <div class="cash-section-text">
              <h2>Resumen de la Sesion</h2>
              <p>Verifica ventas y ajustes antes del arqueo.</p>
            </div>
          </div>
          <hr class="cash-divider" />

          <div class="cash-summary-row"><span>Usuario:</span><span>{{ session.displayName ?? 'N/A' }}</span></div>
          <div class="cash-summary-row"><span>Sucursal / piso:</span><span>{{ sessionData?.sucursalId ?? POS_SUCURSAL_ID }} / {{ sessionData?.plantId ?? POS_PLANT_ID }}</span></div>
          <div class="cash-summary-row"><span>Inicio de sesión:</span><span>{{ formatSessionStart(sessionData?.startTime) }}</span></div>

          <div class="cash-gap" />
          <div class="cash-summary-row cash-summary-row--bold"><span>1. Total Ventas:</span><span>{{ formatMoney(totalSales) }}</span></div>
          <div class="cash-summary-row cash-summary-row--bold"><span>2. Fondo de Caja:</span><span>{{ formatMoney(startingAmount) }}</span></div>
          <hr class="cash-divider" />

          <!-- Ajustes (L603-607) -->
          <div class="cash-section-title">
            <span class="cash-section-icon"><SlidersHorizontal :size="18" aria-hidden="true" /></span>
            <div class="cash-section-text">
              <h2>Ajustes</h2>
              <p>Movimientos que suman o restan efectivo real.</p>
            </div>
          </div>

          <div class="cash-gap-sm" />

          <!-- (+) DIDI Efectivo (L609-618) -->
          <div class="cash-money-row">
            <div class="cash-money-label">
              <span class="cash-money-name">(+) DIDI Efectivo</span>
              <span class="cash-money-helper">
                {{ systemDidiCash > 0
                  ? `Detectado en sistema: ${formatMoney(systemDidiCash)} (ajusta solo si falta).`
                  : 'Solo lo cobrado en efectivo por DIDI.' }}
              </span>
              <span v-if="showDidiCashWarning" class="cash-money-warning">
                Aviso: este monto ya esta detectado por el sistema. Editalo solo si falta o hay ajuste real.
              </span>
            </div>
            <input
              v-model="didiCashText"
              type="text"
              inputmode="decimal"
              class="cash-money-input"
              placeholder="0.00"
              data-testid="didi-cash-input"
            />
          </div>

          <!-- (-) Cancelaciones por sistema (L619-620) -->
          <div class="cash-summary-row"><span>(-) Cancelaciones por sistema:</span><span>{{ formatMoney(canceledTotal) }}</span></div>

          <!-- (-) Gastos (L621-625) -->
          <div class="cash-money-row">
            <div class="cash-money-label">
              <span class="cash-money-name">(-) Gastos</span>
              <span class="cash-money-helper">Salidas de caja (proveedor, insumos, etc.).</span>
            </div>
            <input
              v-model="expensesText"
              type="text"
              inputmode="decimal"
              class="cash-money-input"
              placeholder="0.00"
              data-testid="expenses-input"
            />
          </div>

          <div class="cash-gap-sm" />

          <!-- Terminales de tarjeta (L815-911) -->
          <div class="cash-terminals">
            <div class="cash-summary-row">
              <span>Tarjeta esperada en terminales:</span>
              <span class="cash-summary-row--bold-value">{{ formatMoney(cardTotalWithoutDidiUber) }}</span>
            </div>
            <p class="cash-money-helper cash-terminals-hint">
              Captura el total real de cada terminal. La tarjeta DIDI/UBER se muestra aparte.
            </p>
            <div v-for="(terminal, index) in cardTerminals" :key="index" class="cash-terminal-row">
              <input
                v-model="terminal.name"
                type="text"
                class="cash-terminal-name"
                placeholder="Nombre de terminal (Ej: BBVA, Clip)"
                :aria-label="`Nombre de terminal ${index + 1}`"
              />
              <input
                v-model="terminal.amountText"
                type="text"
                inputmode="decimal"
                class="cash-terminal-amount"
                placeholder="0.00"
                :aria-label="`Monto de terminal ${index + 1}`"
              />
              <button
                type="button"
                class="cash-terminal-remove"
                :disabled="cardTerminals.length <= 1"
                :aria-label="`Quitar terminal ${index + 1}`"
                @click="cardTerminals.splice(index, 1)"
              >
                <X :size="16" aria-hidden="true" />
              </button>
            </div>
            <div class="cash-terminal-add">
              <button
                type="button"
                class="cash-add-terminal"
                @click="cardTerminals.push({ name: '', amountText: '' })"
              >
                <Plus :size="16" aria-hidden="true" />
                Agregar terminal
              </button>
            </div>
            <div class="cash-summary-row"><span>Total capturado en terminales:</span><span>{{ formatMoney(cardTerminalsCountedTotal) }}</span></div>
            <div
              class="cash-summary-row cash-summary-row--bold"
              :style="{ color: Math.abs(cardTerminalsDifference) > 0.01 ? '#ffb74d' : '#66bb6a' }"
            >
              <span>Diferencia tarjeta (capturado - sistema):</span>
              <span>{{ formatDifference(cardTerminalsDifference) }}</span>
            </div>
          </div>

          <!-- Transferencias registradas (L628-636) -->
          <div class="cash-money-row">
            <div class="cash-money-label">
              <span class="cash-money-name">Transferencias registradas</span>
              <span class="cash-money-helper">
                Sistema: {{ formatMoney(transferTotal) }} · Diferencia: {{ formatDifference(transferDifference) }}
              </span>
              <span v-if="Math.abs(transferDifference) > 0.01" class="cash-money-warning">
                El monto capturado no coincide con las transferencias del sistema.
              </span>
            </div>
            <input
              v-model="transferCountedText"
              type="text"
              inputmode="decimal"
              class="cash-money-input"
              placeholder="0.00"
              data-testid="transfer-input"
            />
          </div>

          <!-- (-) DIDI/UBER tarjeta (L637-638) -->
          <div class="cash-summary-row"><span>(-) DIDI/UBER tarjeta:</span><span>{{ formatMoney(didiUberCardTotal) }}</span></div>

          <hr class="cash-divider" />
          <!-- (=) Total efectivo (L640-642): fontSize grande bold -->
          <div class="cash-summary-row cash-summary-row--total">
            <span>(=) Total efectivo:</span><span>{{ formatMoney(totalCash) }}</span>
          </div>
        </section>

        <!-- ======== CARD 2: DESGLOSE DE EFECTIVO (L649-739) ======== -->
        <section class="cash-card" data-testid="cash-denominations-card">
          <div class="cash-section-title">
            <span class="cash-section-icon"><Wallet :size="18" aria-hidden="true" /></span>
            <div class="cash-section-text">
              <h2>Desglose de Efectivo</h2>
              <p>Cuenta el efectivo fisico por denominacion.</p>
            </div>
          </div>

          <div class="cash-gap" />

          <div class="cash-denom-table">
            <div class="cash-denom-head">
              <span class="cash-denom-concepto">Concepto</span>
              <span class="cash-denom-cantidad">Cantidad</span>
              <span class="cash-denom-valor">Valor</span>
            </div>

            <div v-for="row in denominations" :key="row.label" class="cash-denom-row">
              <span class="cash-denom-concepto">{{ row.label }}</span>

              <!-- CANTIDAD (todos los rows; prefix USD para Dlls singleInput) -->
              <span class="cash-denom-cantidad">
                <input
                  v-model="row.qtyText"
                  type="text"
                  inputmode="decimal"
                  class="cash-denom-input"
                  :placeholder="row.singleInput
                    ? (row.isUsd ? 'Monto USD' : 'Monto total')
                    : row.isEditableValue ? 'Monto' : 'Cant.'"
                  :aria-label="`Cantidad ${row.label}`"
                  :data-testid="`denom-qty-${row.label}`"
                />
              </span>

              <!-- VALOR -->
              <span class="cash-denom-valor">
                <template v-if="row.unitValue != null || row.singleInput">
                  <!-- Solo lectura (box réplica _valueBoxDecoration L75-81) -->
                  <span class="cash-denom-value-box">{{ formatMoney(denominationRowTotal(row)) }}</span>
                </template>
                <template v-else>
                  <input
                    v-model="row.valueText"
                    type="text"
                    inputmode="decimal"
                    class="cash-denom-input"
                    :placeholder="row.isUsd ? 'Monto USD' : 'Monto MXN'"
                    :aria-label="`Valor ${row.label}`"
                    :data-testid="`denom-value-${row.label}`"
                  />
                </template>
              </span>
            </div>
          </div>

          <hr class="cash-divider" />

          <p v-if="dollarRate > 0" class="cash-rate">
            Tasa USD (configuracion): {{ dollarRate.toFixed(2) }} MXN
          </p>
          <p v-else class="cash-rate cash-rate--missing">
            Tasa USD (configuracion): sin configurar (Dlls cuenta como 0). Configúrala en Ajustes.
          </p>

          <div class="cash-gap-sm" />
          <div class="cash-summary-row cash-summary-row--bold"><span>Total contado:</span><span>{{ formatMoney(denominationsTotal) }}</span></div>
          <div class="cash-summary-row cash-summary-row--total" :style="{ color: differenceColor }">
            <span>(=) Diferencia:</span><span>{{ formatMoney(difference) }}</span>
          </div>
          <p v-if="difference !== 0" class="cash-diff-label" :style="{ color: differenceColor }">
            {{ difference < 0 ? 'Faltante' : 'Sobrante' }}
          </p>
        </section>

        <!-- ======== BOTÓN CERRAR (L535-556): alto 52, radio 12, 17px w600 ======== -->
        <button
          type="button"
          class="cash-close-btn"
          data-testid="cash-close"
          :disabled="isButtonDisabled"
          @click="openConfirmClose"
        >
          Cerrar Caja y Sesión
        </button>
      </div>

      <!-- ======== BARRA INFERIOR FIJA (L125-168) ======== -->
      <footer class="cash-bottom-bar" data-testid="cash-bottom-bar">
        <div class="cash-bottom-left">
          <span class="cash-bottom-label">Total efectivo esperado</span>
          <span class="cash-bottom-value">{{ formatMoney(totalCash) }}</span>
        </div>
        <div class="cash-bottom-right">
          <span class="cash-bottom-label">Diferencia</span>
          <span class="cash-bottom-value" :style="{ color: differenceColor }">{{ formatMoney(difference) }}</span>
        </div>
      </footer>
    </template>

    <!-- ==================== DIÁLOGOS ==================== -->

    <!-- Iniciar caja (réplica module_selection_screen.dart L113-168) -->
    <AppModal
      v-if="dialog.kind === 'start-session'"
      title="Iniciar caja - Piso #1"
      :width="420"
      @close="dialog = { kind: 'none' }"
    >
      <div class="dlg">
        <label class="dlg-label" for="start-amount">Monto inicial</label>
        <div class="dlg-input-wrap">
          <span class="dlg-prefix">MXN </span>
          <input
            id="start-amount"
            v-model="startAmountText"
            type="text"
            inputmode="decimal"
            class="dlg-input"
            placeholder="Ej: 500.00"
            data-testid="start-amount"
            @keydown.enter="confirmStartSession"
          />
        </div>
        <AppBanner v-if="startError" type="error">{{ startError }}</AppBanner>
      </div>
      <template #footer>
        <button type="button" class="cash-dlg-btn cash-dlg-btn--ghost" @click="dialog = { kind: 'none' }">
          Cancelar
        </button>
        <button type="button" class="cash-dlg-btn cash-dlg-btn--primary" data-testid="confirm-start" @click="confirmStartSession">
          Iniciar
        </button>
      </template>
    </AppModal>

    <!-- Sesión de larga duración (réplica L303-324) -->
    <AppModal
      v-if="dialog.kind === 'long-session'"
      title="⚠️ Sesión de Larga Duración"
      :width="420"
      @close="dialog = { kind: 'none' }"
    >
      <div class="dlg dlg--warning">
        <TriangleAlert :size="48" class="dlg-warning-icon" aria-hidden="true" />
        <p class="dlg-message">{{ (dialog as { kind: 'long-session'; message: string }).message }}</p>
      </div>
      <template #footer>
        <button type="button" class="cash-dlg-btn cash-dlg-btn--primary" @click="dialog = { kind: 'none' }">
          Entendido
        </button>
      </template>
    </AppModal>

    <!-- Confirmar Cierre (réplica L1005-1148) -->
    <AppModal
      v-if="dialog.kind === 'confirm-close'"
      title="Confirmar Cierre"
      :width="460"
      @close="dialog = { kind: 'none' }"
    >
      <p class="dlg-message" data-testid="confirm-close-message">{{ confirmCloseMessage }}</p>
      <template #footer>
        <button type="button" class="cash-dlg-btn cash-dlg-btn--ghost" @click="dialog = { kind: 'none' }">
          Cancelar
        </button>
        <button type="button" class="cash-dlg-btn cash-dlg-btn--primary" data-testid="confirm-close" @click="confirmClose">
          Continuar y Cerrar
        </button>
      </template>
    </AppModal>

    <!-- Cerrando sesión... (réplica L1066-1084) -->
    <AppModal
      v-if="dialog.kind === 'closing'"
      title="Cerrando"
      :width="320"
      :dismissible="false"
      @close="() => {}"
    >
      <div class="dlg dlg--loading">
        <AppSpinner :size="24" tone="primary" />
        <span>Cerrando sesión...</span>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.cash {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg); /* grey[900] scaffold */
}

.cash-appbar {
  padding: 14px 16px;
  background: var(--bg-surface); /* grey[850] */
}

.cash-appbar-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
}

/* Estados centrados (loading / sin acceso / sin sesión) */
.cash-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px;
}

.cash-state p {
  margin: 0;
  color: var(--text);
  font-size: 16px;
}

/* Botón Iniciar caja (ElevatedButton del diálogo Flutter) */
.cash-start-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  background: var(--primary);
  color: var(--on-primary);
  border: none;
  border-radius: 12px;
  font-family: var(--font);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
}

.cash-start-btn:hover {
  background: var(--primary-hover);
}

/* ===== CUERPO ===== */
.cash-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 18px; /* _cardPadding */
  padding-bottom: 102px; /* espacio para la barra fija (18+84 del Flutter L528) */
  overflow-y: auto;
}

/* Card gris[850] radius 12 elevation 2 (cardTheme de main.dart) */
.cash-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  padding: 18px; /* _cardPadding */
  box-shadow: var(--shadow);
}

/* SectionTitle (L83-123): icono 28 chip primario alpha .14 + título bold */
.cash-section-title {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;
}

.cash-section-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 8px;
  background: rgba(255, 87, 34, 0.14);
  color: var(--primary);
}

.cash-section-text h2 {
  margin: 0;
  font-size: 1.25rem; /* titleLarge */
  font-weight: 700;
  color: var(--text);
}

.cash-section-text p {
  margin: 2px 0 0;
  font-size: 0.8rem; /* bodySmall */
  color: var(--text-muted);
}

.cash-divider {
  border: none;
  border-top: 1px solid var(--border-soft);
  margin: 12px 0; /* Divider height 24 ≈ margen simétrico */
}

.cash-gap {
  height: 16px;
}

.cash-gap-sm {
  height: 8px;
}

/* SummaryRow (L741-761): label izquierda, valor derecha */
.cash-summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
  color: var(--text);
  font-size: 1rem; /* bodyLarge */
}

.cash-summary-row--bold {
  font-weight: 700;
}

.cash-summary-row--bold-value {
  font-weight: 700;
}

/* (=) Total efectivo / (=) Diferencia: titleLarge bold */
.cash-summary-row--total {
  font-size: 1.25rem;
  font-weight: 700;
}

/* ===== MoneyInputRow (L763-813): label izq + input 160x44 der ===== */
.cash-money-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
}

.cash-money-label {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cash-money-name {
  color: var(--text);
  font-weight: 600;
}

.cash-money-helper {
  color: var(--text-muted);
  font-size: 0.8rem; /* bodySmall */
}

.cash-money-warning {
  margin-top: 4px;
  color: #ffb74d; /* Colors.orange.shade300 (L790) */
  font-size: 0.8rem;
}

/* Input monetario (réplica _inputDecoration L52-73):
   fill white .06, border white .12, focus primario 1.4, radius 10 */
.cash-money-input,
.cash-denom-input,
.cash-terminal-name,
.cash-terminal-amount {
  width: 160px;
  height: 44px; /* _inputHeight */
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  text-align: right; /* TextAlign.end */
  outline: none;
  transition: border-color 0.15s ease;
}

.cash-money-input::placeholder,
.cash-denom-input::placeholder,
.cash-terminal-name::placeholder,
.cash-terminal-amount::placeholder {
  color: var(--text-faint);
}

.cash-money-input:focus,
.cash-denom-input:focus,
.cash-terminal-name:focus,
.cash-terminal-amount:focus {
  border-color: var(--primary);
  border-width: 1.4px;
}

/* ===== Terminales de tarjeta (L815-911) ===== */
.cash-terminals {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cash-terminals-hint {
  display: block;
}

.cash-terminal-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.cash-terminal-name {
  flex: 1;
  width: auto;
  text-align: left;
}

.cash-terminal-amount {
  width: 130px; /* L855-857 */
  flex: none;
}

.cash-terminal-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--text-muted);
  cursor: pointer;
}

.cash-terminal-remove:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.cash-terminal-remove:hover:not(:disabled) {
  color: var(--error);
}

.cash-terminal-add {
  display: flex;
  justify-content: flex-end;
}

.cash-add-terminal {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--primary);
  font-family: var(--font);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}

.cash-add-terminal:hover {
  background: rgba(255, 87, 34, 0.1);
}

/* ===== Desglose de efectivo (L649-739): tabla max 720 ===== */
.cash-denom-table {
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
}

.cash-denom-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  color: var(--text);
  font-weight: 700;
}

.cash-denom-concepto {
  flex: 1;
}

.cash-denom-cantidad {
  width: 110px; /* _qtyWidth */
  flex: none;
  text-align: end;
}

.cash-denom-valor {
  width: 140px; /* _valueWidth */
  flex: none;
  text-align: end;
}

.cash-denom-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  color: var(--text);
}

.cash-denom-row .cash-denom-input {
  width: 100%;
}

/* Box de valor read-only (réplica _valueBoxDecoration L75-81) */
.cash-denom-value-box {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  width: 100%;
  height: 44px;
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  font-size: 15px;
}

.cash-rate {
  margin: 0 0 4px;
  color: var(--text-muted);
  font-size: 0.8rem;
}

.cash-rate--missing {
  color: var(--warning);
}

/* Faltante/Sobrante (L722-734): red.shade700 / green.shade800 bold */
.cash-diff-label {
  margin: 8px 0 0;
  font-weight: 700;
}

/* ===== Botón Cerrar Caja y Sesión (L535-556) ===== */
.cash-close-btn {
  min-height: 52px;
  padding: 16px 0;
  background: var(--primary);
  color: var(--on-primary);
  border: none;
  border-radius: 12px;
  font-family: var(--font);
  font-size: 17px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, opacity 0.15s ease;
}

.cash-close-btn:hover:not(:disabled) {
  background: var(--primary-hover);
}

.cash-close-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ===== Barra inferior fija (L125-168) ===== */
.cash-bottom-bar {
  position: fixed;
  bottom: 0;
  left: 80px; /* ancho del nav rail (el Flutter la ponia dentro del Scaffold) */
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 18px;
  background: var(--bg-surface); /* colorScheme.surface */
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  z-index: 10;
}

.cash-bottom-left,
.cash-bottom-right {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cash-bottom-right {
  align-items: flex-end;
}

.cash-bottom-label {
  color: var(--text);
  font-size: 0.9rem;
}

.cash-bottom-value {
  color: var(--text);
  font-size: 18px; /* L144-145 */
  font-weight: 700;
}

/* ===== Diálogos ===== */
.dlg {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dlg-label {
  color: var(--text-muted);
  font-size: 0.9rem;
}

.dlg-input-wrap {
  position: relative;
}

.dlg-prefix {
  position: absolute;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

.dlg-input {
  width: 100%;
  height: 44px;
  padding: 0 12px 0 46px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  outline: none;
}

.dlg-input:focus {
  border-color: var(--primary);
  border-width: 1.4px;
}

.dlg--warning {
  align-items: center;
  text-align: center;
}

.dlg-warning-icon {
  color: var(--warning);
}

.dlg-message {
  margin: 0;
  color: var(--text);
  white-space: pre-line;
  text-align: left;
}

.dlg--warning .dlg-message {
  text-align: center;
}

.dlg--loading {
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text);
}

.cash-dlg-btn {
  padding: 10px 20px;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
}

.cash-dlg-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.cash-dlg-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.cash-dlg-btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-muted);
}

.cash-dlg-btn--ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
}

/* Responsive: tabla de denominaciones colapsa a columna en móvil */
@media (max-width: 640px) {
  .cash-money-row {
    flex-direction: column;
  }

  .cash-money-input {
    width: 100%;
  }

  .cash-denom-head {
    display: none;
  }

  .cash-denom-row {
    flex-wrap: wrap;
  }

  .cash-denom-cantidad,
  .cash-denom-valor {
    flex: 1 1 45%;
    width: auto;
  }

  .cash-bottom-bar {
    left: 0; /* móvil: el rail está oculto/colapsado */
  }
}
</style>
