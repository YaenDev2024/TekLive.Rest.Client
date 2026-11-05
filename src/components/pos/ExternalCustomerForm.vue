<script setup lang="ts">
/**
 * ExternalCustomerForm · formulario de cliente EXTERNO (ronda 3).
 *
 * Réplica visual de external_customer_form.dart (Flutter): barra de búsqueda
 * + tarjeta de cliente seleccionado + form de nuevo cliente (nombre/teléfono).
 *
 * ⚠️ BACKEND DEPENDENCY: el backend Rest NO tiene búsqueda/creación de
 * clientes todavía (rest.customers existe en BD, falta endpoint). Mientras
 * tanto: nombre/teléfono funcionales y al confirmar se serializan en
 * PlatformDeliveryInfo → external_customer_data (columna ya existente,
 * RestOrderService.cs L119 la persiste verbatim).
 */
import { ref } from 'vue'
import { Search, CheckCircle2, X, Pencil } from 'lucide-vue-next'
import { useToastStore } from '../../stores/toast'

const props = defineProps<{
  /** Datos ya capturados (replicarlos en los inputs al reabrir el toggle). */
  initial?: { name: string; phone: string } | null
}>()

const emit = defineEmits<{
  /** Cambia el cliente capturado (null = limpio). */
  change: [value: { name: string; phone: string } | null]
}>()

const toast = useToastStore()

const searchNumber = ref(props.initial?.name ?? '')
const name = ref(props.initial?.name ?? '')
const phone = ref(props.initial?.phone ?? '')
const showNewForm = ref(false)

/** Cliente "seleccionado" local (no hay endpoint de búsqueda aún). */
function onSearch(): void {
  const num = searchNumber.value.trim()
  if (num === '') {
    toast.error('Ingresa el número del cliente')
    return
  }
  // Sin backend: todo número se trata como "no encontrado" → form nuevo.
  showNewForm.value = true
  toast.info('Búsqueda de clientes disponible próximamente. Captura los datos manualmente.')
}

function onConfirmNew(): void {
  if (name.value.trim() === '') {
    toast.error('Nombre y número del cliente son requeridos')
    return
  }
  showNewForm.value = false
  emitChange()
}

function onClear(): void {
  name.value = ''
  phone.value = ''
  searchNumber.value = ''
  showNewForm.value = false
  emit('change', null)
}

function emitChange(): void {
  emit('change', { name: name.value.trim(), phone: phone.value.trim() })
}
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
          @keydown.enter="onSearch"
        />
      </div>
      <button type="button" class="ecf__search-btn" aria-label="Buscar cliente" @click="onSearch">
        <Search :size="18" />
      </button>
    </div>

    <!-- Cliente capturado (réplica tarjeta verde L366-433) -->
    <div v-if="name.trim() !== ''" class="ecf__selected">
      <span class="ecf__selected-icon">
        <CheckCircle2 :size="16" />
      </span>
      <span class="ecf__selected-info">
        <span class="ecf__selected-name">{{ name }}</span>
        <span class="ecf__selected-sub">{{ phone !== '' ? `Tel: ${phone}` : 'Datos capturados localmente' }}</span>
      </span>
      <button
        type="button"
        class="ecf__selected-btn ecf__selected-btn--edit"
        aria-label="Editar cliente"
        @click="showNewForm = true"
      >
        <Pencil :size="16" />
      </button>
      <button
        type="button"
        class="ecf__selected-btn"
        aria-label="Quitar cliente"
        @click="onClear"
      >
        <X :size="16" />
      </button>
    </div>

    <!-- Form nuevo cliente (réplica _buildNewCustomerForm L448-547) -->
    <div v-if="showNewForm" class="ecf__new">
      <span class="ecf__new-title">Crear Nuevo Cliente</span>
      <label class="ecf__label" for="ecf-name">Nombre</label>
      <input
        id="ecf-name"
        v-model="name"
        type="text"
        class="ecf__input"
        @change="emitChange"
      />
      <label class="ecf__label" for="ecf-phone">Teléfono</label>
      <input
        id="ecf-phone"
        v-model="phone"
        type="tel"
        class="ecf__input"
        @change="emitChange"
      />
      <div class="ecf__new-actions">
        <button type="button" class="ecf__btn ecf__btn--ghost" @click="onClear">Cancelar</button>
        <button type="button" class="ecf__btn ecf__btn--primary" @click="onConfirmNew">
          Crear
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

.ecf__search-btn:hover {
  background: var(--primary-hover);
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

.ecf__btn--ghost {
  background: #616161;
  color: #fff;
}

.ecf__btn--ghost:hover {
  background: #6e6e6e;
}

.ecf__btn--primary {
  background: var(--primary);
  color: #fff;
}

.ecf__btn--primary:hover {
  background: var(--primary-hover);
}
</style>
