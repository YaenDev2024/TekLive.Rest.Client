<script setup lang="ts">
/**
 * SettingsView · pantalla AJUSTES del rail (Fase 3 ronda 2 + ronda cash).
 *
 * Réplica exacta de lib/screens/admin/settings.dart (SettingsAdming):
 * - Scaffold bg #212121, AppBar "Ajustes" con bg del scaffold.
 * - ListView con ListTiles:
 *   1. Icons.add_box_outlined  → "Crear Nuevo Producto"
 *      subtitle "Añade productos con opciones dinámicas"
 *   2. Icons.print_outlined    → "Impresora de Tickets"
 *      subtitle "Busca y configura tu impresora de red"
 *   3. (ronda cash) attach_money → "Precio del dólar" — modal con la tasa
 *      actual (fetchDollarRate) y guardado con updateDollarRate. Visible para
 *      todos: el backend rechaza si el rol no es cajero/admin (message 403).
 * - Las pantallas destino 1/2 (CreateProductTemplateScreen /
 *   PrinterSettingsScreen) no existen en Rest aún (Fase 3c/3d) → toast.
 */
import { onMounted, ref } from 'vue'
import { DollarSign, PackagePlus, Printer } from 'lucide-vue-next'
import { ApiError } from '../../api/client'
import { useCashStore } from '../../stores/cash'
import { useToastStore } from '../../stores/toast'
import AppModal from '../../components/pos/AppModal.vue'
import { AppBanner, AppSpinner } from '../../components/ui'

const toast = useToastStore()
const cashStore = useCashStore()

function notAvailable(): void {
  toast.info('Disponible en Fase 3c/3d')
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
        <button type="button" class="set-tile" data-testid="settings-printer" @click="notAvailable">
          <Printer :size="24" class="set-tile-icon" aria-hidden="true" />
          <span class="set-tile-text">
            <span class="set-tile-title">Impresora de Tickets</span>
            <span class="set-tile-subtitle">Busca y configura tu impresora de red</span>
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
</style>
