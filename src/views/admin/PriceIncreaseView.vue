<script setup lang="ts">
/**
 * PriceIncreaseView · "Aumento de Precios" (Fase admin M2) — réplica de
 * lib/screens/admin/price_increase_config_screen.dart (CrazyWings, 388
 * líneas) con la estructura de ManageCategoriesView.vue: AppBar standalone
 * + ScopeSelector + cards + AppModal confirm + toasts + guard de rol.
 *
 * Estructura replicada del Flutter:
 * - AppBar (L165-167): back → admin-dashboard, título 'Aumento de Precios'.
 * - Sección 'Configuraciones activas' (L176-236): cards por config con
 *   CircleAvatar por alcance + '+N%' grande deepOrange (L218-225, sin
 *   decimales si es entero) + label de alcance (_scopeLabel L141-147) +
 *   papelera roja (L227-233). Vacío → card 'Sin configuraciones activas'
 *   (L190-202).
 * - Sección 'Agregar / reemplazar aumento' (L241-347): hint 'Si ya existe
 *   una regla para el mismo alcance se reemplazará.' (L250) + Alcance
 *   (dropdown L264-288 → ScopeSelector con AppSelect) + Porcentaje
 *   (L313-329, suffix '%', helper 'Ejemplo: 10 → todos los precios suben
 *   10%') + botón 'Aplicar aumento' (L334-343, aquí 'Guardar' — brief).
 * - Validaciones (L54-63): 'Ingresa un porcentaje válido entre 0 y 999' /
 *   'Selecciona un piso'. Save OK → limpia % + reset alcance GLOBAL +
 *   'Aumento configurado correctamente' + recarga (L75-79).
 * - Confirm eliminar (L90-109): título 'Eliminar configuración', texto
 *   '¿Estás seguro de quitar este aumento de precios?', botones
 *   Cancelar/Eliminar (rojo). OK → 'Configuración eliminada' + recarga.
 * - NOTA del brief (⚠️): el % NO se aplica aún al catálogo (solo se
 *   configura) — nota informativa discreta arriba para que el dueño no
 *   espere precios cambiados.
 *
 * Badge de alcance: misma rúbrica _describeScope de ManageCategoriesView
 * ('Piso #N' | 'Sucursal' | 'Global') + labels largos del _scopeLabel para
 * el subtítulo de la card.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CircleAlert, Globe, Layers, RefreshCw, Store, Trash2, TrendingUp } from 'lucide-vue-next'
import AppModal from '../../components/pos/AppModal.vue'
import ScopeSelector from '../../components/admin/ScopeSelector.vue'
import type { ScopeValue } from '../../components/admin/ScopeSelector.vue'
import { AppSpinner } from '../../components/ui'
import { session } from '../../services/auth'
import { useAdminPriceIncreaseStore } from '../../stores/adminPriceIncrease'
import { useToastStore } from '../../stores/toast'
import { ApiError } from '../../api/client'
import { POS_SUCURSAL_ID } from '../../stores/catalog'
import type { RestPriceIncreaseConfig } from '../../api/rest'

const router = useRouter()
const store = useAdminPriceIncreaseStore()
const toast = useToastStore()

// --- Guard de rol (copia EXACTA de ManageCategoriesView onMounted) -----------

onMounted(() => {
  const role = (session.role ?? '').toLowerCase()
  if (!['restadmin', 'superadmin', 'restmanager'].includes(role)) {
    void router.replace({ name: 'modules' })
    return
  }
  void store.loadConfigs()
})

// --- goBack: back arrow del AppBar → admin-dashboard --------------------------

async function goBack(): Promise<void> {
  if (window.history.state?.back != null) {
    await router.back()
    return
  }
  await router.replace({ name: 'admin-dashboard' })
}

// --- Form nueva config (L21-23 + L254-347): alcance + % + guardar -------------

const scope = ref<ScopeValue>({ scopeType: 'GLOBAL', plantId: null })
const percentage = ref('')
const saving = ref(false)

/** Porcentaje: solo dígitos y un punto (0-999 — sanitize réplica del brief). */
function sanitizePercentage(): void {
  const cleaned = percentage.value.replace(/[^\d.]/g, '')
  const dot = cleaned.indexOf('.')
  percentage.value =
    dot === -1
      ? cleaned
      : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)
}

function parsePercentage(value: string): number | null {
  const parsed = Number.parseFloat(value.replaceAll(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

/** Submit (réplica _saveConfig L54-88). */
async function submitSave(): Promise<void> {
  if (saving.value) return
  const pct = parsePercentage(percentage.value)
  if (pct == null || pct < 0 || pct > 999) {
    toast.warning('Ingresa un porcentaje válido entre 0 y 999') // L56-58
    return
  }
  if (scope.value.scopeType === 'PLANT' && scope.value.plantId == null) {
    toast.warning('Selecciona un piso') // L60-62
    return
  }
  saving.value = true
  try {
    await store.upsertConfig({
      scopeType: scope.value.scopeType,
      sucursalId: scope.value.scopeType === 'SUCURSAL' ? POS_SUCURSAL_ID : null, // L71
      plantId: scope.value.scopeType === 'PLANT' ? scope.value.plantId : null, // L72
      percentage: pct,
    })
    percentage.value = '' // L76: clear
    scope.value = { scopeType: 'GLOBAL', plantId: null } // L77: reset GLOBAL
    toast.success('Aumento configurado correctamente') // L78
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error guardando configuración: ${err.message}` // L84
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    saving.value = false
  }
}

// --- Confirm eliminar (L90-125) -------------------------------------------------

const confirmingConfig = ref<RestPriceIncreaseConfig | null>(null)
const deleting = ref(false)

function openConfirm(config: RestPriceIncreaseConfig): void {
  confirmingConfig.value = config
}

function closeConfirm(): void {
  if (deleting.value) return
  confirmingConfig.value = null
}

/** Eliminar tras confirm (réplica _deleteConfig L90-125). */
async function confirmDelete(): Promise<void> {
  if (confirmingConfig.value == null || deleting.value) return
  deleting.value = true
  try {
    await store.deleteConfig(confirmingConfig.value.id)
    toast.success('Configuración eliminada') // L115
    confirmingConfig.value = null
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error eliminando: ${err.message}` // L121
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    deleting.value = false
  }
}

// --- Helpers de card (réplica _scopeLabel/_scopeIcon L141-158) ------------------

/** Badge corto — rúbrica _describeScope de ManageCategoriesView. */
function scopeBadge(config: RestPriceIncreaseConfig): string {
  if (config.scopeType === 'PLANT') return config.plantId != null ? `Piso #${config.plantId}` : 'Piso'
  if (config.scopeType === 'SUCURSAL') return 'Sucursal'
  return 'Global'
}

/** Subtítulo largo — réplica _scopeLabel L141-147. */
function scopeLabel(config: RestPriceIncreaseConfig): string {
  if (config.scopeType === 'GLOBAL') return 'Global (todos los pisos y sucursales)'
  if (config.scopeType === 'SUCURSAL') return `Sucursal ${config.sucursalId ?? ''}`
  if (config.scopeType === 'PLANT') return `Piso ${config.plantId ?? ''}`
  return config.scopeType
}

/** Icono por alcance — réplica _scopeIcon (public/store/layers). */
function scopeIcon(config: RestPriceIncreaseConfig): typeof Globe {
  if (config.scopeType === 'SUCURSAL') return Store
  if (config.scopeType === 'PLANT') return Layers
  return Globe
}

/**
 * '+N%' grande (L218-225): sin decimales si es entero, 2 si no —
 * pct.truncateToDouble() == pct ? 0 : 2.
 */
function formatPercentage(pct: number): string {
  const decimals = Number.isInteger(pct) ? 0 : 2
  return `+${pct.toFixed(decimals)}%`
}

const hasConfigs = computed(() => store.configs.length > 0)
</script>

<template>
  <div class="pi-page">
    <!-- ===== AppBar réplica L165-167: back + título + refresh ===== -->
    <header class="pi-appbar">
      <button
        type="button"
        class="pi-icon-btn"
        title="Regresar a Administración"
        aria-label="Regresar a Administración"
        data-testid="pi-back"
        @click="goBack"
      >
        <svg
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m12 19-7-7 7-7" />
          <path d="M19 12H5" />
        </svg>
      </button>
      <h1 class="pi-appbar-title">Aumento de Precios</h1>
      <div class="pi-appbar-actions">
        <button
          type="button"
          class="pi-icon-btn"
          title="Recargar"
          aria-label="Recargar"
          data-testid="pi-refresh"
          @click="store.loadConfigs(true)"
        >
          <RefreshCw :size="20" aria-hidden="true" />
        </button>
      </div>
    </header>

    <main class="pi-body">
      <!-- ===== NOTA del brief: el % NO se aplica aún al catálogo ===== -->
      <div class="pi-note" data-testid="pi-note">
        El porcentaje se aplicará al catálogo en la próxima actualización
      </div>

      <!-- ===== Lista: spinner / error / vacío / cards ===== -->
      <div class="pi-list-wrap">
        <div v-if="store.loading" class="pi-state" data-testid="pi-loading">
          <AppSpinner :size="36" tone="primary" />
        </div>

        <div v-else-if="store.error != null" class="pi-state" data-testid="pi-error">
          <CircleAlert :size="64" class="pi-state-error-icon" aria-hidden="true" />
          <p class="pi-state-text">{{ store.error }}</p>
          <button
            type="button"
            class="pi-retry"
            data-testid="pi-retry"
            @click="store.loadConfigs(true)"
          >
            Reintentar
          </button>
        </div>

        <template v-else>
          <!-- 'Configuraciones activas' (L176-236) -->
          <h2 class="pi-section-title" data-testid="pi-section-active">Configuraciones activas</h2>
          <p class="pi-section-hint">
            Prioridad: Piso &gt; Sucursal &gt; Global.
          </p>

          <div v-if="!hasConfigs" class="pi-empty-card" data-testid="pi-empty">
            <CircleAlert :size="20" aria-hidden="true" />
            <span>Sin configuraciones activas</span>
          </div>

          <ul v-else class="pi-list" data-testid="pi-list">
            <li
              v-for="config in store.configs"
              :key="config.id"
              class="pi-card"
              :data-testid="`pi-item-${config.id}`"
            >
              <span class="pi-avatar">
                <component :is="scopeIcon(config)" :size="22" aria-hidden="true" />
              </span>
              <span class="pi-item-info">
                <span class="pi-item-pct" :data-testid="`pi-pct-${config.id}`">
                  {{ formatPercentage(config.percentage) }}
                </span>
                <span class="pi-item-scope">
                  <span class="pi-item-badge">{{ scopeBadge(config) }}</span>
                  {{ scopeLabel(config) }}
                </span>
              </span>
              <span class="pi-item-actions">
                <button
                  type="button"
                  class="pi-item-btn pi-item-btn--delete"
                  aria-label="Eliminar configuración"
                  :data-testid="`pi-delete-${config.id}`"
                  @click="openConfirm(config)"
                >
                  <Trash2 :size="20" aria-hidden="true" />
                </button>
              </span>
            </li>
          </ul>

          <!-- ===== 'Agregar / reemplazar aumento' (L241-347) ===== -->
          <h2 class="pi-section-title pi-section-title--form" data-testid="pi-section-form">
            Agregar / reemplazar aumento
          </h2>
          <p class="pi-section-hint">
            Si ya existe una regla para el mismo alcance se reemplazará.
          </p>

          <section class="pi-form-card" data-testid="pi-form">
            <div class="pi-field">
              <span class="pi-label">Alcance</span>
              <ScopeSelector v-model="scope" />
            </div>

            <div class="pi-field">
              <label class="pi-label" for="pi-percentage">Porcentaje de aumento</label>
              <div class="pi-input-wrap">
                <input
                  id="pi-percentage"
                  v-model="percentage"
                  type="text"
                  class="pi-input pi-input--suffix"
                  data-testid="pi-percentage"
                  inputmode="decimal"
                  autocomplete="off"
                  placeholder="Ej: 10"
                  @input="sanitizePercentage"
                  @keydown.enter.prevent="submitSave"
                />
                <span class="pi-suffix">%</span>
              </div>
              <p class="pi-helper">Ejemplo: 10 → todos los precios suben 10%</p>
            </div>

            <button
              type="button"
              class="pi-btn pi-btn--primary"
              data-testid="pi-save"
              :disabled="saving"
              @click="submitSave"
            >
              <TrendingUp :size="20" aria-hidden="true" />
              Guardar
            </button>
          </section>
        </template>
      </div>
    </main>

    <!-- ===== Confirm eliminar (L90-109): texto EXACTO del Flutter ===== -->
    <AppModal
      v-if="confirmingConfig != null"
      title="Eliminar configuración"
      :width="420"
      @close="closeConfirm"
    >
      <p class="pi-confirm-text" data-testid="pi-confirm-text">
        ¿Estás seguro de quitar este aumento de precios?
      </p>
      <template #footer>
        <button
          type="button"
          class="pi-btn pi-btn--ghost"
          data-testid="pi-confirm-cancel"
          :disabled="deleting"
          @click="closeConfirm"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="pi-btn pi-btn--danger"
          data-testid="pi-confirm-ok"
          :disabled="deleting"
          @click="confirmDelete"
        >
          Eliminar
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* Scaffold grey[900] full-screen standalone (mismo layout que
   ManageCategoriesView: var(--bg), sin rail). */
.pi-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  font-family: var(--font);
}

/* ===== AppBar: bg scaffold, elevation 0, refresh a la derecha ===== */
.pi-appbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--bg);
}

.pi-appbar-title {
  margin: 0;
  flex: 1;
  font-size: 22px;
  font-weight: 400;
  color: var(--text);
}

.pi-appbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* IconButton 48px circular, hover white08 (patrón ManageCategoriesView) */
.pi-icon-btn {
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

.pi-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

/* ===== Cuerpo centrado (máx ~800px) ===== */
.pi-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
}

/* ===== NOTA informativa del brief (discreta, azul info alpha) ===== */
.pi-note {
  margin: 12px 16px 0;
  padding: 8px 12px;
  border-radius: var(--radius);
  background: rgba(33, 150, 243, 0.1);
  border: 1px solid rgba(33, 150, 243, 0.35);
  color: var(--info);
  font-size: 12px;
  line-height: 1.4;
}

/* ===== Lista: ListView padding 16 ===== */
.pi-list-wrap {
  flex: 1;
  padding: 16px;
}

.pi-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 64px 24px;
  text-align: center;
}

.pi-state-error-icon {
  color: var(--error);
}

.pi-state-text {
  margin: 0;
  color: var(--text);
}

/* ElevatedButton 'Reintentar': deepOrange radius 12 bold */
.pi-retry {
  padding: 12px 24px;
  background: var(--primary);
  color: var(--on-primary);
  border: none;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
}

.pi-retry:hover {
  background: var(--primary-hover);
}

/* Section title (L176-179 / L241-247): 20 bold */
.pi-section-title {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
}

.pi-section-title--form {
  margin-top: 32px; /* SizedBox(height: 32) L238 */
}

/* Hint gris 13px (L184-188 / L249-252) */
.pi-section-hint {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--text-faint);
  white-space: pre-line;
}

/* ===== Card vacío 'Sin configuraciones activas' (L190-202) ===== */
.pi-empty-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px;
  background: var(--bg-surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  color: var(--text-muted);
}

/* ===== Card de config (ListTile L207-235) ===== */
.pi-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pi-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 8px 12px 16px;
  background: var(--bg-surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

/* CircleAvatar deepOrange .15 (L210-216) */
.pi-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 999px;
  background: rgba(255, 87, 34, 0.15);
  color: var(--primary);
}

.pi-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* '+N%' grande deepOrange (L218-225): 22 bold */
.pi-item-pct {
  font-size: 22px;
  font-weight: 700;
  color: var(--primary);
  line-height: 1.2;
}

.pi-item-scope {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-muted);
}

/* Badge de alcance (rúbrica _describeScope de ManageCategoriesView) */
.pi-item-badge {
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
  font-size: 11px;
  flex: none;
}

.pi-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.pi-item-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--text);
  cursor: pointer;
  transition: background 0.15s ease;
}

.pi-item-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.pi-item-btn--delete {
  color: var(--error); /* Icon delete rojo (L228-229) */
}

/* ===== Form card (Card + Padding 20, L254-347) ===== */
.pi-form-card {
  padding: 20px;
  background: var(--bg-surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.pi-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pi-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text); /* 'Alcance' w600 L261 */
}

/* InputDecorationTheme réplica: fill black alpha .3, outline grey[700],
   radius 12, focused deepOrange */
.pi-input {
  width: 100%;
  height: 44px;
  padding: 0 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  outline: none;
  transition: border-color 0.15s ease;
}

.pi-input:focus {
  border-color: var(--primary);
}

/* Input con suffix '%' (L322-323) */
.pi-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.pi-input--suffix {
  padding-right: 36px;
}

.pi-suffix {
  position: absolute;
  right: 12px;
  color: var(--text-faint);
  font-size: 15px;
  pointer-events: none;
}

/* helperText (L326-327): 'Ejemplo: 10 → ...' */
.pi-helper {
  margin: 0;
  font-size: 12px;
  color: var(--text-faint);
}

/* ===== Botones (ElevatedButton theme: deepOrange radius 12 bold) ===== */
.pi-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 24px;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
}

/* ElevatedButton 'Aplicar aumento' L334-343: align right, padding 28/16 */
.pi-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
  align-self: flex-end;
  padding-left: 28px;
  padding-right: 28px;
  padding-top: 16px;
  padding-bottom: 16px;
}

.pi-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.pi-btn--danger {
  background: var(--error); /* redAccent del confirm L101-104 */
  color: #ffffff;
}

.pi-btn--danger:hover:not(:disabled) {
  filter: brightness(1.1);
}

.pi-btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-muted); /* TextButton */
}

.pi-btn--ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
}

.pi-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ===== Confirm texto (L95-97) ===== */
.pi-confirm-text {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text);
}

/* ===== Responsive básico: móvil reduce paddings ===== */
@media (max-width: 560px) {
  .pi-appbar-title {
    font-size: 19px;
  }

  .pi-note,
  .pi-list-wrap {
    margin-left: 12px;
    margin-right: 12px;
  }

  .pi-list-wrap {
    margin: 0;
    padding: 12px;
  }

  .pi-card {
    flex-wrap: wrap;
    gap: 10px;
  }

  .pi-item-info {
    flex-basis: calc(100% - 66px);
  }

  .pi-item-actions {
    margin-left: 56px;
  }

  .pi-btn--primary {
    align-self: stretch;
  }
}
</style>
