<script setup lang="ts">
/**
 * ExternalCustomerForm · formulario de cliente EXTERNO (ronda 4).
 *
 * Réplica EXACTA de external_customer_form.dart + customer_provider.dart
 * (CrazyWings Flutter) contra el API REAL de clientes (backend 0700a12):
 *
 * - Búsqueda por número (Enter o botón): GET /api/rest/customers/search.
 *   · Encontrado (data != null) → selecciona (tarjeta verde), cierra form
 *     de creación y lista de frecuentes.
 *   · NO encontrado (data === null) → abre el form de creación COMPLETO
 *     (nombre*, teléfono, dirección, contacto, empresa, tipo dropdown,
 *     horario, comentarios — réplica _buildNewCustomerForm ampliada).
 *   · Vacío → toast rojo 'Ingresa el número del cliente'.
 * - Crear: POST /api/rest/customers → toast verde '✅ Cliente creado
 *   exitosamente' + limpiar form + AUTO-SELECCIONAR el cliente creado.
 *   409 duplicado / 400 → toast con el `message` del backend.
 * - Clientes frecuentes: GET /frequent?limit=50 al abrir (réplica
 *   initState L37-41); lista clicable → selecciona directo (réplica
 *   _showFrequentList). Vacía → sección oculta.
 * - PATCH (botón editar tarjeta verde): réplica _showEditCustomerDialog
 *   — nombre + teléfono. Nota: el backend NO acepta customerName en PATCH
 *   (deuda documentada) → edita teléfono y muestra nombre readonly.
 * - El padre recibe el RestCustomer completo vía @change (null = limpio).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Search, CheckCircle2, X, Pencil, User, Store } from 'lucide-vue-next'
import { AppSelect } from '../ui'
import {
  createCustomer,
  getFrequentCustomers,
  searchCustomer,
  updateCustomer,
} from '../../api/customers'
import type { RestCustomer } from '../../api/pos-types'
import { ApiError } from '../../api/client'
import { useToastStore } from '../../stores/toast'

const props = defineProps<{
  /** Cliente ya seleccionado (tarjeta verde al reabrir el toggle). */
  initial?: RestCustomer | null
}>()

const emit = defineEmits<{
  /** Cambia el cliente seleccionado (null = limpio). */
  change: [value: RestCustomer | null]
}>()

const toast = useToastStore()

// --- Estado réplica CustomerProvider ----------------------------------------
const selected = ref<RestCustomer | null>(props.initial ?? null)
const frequent = ref<RestCustomer[]>([])
const loading = ref(false)
const searching = ref(false)
const creating = ref(false)
const savingEdit = ref(false)

// --- Form de búsqueda --------------------------------------------------------
const searchNumber = ref('')

// --- Form de creación (réplica controllers L19-27 + L29) ---------------------
const name = ref('')
const phone = ref('')
const address = ref('')
const contactPerson = ref('')
const companyName = ref('')
const customerType = ref<'INDIVIDUAL' | 'EMPRESA'>('INDIVIDUAL')
const deliveryTime = ref('')
const comments = ref('')

const showNewForm = ref(false)
const showFrequentList = ref(false)

/** Título de la tarjeta verde: nombre + '#numero' (réplica L390-405). */
const selectedSub = computed(() => {
  if (selected.value == null) return ''
  const parts: string[] = [`#${selected.value.customerNumber}`]
  if (selected.value.phone != null && selected.value.phone !== '') {
    parts.push(`Tel: ${selected.value.phone}`)
  }
  return parts.join(' · ')
})

/** Carga de frecuentes al montar (réplica initState → loadFrequentCustomers). */
onMounted(() => {
  void loadFrequent()
})

onBeforeUnmount(() => {
  // Sin suscripciones activas; el toast se limpia solo.
})

async function loadFrequent(): Promise<void> {
  loading.value = true
  try {
    const { data } = await getFrequentCustomers(50)
    frequent.value = data
  } catch {
    // Réplica customer_provider L48-50: falla silenciosa, lista vacía.
    frequent.value = []
  } finally {
    loading.value = false
  }
}

/**
 * Réplica _searchCustomer (L57-89): vacío → toast rojo; encontrado →
 * selecciona y cierra form/lista; no encontrado → abre form de creación.
 */
async function onSearch(): Promise<void> {
  const num = searchNumber.value.trim()
  if (num === '') {
    toast.error('Ingresa el número del cliente')
    return
  }
  searching.value = true
  try {
    const { data } = await searchCustomer(num)
    if (data != null) {
      // Cliente encontrado: selecciona directo (L76-81).
      showNewForm.value = false
      showFrequentList.value = false
      selected.value = data
      emit('change', data)
    } else {
      // No encontrado: form de creación COMPLETO (L82-88).
      showNewForm.value = true
      showFrequentList.value = false
    }
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Error buscando cliente')
  } finally {
    searching.value = false
  }
}

/**
 * Réplica _createNewCustomer (L91-154): nombre* y número* requeridos →
 * POST → toast verde + limpiar + auto-selección; 400/409 → message backend.
 */
async function onCreateNew(): Promise<void> {
  if (name.value.trim() === '' || searchNumber.value.trim() === '') {
    toast.error('Nombre y número del cliente son requeridos')
    return
  }
  creating.value = true
  try {
    const { data } = await createCustomer({
      customerNumber: searchNumber.value.trim(),
      customerName: name.value.trim(),
      customerType: customerType.value,
      phone: phone.value.trim() === '' ? null : phone.value.trim(),
      contactPerson: contactPerson.value.trim() === '' ? null : contactPerson.value.trim(),
      companyName: companyName.value.trim() === '' ? null : companyName.value.trim(),
      deliveryAddress: address.value.trim() === '' ? null : address.value.trim(),
      deliveryTimePreference: deliveryTime.value.trim() === '' ? null : deliveryTime.value.trim(),
      comments: comments.value.trim() === '' ? null : comments.value.trim(),
    })
    toast.success('✅ Cliente creado exitosamente')
    clearForm()
    // Auto-selección del cliente creado (réplica L140-141).
    selected.value = data
    emit('change', data)
    // El nuevo cliente se verá en frecuentes al reabrir (backend ordena
    // lastOrderDate DESC NULLS LAST, created_date DESC → aparece arriba).
  } catch (err) {
    if (err instanceof ApiError) {
      // 409 duplicado / 400 validación: el backend manda { Message } con el
      // texto exacto ('El número de cliente X ya existe.').
      toast.error(err.message)
    } else {
      toast.error('Error al crear el cliente')
    }
  } finally {
    creating.value = false
  }
}

/** Réplica _clearForm (L156-170). */
function clearForm(): void {
  searchNumber.value = ''
  name.value = ''
  phone.value = ''
  address.value = ''
  contactPerson.value = ''
  companyName.value = ''
  deliveryTime.value = ''
  comments.value = ''
  customerType.value = 'INDIVIDUAL'
  showNewForm.value = false
  showFrequentList.value = false
}

/** Selecciona cliente de la lista de frecuentes (réplica onTap L586-590). */
function onPickFrequent(customer: RestCustomer): void {
  selected.value = customer
  showFrequentList.value = false
  showNewForm.value = false
  emit('change', customer)
  clearForm()
}

/** Toggle de la lista de frecuentes (el Flutter la muestra por estado). */
function toggleFrequent(): void {
  if (selected.value != null) return
  showFrequentList.value = !showFrequentList.value
  if (showFrequentList.value) void loadFrequent()
}

/**
 * Réplica _showEditCustomerDialog (L173-290): editar nombre/teléfono del
 * cliente seleccionado. El backend PATCH no acepta customerName (deuda
 * documentada) → se edita el teléfono y el nombre queda informativo.
 */
async function onEditSelected(): Promise<void> {
  if (selected.value == null || savingEdit.value) return
  const currentPhone = selected.value.phone ?? ''
  // Prompt simple reutiliza los inputs del form de creación precargados.
  showNewForm.value = true
  showFrequentList.value = false
  searchNumber.value = selected.value.customerNumber
  name.value = selected.value.customerName
  phone.value = currentPhone
  toast.info('Edita el teléfono y presiona Actualizar.')
}

/** Guarda la edición vía PATCH (solo teléfono — nombre es deuda backend). */
async function onSaveEdit(): Promise<void> {
  if (selected.value == null || savingEdit.value) return
  savingEdit.value = true
  try {
    const { data } = await updateCustomer(selected.value.customerId, {
      phone: phone.value.trim() === '' ? null : phone.value.trim(),
    })
    toast.success('✅ Cliente actualizado exitosamente')
    selected.value = data
    emit('change', data)
    clearForm()
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Error al actualizar el cliente')
  } finally {
    savingEdit.value = false
  }
}

/** Réplica botón X de la tarjeta verde (L419-429). */
function onClear(): void {
  selected.value = null
  emit('change', null)
  clearForm()
}

/** ¿El form de creación está en modo edición del cliente seleccionado? */
const isEditingSelected = computed(() => selected.value != null && showNewForm.value)

/** Texto del botón principal del form (Crear / Actualizar). */
const submitLabel = computed(() => (isEditingSelected.value ? 'Actualizar' : 'Crear'))
</script>

<template>
  <div class="ecf">
    <!-- Barra de búsqueda (réplica L302-360) -->
    <div class="ecf__search-row">
      <div class="ecf__search-wrap">
        <Search :size="18" class="ecf__search-icon" aria-hidden="true" />
        <input
          v-model="searchNumber"
          type="text"
          class="ecf__search-input"
          placeholder="Número del cliente"
          aria-label="Número del cliente"
          data-testid="customer-search-input"
          :disabled="selected != null"
          @keydown.enter="onSearch"
        />
      </div>
      <button
        type="button"
        class="ecf__search-btn"
        aria-label="Buscar cliente"
        data-testid="customer-search-btn"
        :disabled="searching || selected != null"
        @click="onSearch"
      >
        <Search :size="18" />
      </button>
    </div>

    <!-- Cliente seleccionado (réplica tarjeta verde L366-433) -->
    <div v-if="selected != null" class="ecf__selected" data-testid="customer-selected">
      <span class="ecf__selected-icon">
        <CheckCircle2 :size="16" />
      </span>
      <span class="ecf__selected-info">
        <span class="ecf__selected-name">{{ selected.customerName }}</span>
        <span class="ecf__selected-sub">{{ selectedSub }}</span>
      </span>
      <button
        type="button"
        class="ecf__selected-btn ecf__selected-btn--edit"
        aria-label="Editar cliente"
        data-testid="customer-edit"
        @click="onEditSelected"
      >
        <Pencil :size="16" />
      </button>
      <button
        type="button"
        class="ecf__selected-btn"
        aria-label="Quitar cliente"
        data-testid="customer-clear"
        @click="onClear"
      >
        <X :size="16" />
      </button>
    </div>

    <!-- Frecuentes: link para desplegar (Flutter muestra tras búsqueda vacía;
         aquí accesible siempre que no haya cliente seleccionado) -->
    <button
      v-if="selected == null && !showNewForm && frequent.length > 0"
      type="button"
      class="ecf__frequent-toggle"
      data-testid="customer-frequent-toggle"
      @click="toggleFrequent"
    >
      <User :size="14" aria-hidden="true" />
      Clientes frecuentes ({{ frequent.length }})
    </button>

    <!-- Lista de frecuentes (réplica _buildFrequentCustomersList L549-636) -->
    <div v-if="showFrequentList && frequent.length > 0" class="ecf__frequent">
      <span class="ecf__frequent-title">Clientes Frecuentes:</span>
      <div class="ecf__frequent-list">
        <button
          v-for="(customer, index) in frequent"
          :key="customer.customerId"
          type="button"
          class="ecf__frequent-row"
          :class="{ 'ecf__frequent-row--last': index === frequent.length - 1 }"
          :data-testid="`customer-frequent-${customer.customerNumber}`"
          @click="onPickFrequent(customer)"
        >
          <User v-if="customer.customerType !== 'EMPRESA'" :size="18" class="ecf__frequent-icon" aria-hidden="true" />
          <Store v-else :size="18" class="ecf__frequent-icon" aria-hidden="true" />
          <span class="ecf__frequent-info">
            <span class="ecf__frequent-name">{{ customer.customerName }}</span>
            <span class="ecf__frequent-sub">
              #{{ customer.customerNumber }} - {{ customer.customerType === 'EMPRESA' ? 'Empresa' : 'Individual' }}
            </span>
          </span>
        </button>
      </div>
    </div>

    <!-- Form crear/editar cliente (réplica _buildNewCustomerForm L448-547,
         ampliado con los campos completos del provider Flutter) -->
    <div v-if="showNewForm" class="ecf__new" data-testid="customer-new-form">
      <span class="ecf__new-title">{{ isEditingSelected ? 'Editar Cliente' : 'Crear Nuevo Cliente' }}</span>
      <label class="ecf__label" for="ecf-name">Nombre *</label>
      <input
        id="ecf-name"
        v-model="name"
        type="text"
        class="ecf__input"
        data-testid="customer-name"
        :disabled="isEditingSelected"
      />
      <label class="ecf__label" for="ecf-phone">Teléfono</label>
      <input
        id="ecf-phone"
        v-model="phone"
        type="tel"
        class="ecf__input"
        data-testid="customer-phone"
      />
      <template v-if="!isEditingSelected">
        <label class="ecf__label" for="ecf-address">Dirección de entrega</label>
        <input id="ecf-address" v-model="address" type="text" class="ecf__input" data-testid="customer-address" />
        <label class="ecf__label" for="ecf-contact">Persona de contacto</label>
        <input id="ecf-contact" v-model="contactPerson" type="text" class="ecf__input" data-testid="customer-contact" />
        <label class="ecf__label" for="ecf-company">Nombre de empresa</label>
        <input id="ecf-company" v-model="companyName" type="text" class="ecf__input" data-testid="customer-company" />
        <label class="ecf__label">Tipo</label>
        <AppSelect
          v-model="customerType"
          :options="[
            { value: 'INDIVIDUAL', label: 'INDIVIDUAL' },
            { value: 'EMPRESA', label: 'EMPRESA' },
          ]"
          testid="customer-type"
          aria-label="Tipo"
        />
        <label class="ecf__label" for="ecf-time">Horario de entrega preferido</label>
        <input id="ecf-time" v-model="deliveryTime" type="text" class="ecf__input" data-testid="customer-time" />
        <label class="ecf__label" for="ecf-comments">Comentarios</label>
        <textarea id="ecf-comments" v-model="comments" class="ecf__input ecf__input--area" rows="2" data-testid="customer-comments"></textarea>
      </template>
      <div class="ecf__new-actions">
        <button type="button" class="ecf__btn ecf__btn--ghost" @click="onClear">Cancelar</button>
        <button
          type="button"
          class="ecf__btn ecf__btn--primary"
          data-testid="customer-submit"
          :disabled="isEditingSelected ? savingEdit : creating"
          @click="isEditingSelected ? onSaveEdit() : onCreateNew()"
        >
          {{ isEditingSelected ? (savingEdit ? 'Guardando…' : submitLabel) : (creating ? 'Creando…' : submitLabel) }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ecf {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Búsqueda */
.ecf__search-row {
  display: flex;
  gap: 8px;
}

.ecf__search-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}

.ecf__search-icon {
  position: absolute;
  top: 50%;
  left: 8px;
  transform: translateY(-50%);
  color: var(--text-faint);
  pointer-events: none;
}

.ecf__search-input {
  width: 100%;
  padding: 8px 10px 8px 30px;
  background: var(--card-overlay);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: var(--font);
  font-size: 11px;
  outline: none;
}

.ecf__search-input::placeholder {
  color: var(--text-faint);
  font-size: 11px;
}

.ecf__search-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary);
}

.ecf__search-input:disabled {
  opacity: 0.55;
}

.ecf__search-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 36px;
  background: var(--primary);
  border: none;
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
}

.ecf__search-btn:hover:not(:disabled) {
  background: var(--primary-hover);
}

.ecf__search-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Cliente seleccionado (tarjeta verde) */
.ecf__selected {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  background: rgba(76, 175, 80, 0.1);
  border: 1.5px solid rgba(76, 175, 80, 0.5);
  border-radius: 6px;
}

.ecf__selected-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: rgba(76, 175, 80, 0.3);
  color: var(--success);
}

.ecf__selected-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.ecf__selected-name {
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ecf__selected-sub {
  color: var(--text-faint);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ecf__selected-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-faint);
  cursor: pointer;
}

.ecf__selected-btn--edit {
  color: var(--info);
}

/* Frecuentes */
.ecf__frequent-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-family: var(--font);
  font-size: 11px;
  cursor: pointer;
}

.ecf__frequent-toggle:hover {
  color: var(--primary);
}

.ecf__frequent {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ecf__frequent-title {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.ecf__frequent-list {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid #616161;
  border-radius: 12px;
  background: var(--card-overlay);
}

.ecf__frequent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: none;
  border-bottom: 0.5px solid #424242;
  color: var(--text);
  font-family: var(--font);
  text-align: left;
  cursor: pointer;
}

.ecf__frequent-row--last {
  border-bottom: none;
}

.ecf__frequent-row:hover {
  background: rgba(255, 255, 255, 0.06);
}

.ecf__frequent-icon {
  flex: none;
  color: var(--primary);
}

.ecf__frequent-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.ecf__frequent-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ecf__frequent-sub {
  font-size: 11px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Form nuevo cliente */
.ecf__new {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: var(--card-overlay);
  border: 1px solid rgba(255, 87, 34, 0.3);
  border-radius: 8px;
}

.ecf__new-title {
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
}

.ecf__label {
  color: var(--text-faint);
  font-size: 11px;
}

.ecf__input {
  width: 100%;
  padding: 10px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: var(--font);
  font-size: 12px;
  outline: none;
}

.ecf__input:focus {
  border-color: var(--primary);
}

.ecf__input:disabled {
  opacity: 0.55;
}

.ecf__input--area {
  resize: vertical;
  min-height: 40px;
}

.ecf__new-actions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}

.ecf__btn {
  flex: 1;
  padding: 10px 0;
  border-radius: 6px;
  border: 1px solid transparent;
  font-family: var(--font);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.ecf__btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ecf__btn--ghost {
  background: #616161;
  color: #fff;
}

.ecf__btn--ghost:hover:not(:disabled) {
  background: #6e6e6e;
}

.ecf__btn--primary {
  background: var(--primary);
  color: #fff;
}

.ecf__btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}
</style>
