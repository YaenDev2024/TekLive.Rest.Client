<script setup lang="ts">
/**
 * SettingsView · pantalla AJUSTES del rail (Fase 3 ronda 2 + ronda cash +
 * ronda Piso 1).
 *
 * Réplica exacta de lib/screens/admin/settings.dart (SettingsAdming):
 * - Scaffold bg #212121, AppBar "Ajustes" con bg del scaffold.
 * - ListView con ListTiles:
 *   1. Icons.add_box_outlined  → "Crear Nuevo Producto"
 *      subtitle "Añade productos con opciones dinámicas" (placeholder Fase 6).
 *   2. Icons.print_outlined    → "Impresora de Tickets"
 *      subtitle "Busca y configura tu impresora de red"
 *      → /ajustes/impresoras (ronda Piso 1: PrintersView réplica
 *        printer_settings_screen.dart).
 *   3. attach_money → "Precio del dólar" — modal con la tasa actual
 *      (fetchDollarRate) y guardado con updateDollarRate.
 *   4. (ronda Piso 1) ReceiptText → "Configuración del ticket" — modal con
 *      footer + 5 switches (flags réplica ticket_service.dart): cocina
 *      modificadores/notas, cliente pagados/gratuitos/notas → PUT
 *      api/rest/ticket-config (solo admin/manager; 403 operator con message).
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { DollarSign, PackagePlus, Printer, ReceiptText } from 'lucide-vue-next'
import { ApiError } from '../../api/client'
import { useCashStore } from '../../stores/cash'
import { useAdminTicketConfigStore } from '../../stores/adminTicketConfig'
import { useToastStore } from '../../stores/toast'
import AppModal from '../../components/pos/AppModal.vue'
import { AppBanner, AppSpinner } from '../../components/ui'

const router = useRouter()
const toast = useToastStore()
const cashStore = useCashStore()
const ticketConfigStore = useAdminTicketConfigStore()

function notAvailable(): void {
  toast.info('Disponible en Fase 3c/3d')
}

function openPrinters(): void {
  void router.push('/ajustes/impresoras')
}

// --- Modal Precio del dólar (ronda cash) -------------------------------------

const showDollarModal = ref(false)
const rateText = ref('')
const savingRate = ref(false)
const rateError = ref<string | null>(null)

async function openDollarModal(): Promise<void> {
  rateError.value = null
  showDollarModal.value = true
  // Tasa actual (fetch barato; null = sin configurar → campo vacío).
  await cashStore.fetchDollarRate()
  rateText.value = cashStore.rate > 0 ? cashStore.rate.toFixed(2) : ''
}

async function saveDollarRate(): Promise<void> {
  rateError.value = null
  const normalized = rateText.value.replaceAll(',', '.').trim()
  const rate = Number.parseFloat(normalized)
  if (!Number.isFinite(rate) || rate <= 0) {
    rateError.value = 'Captura una tasa válida (mayor a 0).'
    return
  }
  savingRate.value = true
  try {
    await cashStore.updateDollarRate(rate)
    toast.success(`Tasa del dólar actualizada: ${rate.toFixed(2)} MXN`)
    showDollarModal.value = false
  } catch (err) {
    // Roles: el backend rechaza si no es cajero/admin (403 con message).
    rateError.value = err instanceof ApiError && err.status !== 0
      ? err.message
      : 'No se pudo guardar la tasa. Verifica tu conexión.'
  } finally {
    savingRate.value = false
  }
}

onMounted(() => {
  // Tasa para el display del tile (best-effort).
  if (cashStore.dollarRate == null) void cashStore.fetchDollarRate()
})

// --- Modal Configuración del ticket (ronda Piso 1) ---------------------------
// Labels réplica de los switches del ticket-config (CrazyWings
// admin_ticket_config): cocina modificadores/notas + cliente pagados/
// gratuitos/notas. footer ≤200 con contador (contrato backend).

const showTicketModal = ref(false)
const ticketFooter = ref('')
const ticketKitchenModifiers = ref(true)
const ticketKitchenNotes = ref(true)
const ticketClientPaid = ref(true)
const ticketClientFree = ref(false)
const ticketClientNotes = ref(true)
const ticketLoading = ref(false)

const FOOTER_MAX = 200

async function openTicketModal(): Promise<void> {
  showTicketModal.value = true
  ticketLoading.value = true
  // Carga con cache (force solo la primera vez; si falla → defaults y el
  // modal muestra los switches default sin bloquear).
  await ticketConfigStore.load()
  const cfg = ticketConfigStore.effectiveConfig
  ticketFooter.value = cfg.footer ?? ''
  ticketKitchenModifiers.value = cfg.showKitchenModifiers
  ticketKitchenNotes.value = cfg.showKitchenNotes
  ticketClientPaid.value = cfg.showClientPaidModifiers
  ticketClientFree.value = cfg.showClientFreeModifiers
  ticketClientNotes.value = cfg.showClientNotes
  ticketLoading.value = false
}

async function saveTicketConfig(): Promise<void> {
  try {
    await ticketConfigStore.save({
      // Vacío → null (backend trata null = default Flutter en los tickets).
      footer: ticketFooter.value.trim() === '' ? null : ticketFooter.value.trim(),
      showKitchenModifiers: ticketKitchenModifiers.value,
      showKitchenNotes: ticketKitchenNotes.value,
      showClientPaidModifiers: ticketClientPaid.value,
      showClientFreeModifiers: ticketClientFree.value,
      showClientNotes: ticketClientNotes.value,
    })
    toast.success('Configuración del ticket guardada.')
    showTicketModal.value = false
  } catch (err) {
    // 403 operator (solo admin/manager guardan) u otro error del backend.
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? err.message
        : 'No se pudo guardar la configuración. Verifica tu conexión.',
    )
  }
}
</script>

<template>
  <div class="set">
    <!-- AppBar "Ajustes" (bg del scaffold, réplica settings.dart L11-14) -->
    <header class="set-appbar" data-testid="settings-appbar">
      <h1 class="set-appbar-title">Ajustes</h1>
    </header>

    <!-- ListView con ListTiles (L15-42) -->
    <ul class="set-list" data-testid="settings-list">
      <li>
        <button type="button" class="set-tile" data-testid="settings-new-product" @click="notAvailable">
          <PackagePlus :size="24" class="set-tile-icon" aria-hidden="true" />
          <span class="set-tile-text">
            <span class="set-tile-title">Crear Nuevo Producto</span>
            <span class="set-tile-subtitle">Añade productos con opciones dinámicas</span>
          </span>
        </button>
      </li>
      <li>
        <button type="button" class="set-tile" data-testid="settings-printer" @click="openPrinters">
          <Printer :size="24" class="set-tile-icon" aria-hidden="true" />
          <span class="set-tile-text">
            <span class="set-tile-title">Impresora de Tickets</span>
            <span class="set-tile-subtitle">Busca y configura tu impresora de red</span>
          </span>
        </button>
      </li>
      <li>
        <!-- Ronda Piso 1: configuración del ticket (footer + flags) -->
        <button type="button" class="set-tile" data-testid="settings-ticket-config" @click="openTicketModal">
          <ReceiptText :size="24" class="set-tile-icon" aria-hidden="true" />
          <span class="set-tile-text">
            <span class="set-tile-title">Configuración del ticket</span>
            <span class="set-tile-subtitle">Footer y detalles de cocina/cliente</span>
          </span>
        </button>
      </li>
      <li>
        <!-- Ronda cash: tile Precio del dólar (estilo idéntico a los tiles) -->
        <button type="button" class="set-tile" data-testid="settings-dollar" @click="openDollarModal">
          <DollarSign :size="24" class="set-tile-icon" aria-hidden="true" />
          <span class="set-tile-text">
            <span class="set-tile-title">Precio del dólar</span>
            <span class="set-tile-subtitle">
              {{ cashStore.rate > 0 ? `Tasa actual: ${cashStore.rate.toFixed(2)} MXN` : 'Tasa para cobros en dólares' }}
            </span>
          </span>
        </button>
      </li>
    </ul>

    <!-- Modal Precio del dólar -->
    <AppModal
      v-if="showDollarModal"
      title="Precio del dólar"
      :width="400"
      @close="showDollarModal = false"
    >
      <div class="dlr">
        <div v-if="cashStore.dollarRate == null" class="dlr-loading">
          <AppSpinner :size="20" tone="primary" />
        </div>
        <template v-else>
          <p class="dlr-current">
            {{ cashStore.rate > 0
              ? `Tasa actual: ${cashStore.rate.toFixed(2)} MXN por USD`
              : 'Sin tasa configurada (los cobros en dólares están bloqueados).' }}
          </p>
          <label class="dlr-label" for="dollar-rate-input">Nueva tasa (MXN por USD)</label>
          <input
            id="dollar-rate-input"
            v-model="rateText"
            type="text"
            inputmode="decimal"
            class="dlr-input"
            placeholder="Ej: 20.50"
            data-testid="dollar-rate-input"
            @keydown.enter="saveDollarRate"
          />
          <AppBanner v-if="rateError" type="error">{{ rateError }}</AppBanner>
        </template>
      </div>
      <template #footer>
        <button
          type="button"
          class="dlr-btn dlr-btn--ghost"
          :disabled="savingRate"
          @click="showDollarModal = false"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="dlr-btn dlr-btn--primary"
          data-testid="dollar-rate-save"
          :disabled="savingRate || cashStore.dollarRate == null"
          @click="saveDollarRate"
        >
          {{ savingRate ? 'Guardando…' : 'Guardar' }}
        </button>
      </template>
    </AppModal>

    <!-- Modal Configuración del ticket (ronda Piso 1) -->
    <AppModal
      v-if="showTicketModal"
      title="Configuración del ticket"
      :width="440"
      @close="showTicketModal = false"
    >
      <div class="tkc">
        <div v-if="ticketLoading" class="dlr-loading">
          <AppSpinner :size="20" tone="primary" />
        </div>
        <template v-else>
          <label class="tkc-label" for="ticket-footer-input">Mensaje al pie del ticket</label>
          <textarea
            id="ticket-footer-input"
            v-model="ticketFooter"
            class="tkc-textarea"
            rows="2"
            :maxlength="200"
            placeholder="¡GRACIAS POR SU COMPRA! Vuelva pronto"
            data-testid="ticket-config-footer"
          />
          <span class="tkc-counter" data-testid="ticket-config-counter">
            {{ ticketFooter.length }}/{{ FOOTER_MAX }}
          </span>

          <p class="tkc-group">Cocina</p>
          <label class="tkc-switch" data-testid="ticket-config-kitchen-modifiers">
            <input v-model="ticketKitchenModifiers" type="checkbox" />
            <span>Mostrar modificadores (extras/complementos)</span>
          </label>
          <label class="tkc-switch" data-testid="ticket-config-kitchen-notes">
            <input v-model="ticketKitchenNotes" type="checkbox" />
            <span>Mostrar notas</span>
          </label>

          <p class="tkc-group">Cliente</p>
          <label class="tkc-switch" data-testid="ticket-config-client-paid">
            <input v-model="ticketClientPaid" type="checkbox" />
            <span>Mostrar modificadores pagados</span>
          </label>
          <label class="tkc-switch" data-testid="ticket-config-client-free">
            <input v-model="ticketClientFree" type="checkbox" />
            <span>Mostrar modificadores gratuitos</span>
          </label>
          <label class="tkc-switch" data-testid="ticket-config-client-notes">
            <input v-model="ticketClientNotes" type="checkbox" />
            <span>Mostrar notas</span>
          </label>
        </template>
      </div>
      <template #footer>
        <button
          type="button"
          class="dlr-btn dlr-btn--ghost"
          :disabled="ticketConfigStore.saving"
          @click="showTicketModal = false"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="dlr-btn dlr-btn--primary"
          data-testid="ticket-config-save"
          :disabled="ticketConfigStore.saving || ticketLoading"
          @click="saveTicketConfig"
        >
          {{ ticketConfigStore.saving ? 'Guardando…' : 'Guardar' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.set {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg); /* #212121 */
}

/* AppBar con bg del scaffold (Theme.of(context).scaffoldBackgroundColor) */
.set-appbar {
  padding: 14px 16px;
  background: var(--bg);
}

.set-appbar-title {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
  color: var(--text);
}

/* ListTile M3: leading 24 + title/subtitle, tap completo */
.set-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.set-tile {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 16px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: var(--font);
  transition: background 0.15s ease;
}

.set-tile:hover {
  background: var(--card-overlay);
}

.set-tile-icon {
  color: var(--text);
  flex: none;
}

.set-tile-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.set-tile-title {
  color: var(--text);
  font-size: 16px;
}

.set-tile-subtitle {
  color: var(--text-muted);
  font-size: 14px;
}

/* ===== Modal Precio del dólar ===== */
.dlr {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dlr-loading {
  display: flex;
  justify-content: center;
  padding: 12px 0;
}

.dlr-current {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
}

.dlr-label {
  color: var(--text);
  font-size: 0.9rem;
}

.dlr-input {
  width: 100%;
  height: 44px;
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  text-align: right;
  outline: none;
  transition: border-color 0.15s ease;
}

.dlr-input:focus {
  border-color: var(--primary);
  border-width: 1.4px;
}

.dlr-btn {
  padding: 10px 20px;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
}

.dlr-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.dlr-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.dlr-btn--primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.dlr-btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-muted);
}

.dlr-btn--ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
}

/* ===== Modal Configuración del ticket (ronda Piso 1) ===== */
.tkc {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tkc-label {
  color: var(--text);
  font-size: 0.9rem;
}

.tkc-textarea {
  width: 100%;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  resize: vertical;
  outline: none;
  transition: border-color 0.15s ease;
}

.tkc-textarea:focus {
  border-color: var(--primary);
  border-width: 1.4px;
}

.tkc-counter {
  align-self: flex-end;
  color: var(--text-muted);
  font-size: 0.75rem;
  margin-top: -6px;
}

.tkc-group {
  margin: 8px 0 0;
  color: var(--primary);
  font-size: 0.85rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.tkc-switch {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text);
  font-size: 0.95rem;
  cursor: pointer;
}

.tkc-switch input {
  width: 18px;
  height: 18px;
  accent-color: var(--primary);
  flex: none;
}
</style>
