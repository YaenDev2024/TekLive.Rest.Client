<script setup lang="ts">
/**
 * CreatePromotionsView · "Crear Promociones" (Fase admin M1) — réplica de
 * lib/screens/admin/create_promo.dart (CrazyWings, mock) con la estructura
 * de ManageCategoriesView.vue (Fase 6.2): AppBar standalone + form + cards
 * + AppModal dialogs + toasts + guard de rol.
 *
 * Estructura replicada del Flutter:
 * - AppBar (L9-12): back → admin-dashboard, título 'Crear Promoción' (el
 *   tile del dashboard dice 'Crear Promociones' — se usa el del tile,
 *   petición del brief).
 * - Form (L64-90): TextField 'Nombre de la Promoción' + 'Descripción' +
 *   'Precio' (isNumeric) + ElevatedButton 'Guardar Promoción' (L78-85).
 * - Validaciones (L121-129): 'Este campo es obligatorio' / 'Por favor,
 *   ingrese un número válido' → aquí toasts warning.
 * - Precio: sanitize réplica ManageCatalogView sanitizePrecio
 *   (^\d+\.?\d{0,2} — FilteringTextInputFormatter del original).
 * - Tabla inferior (L92-109): DataTable Nombre/Descripción/Precio → aquí
 *   cards (móvil first) con nombre + descripción + precio + badge
 *   Activa/Inactiva + editar (lápiz) + eliminar (papelera roja).
 * - Backend (commit 7ffe922): POST nace activa; PUT mismo body + activo;
 *   DELETE soft (activo=false) — la lista muestra TODAS con el flag.
 * - Confirm eliminar: '¿Estás seguro de eliminar la promoción "X"?'
 *   (mismo texto que categorías, brief).
 *
 * DESVIACIONES CONSCIENTES (mismas que las demás vistas admin):
 * - SnackBars del Flutter → toasts del sistema existente (useToastStore).
 * - DataTable del Flutter → cards (el usuario usa iPhone PWA: móvil first).
 * - Iconos lucide (Tag para promociones).
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { CircleAlert, Pencil, Plus, RefreshCw, Tag, Trash2 } from 'lucide-vue-next'
import AppModal from '../../components/pos/AppModal.vue'
import { AppSpinner } from '../../components/ui'
import { session } from '../../services/auth'
import { useAdminPromotionsStore } from '../../stores/adminPromotions'
import { useToastStore } from '../../stores/toast'
import { ApiError } from '../../api/client'
import type { RestPromotion } from '../../api/rest'

const router = useRouter()
const store = useAdminPromotionsStore()
const toast = useToastStore()

// --- Guard de rol (copia EXACTA de ManageCategoriesView onMounted) ----------

onMounted(() => {
  const role = (session.role ?? '').toLowerCase()
  if (!['restadmin', 'superadmin', 'restmanager'].includes(role)) {
    void router.replace({ name: 'modules' })
    return
  }
  void store.loadPromotions()
})

// --- goBack: back arrow del AppBar → admin-dashboard ------------------------

async function goBack(): Promise<void> {
  if (window.history.state?.back != null) {
    await router.back()
    return
  }
  await router.replace({ name: 'admin-dashboard' })
}

// --- Sanitización réplica (FilteringTextInputFormatter del precio) ----------

/** Precio: ^\d+\.?\d{0,2} (mismo sanitizePrecio de ManageCatalogView). */
function sanitizePrecio(): void {
  const cleaned = form.value.precio.replace(/[^\d.]/g, '')
  const dot = cleaned.indexOf('.')
  form.value.precio =
    dot === -1
      ? cleaned
      : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)
}

/** Parse del precio sanitizado (double.tryParse del validator L125). */
function parsePrecio(value: string): number | null {
  const parsed = Number.parseFloat(value.replaceAll(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

// --- Form de creación (L64-90): nombre + descripción + precio + guardar -----

const form = ref({ nombre: '', descripcion: '', precio: '' })
const creating = ref(false)

/** Submit del form 'Guardar Promoción' (validaciones réplica L121-129). */
async function submitCreate(): Promise<void> {
  if (creating.value) return
  if (form.value.nombre.trim().length === 0) {
    toast.warning('Este campo es obligatorio') // validator L122-124
    return
  }
  const precio = parsePrecio(form.value.precio)
  if (precio == null) {
    toast.warning('Por favor, ingrese un número válido') // validator L125-127
    return
  }
  if (form.value.nombre.trim().length > 150) {
    toast.warning('El nombre no puede exceder 150 caracteres')
    return
  }
  creating.value = true
  try {
    await store.createPromotion({
      nombre: form.value.nombre.trim(),
      descripcion: form.value.descripcion.trim().length > 0 ? form.value.descripcion.trim() : null,
      precio,
      activo: true, // POST ignora activo: nace activa (backend)
    })
    toast.success('Promoción creada exitosamente') // réplica L40 (sin "(mock)")
    form.value = { nombre: '', descripcion: '', precio: '' } // L43-46 reset
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error: ${err.message}`
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    creating.value = false
  }
}

// --- Dialog editar (mismos campos + switch activo) ---------------------------

type DialogKind = 'none' | 'edit' | 'confirm'

const dialogKind = ref<DialogKind>('none')
const editingPromotion = ref<RestPromotion | null>(null)
const editForm = ref({ nombre: '', descripcion: '', precio: '', activo: true })
const saving = ref(false)
const deleting = ref(false)

function openEdit(promotion: RestPromotion): void {
  editingPromotion.value = promotion
  editForm.value = {
    nombre: promotion.nombre,
    descripcion: promotion.descripcion ?? '',
    precio: String(promotion.precio),
    activo: promotion.activo,
  }
  dialogKind.value = 'edit'
}

function openConfirm(promotion: RestPromotion): void {
  editingPromotion.value = promotion
  dialogKind.value = 'confirm'
}

function closeDialog(): void {
  if (saving.value || deleting.value) return
  dialogKind.value = 'none'
  editingPromotion.value = null
}

/** Guardar edición (PUT mismo body + activo). */
async function submitEdit(): Promise<void> {
  if (editingPromotion.value == null || saving.value) return
  if (editForm.value.nombre.trim().length === 0) {
    toast.warning('Este campo es obligatorio')
    return
  }
  const precio = parsePrecio(editForm.value.precio)
  if (precio == null) {
    toast.warning('Por favor, ingrese un número válido')
    return
  }
  if (editForm.value.nombre.trim().length > 150) {
    toast.warning('El nombre no puede exceder 150 caracteres')
    return
  }
  saving.value = true
  try {
    await store.updatePromotion(editingPromotion.value.id, {
      nombre: editForm.value.nombre.trim(),
      descripcion: editForm.value.descripcion.trim().length > 0 ? editForm.value.descripcion.trim() : null,
      precio,
      activo: editForm.value.activo,
    })
    toast.success('Promoción actualizada exitosamente')
    dialogKind.value = 'none'
    editingPromotion.value = null
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error: ${err.message}`
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    saving.value = false
  }
}

/** Eliminar (soft) tras confirm — texto EXACTO del brief. */
async function confirmDelete(): Promise<void> {
  if (editingPromotion.value == null || deleting.value) return
  deleting.value = true
  try {
    await store.deletePromotion(editingPromotion.value.id)
    toast.success('Promoción eliminada')
    dialogKind.value = 'none'
    editingPromotion.value = null
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error: ${err.message}`
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    deleting.value = false
  }
}

// --- Helpers de card ----------------------------------------------------------

/** Precio display 'MXN X.XX' (mismo formato es-MX que CashDrawerView). */
function formatMoney(amount: number): string {
  const formatted = new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
  return `MXN ${formatted}`
}

const promotions = computed(() => store.all)
</script>

<template>
  <div class="pr-page">
    <!-- ===== AppBar réplica: back + título + refresh ===== -->
    <header class="pr-appbar">
      <button
        type="button"
        class="pr-icon-btn"
        title="Regresar a Administración"
        aria-label="Regresar a Administración"
        data-testid="pr-back"
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
      <h1 class="pr-appbar-title">Crear Promociones</h1>
      <div class="pr-appbar-actions">
        <button
          type="button"
          class="pr-icon-btn"
          title="Recargar"
          aria-label="Recargar"
          data-testid="pr-refresh"
          @click="store.loadPromotions(true)"
        >
          <RefreshCw :size="20" aria-hidden="true" />
        </button>
      </div>
    </header>

    <main class="pr-body">
      <!-- ===== Form crear (L64-90) ===== -->
      <section class="pr-form-card" data-testid="pr-form">
        <div class="pr-field">
          <label class="pr-label" for="pr-nombre">Nombre de la Promoción</label>
          <input
            id="pr-nombre"
            v-model="form.nombre"
            type="text"
            class="pr-input"
            data-testid="pr-nombre"
            autocomplete="off"
            maxlength="150"
            @keydown.enter.prevent="submitCreate"
          />
        </div>

        <div class="pr-field">
          <label class="pr-label" for="pr-descripcion">Descripción</label>
          <input
            id="pr-descripcion"
            v-model="form.descripcion"
            type="text"
            class="pr-input"
            data-testid="pr-descripcion"
            autocomplete="off"
            maxlength="500"
            @keydown.enter.prevent="submitCreate"
          />
        </div>

        <div class="pr-field">
          <label class="pr-label" for="pr-precio">Precio</label>
          <div class="pr-input-wrap">
            <span class="pr-prefix">MXN </span>
            <input
              id="pr-precio"
              v-model="form.precio"
              type="text"
              class="pr-input pr-input--bare"
              data-testid="pr-precio"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0.00"
              @input="sanitizePrecio"
              @keydown.enter.prevent="submitCreate"
            />
          </div>
        </div>

        <button
          type="button"
          class="pr-btn pr-btn--primary pr-btn--block"
          data-testid="pr-save"
          :disabled="creating"
          @click="submitCreate"
        >
          <Plus :size="20" aria-hidden="true" />
          Guardar Promoción
        </button>
      </section>

      <!-- ===== Lista (L92-109): spinner / error / vacío / cards ===== -->
      <div class="pr-list-wrap">
        <div v-if="store.loading" class="pr-state" data-testid="pr-loading">
          <AppSpinner :size="36" tone="primary" />
        </div>

        <div v-else-if="store.error != null" class="pr-state" data-testid="pr-error">
          <CircleAlert :size="64" class="pr-state-error-icon" aria-hidden="true" />
          <p class="pr-state-text">{{ store.error }}</p>
          <button
            type="button"
            class="pr-retry"
            data-testid="pr-retry"
            @click="store.loadPromotions(true)"
          >
            Reintentar
          </button>
        </div>

        <p v-else-if="promotions.length === 0" class="pr-state pr-empty" data-testid="pr-empty">
          No hay promociones para mostrar
        </p>

        <ul v-else class="pr-list" data-testid="pr-list">
          <li
            v-for="promotion in promotions"
            :key="promotion.id"
            class="pr-card"
            :data-testid="`pr-item-${promotion.id}`"
          >
            <span class="pr-avatar">
              <Tag :size="22" aria-hidden="true" />
            </span>
            <span class="pr-item-info">
              <span class="pr-item-name">{{ promotion.nombre }}</span>
              <span v-if="promotion.descripcion" class="pr-item-desc">{{ promotion.descripcion }}</span>
              <span class="pr-item-meta">
                <span class="pr-item-price">{{ formatMoney(promotion.precio) }}</span>
                <span
                  class="pr-item-status"
                  :class="promotion.activo ? 'pr-item-status--active' : 'pr-item-status--inactive'"
                >
                  {{ promotion.activo ? 'Activa' : 'Inactiva' }}
                </span>
              </span>
            </span>
            <span class="pr-item-actions">
              <button
                type="button"
                class="pr-item-btn"
                :aria-label="`Editar ${promotion.nombre}`"
                :data-testid="`pr-edit-${promotion.id}`"
                @click="openEdit(promotion)"
              >
                <Pencil :size="20" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="pr-item-btn pr-item-btn--delete"
                :aria-label="`Eliminar ${promotion.nombre}`"
                :data-testid="`pr-delete-${promotion.id}`"
                @click="openConfirm(promotion)"
              >
                <Trash2 :size="20" aria-hidden="true" />
              </button>
            </span>
          </li>
        </ul>
      </div>
    </main>

    <!-- ===== Dialog editar: mismos campos + switch activo ===== -->
    <AppModal
      v-if="dialogKind === 'edit' && editingPromotion != null"
      title="Editar Promoción"
      :width="440"
      data-testid="pr-edit-dialog"
      @close="closeDialog"
    >
      <form class="pr-form" @submit.prevent="submitEdit">
        <div class="pr-field">
          <label class="pr-label" for="pr-edit-nombre">Nombre de la Promoción</label>
          <input
            id="pr-edit-nombre"
            v-model="editForm.nombre"
            type="text"
            class="pr-input"
            data-testid="pr-edit-nombre"
            autocomplete="off"
            maxlength="150"
          />
        </div>

        <div class="pr-field">
          <label class="pr-label" for="pr-edit-descripcion">Descripción</label>
          <input
            id="pr-edit-descripcion"
            v-model="editForm.descripcion"
            type="text"
            class="pr-input"
            data-testid="pr-edit-descripcion"
            autocomplete="off"
            maxlength="500"
          />
        </div>

        <div class="pr-field">
          <label class="pr-label" for="pr-edit-precio">Precio</label>
          <div class="pr-input-wrap">
            <span class="pr-prefix">MXN </span>
            <input
              id="pr-edit-precio"
              v-model="editForm.precio"
              type="text"
              class="pr-input pr-input--bare"
              data-testid="pr-edit-precio"
              inputmode="decimal"
              autocomplete="off"
              @input="sanitizePrecio"
            />
          </div>
        </div>

        <!-- Estado activo (switch) — el PUT manda el flag -->
        <label class="pr-switch" data-testid="pr-edit-activo">
          <input v-model="editForm.activo" type="checkbox" />
          <span class="pr-switch-track" aria-hidden="true"></span>
          <span class="pr-switch-label">Promoción activa</span>
        </label>
      </form>
      <template #footer>
        <button
          type="button"
          class="pr-btn pr-btn--ghost"
          data-testid="pr-edit-cancel"
          :disabled="saving"
          @click="closeDialog"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="pr-btn pr-btn--primary"
          data-testid="pr-edit-save"
          :disabled="saving"
          @click="submitEdit"
        >
          Guardar
        </button>
      </template>
    </AppModal>

    <!-- ===== Confirm eliminar: texto EXACTO del brief ===== -->
    <AppModal
      v-if="dialogKind === 'confirm' && editingPromotion != null"
      title="Confirmar Eliminación"
      :width="400"
      @close="closeDialog"
    >
      <p class="pr-confirm-text" data-testid="pr-confirm-text">
        ¿Estás seguro de eliminar la promoción "{{ editingPromotion.nombre }}"?
      </p>
      <template #footer>
        <button
          type="button"
          class="pr-btn pr-btn--ghost"
          data-testid="pr-confirm-cancel"
          :disabled="deleting"
          @click="closeDialog"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="pr-btn pr-btn--danger"
          data-testid="pr-confirm-ok"
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
.pr-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  font-family: var(--font);
}

/* ===== AppBar: bg scaffold, elevation 0, refresh a la derecha ===== */
.pr-appbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--bg);
}

.pr-appbar-title {
  margin: 0;
  flex: 1;
  font-size: 22px;
  font-weight: 400;
  color: var(--text);
}

.pr-appbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* IconButton 48px circular, hover white08 (patrón ManageCategoriesView) */
.pr-icon-btn {
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

.pr-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

/* ===== Cuerpo centrado (máx ~800px) ===== */
.pr-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
}

/* ===== Form card (L64-90): fields + 'Guardar Promoción' ===== */
.pr-form-card {
  margin: 12px 16px 0;
  padding: 12px;
  border: 1px solid var(--border); /* Colors.grey.shade700 */
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pr-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* labelText: labelStyle grey[400] (main L114) */
.pr-label {
  font-size: 12px;
  color: var(--text-faint);
}

/* InputDecorationTheme réplica: fill black alpha .3, outline grey[700]
   radius 12, focused deepOrange (main L113-125) */
.pr-input {
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

.pr-input:focus {
  border-color: var(--primary);
}

/* Input monetario con prefijo 'MXN ' (patrón StartCashSessionModal) */
.pr-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.pr-input--bare {
  padding-left: 52px;
}

.pr-prefix {
  position: absolute;
  left: 12px;
  color: var(--text-faint);
  font-size: 15px;
  pointer-events: none;
}

/* ===== Botones (ElevatedButton theme: deepOrange radius 12 bold) ===== */
.pr-btn {
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

/* ElevatedButton L78-85: padding vertical 16, fontSize 18 */
.pr-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.pr-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.pr-btn--block {
  padding-top: 16px;
  padding-bottom: 16px;
  font-size: 18px;
}

.pr-btn--danger {
  background: var(--error);
  color: #ffffff;
}

.pr-btn--danger:hover:not(:disabled) {
  filter: brightness(1.1);
}

.pr-btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-muted); /* TextButton */
}

.pr-btn--ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
}

.pr-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ===== Lista: Expanded + ListView padding 16 ===== */
.pr-list-wrap {
  flex: 1;
  padding: 16px;
}

.pr-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 64px 24px;
  text-align: center;
}

.pr-empty {
  margin: 0;
  color: var(--text);
  font-size: 16px;
}

.pr-state-error-icon {
  color: var(--error); /* Icons.error_outline rojo */
}

.pr-state-text {
  margin: 0;
  color: var(--text);
}

/* ElevatedButton 'Reintentar': deepOrange radius 12 bold */
.pr-retry {
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

.pr-retry:hover {
  background: var(--primary-hover);
}

/* ===== Card de promoción (CardTheme grey[850] elev 2 radius 12) ===== */
.pr-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pr-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 8px 12px 16px;
  background: var(--bg-surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.pr-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 999px;
  background: rgba(255, 87, 34, 0.22); /* deepOrange alpha */
  color: var(--primary);
}

.pr-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pr-item-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pr-item-desc {
  font-size: 13px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pr-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pr-item-price {
  font-size: 14px;
  font-weight: 700;
  color: var(--primary); /* precio deepOrange (patrón ProductCard) */
}

/* Badge Activa/Inactiva (verde/rojo alpha — patrón mu-status) */
.pr-item-status {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
}

.pr-item-status--active {
  background: rgba(76, 175, 80, 0.15);
  color: var(--success);
}

.pr-item-status--inactive {
  background: rgba(255, 82, 82, 0.15);
  color: var(--error);
}

/* Trailing: IconButtons editar/eliminar */
.pr-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.pr-item-btn {
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

.pr-item-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.pr-item-btn--delete {
  color: var(--error); /* Icon delete rojo */
}

/* ===== Confirm texto ===== */
.pr-confirm-text {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text);
}

/* ===== Form dentro del dialog ===== */
.pr-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ===== Switch (patrón mu-switch de ManageUsersView) ===== */
.pr-switch {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}

.pr-switch input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
}

.pr-switch-track {
  position: relative;
  width: 44px;
  height: 24px;
  flex: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.15);
  transition: background 0.15s ease;
}

.pr-switch-track::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #ffffff;
  transition: transform 0.15s ease;
}

.pr-switch input:checked + .pr-switch-track {
  background: var(--primary);
}

.pr-switch input:checked + .pr-switch-track::after {
  transform: translateX(20px);
}

.pr-switch-label {
  font-size: 14px;
  color: var(--text);
}

/* ===== Responsive básico: móvil reduce paddings ===== */
@media (max-width: 560px) {
  .pr-appbar-title {
    font-size: 19px;
  }

  .pr-form-card {
    margin: 8px 12px 0;
  }

  .pr-list-wrap {
    padding: 12px;
  }

  .pr-card {
    flex-wrap: wrap;
    gap: 10px;
  }

  .pr-item-info {
    flex-basis: calc(100% - 66px);
  }

  .pr-item-actions {
    margin-left: 56px;
  }
}
</style>
