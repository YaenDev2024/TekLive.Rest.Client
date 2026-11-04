<script setup lang="ts">
/**
 * DynamicOptionsModal · modal de opciones dinámicas (Fase 3a).
 *
 * Réplica de dynamic_product_options_screen + DynamicProductProvider:
 * - Respeta minSelect/maxSelect por grupo (bloquea al exceder max).
 * - Reglas condicionales SHOW/HIDE sobre grupos según trigger.
 * - Resumen de selección con sufijo legacy `OPT::Grupo:Valor`.
 * - Precio dinámico en vivo = basePrice + sum(price de valores elegidos).
 * - Agregar → addDynamicItem (NUNCA dedup en el carrito).
 */
import { computed, ref, watch } from 'vue'
import type {
  CatalogOptionGroup,
  CatalogOptionValue,
  CatalogTemplate,
  OrderItemSelectedOption,
} from '../../api/pos-types'
import { cartItemUnitPrice, useCartStore } from '../../stores/cart'
import { AppBanner } from '../ui'
import AppModal from './AppModal.vue'

const props = defineProps<{
  template: CatalogTemplate
}>()

const emit = defineEmits<{ close: [] }>()

const cart = useCartStore()

/** groupId → valueIds seleccionados (grupos multi) / [valueId] (single). */
const selections = ref<Map<number, number[]>>(new Map())
const note = ref('')
const showValidationError = ref(false)

// Reset al cambiar de template (reuso del modal en la misma vista).
watch(
  () => props.template.id,
  () => {
    selections.value = new Map()
    note.value = ''
    showValidationError.value = false
  },
)

function selectedIds(groupId: number): number[] {
  return selections.value.get(groupId) ?? []
}

function isSelected(groupId: number, valueId: number): boolean {
  return selectedIds(groupId).includes(valueId)
}

function toggleValue(group: CatalogOptionGroup, value: CatalogOptionValue): void {
  const current = [...selectedIds(group.id)]
  const index = current.indexOf(value.id)

  if (index !== -1) {
    current.splice(index, 1)
  } else {
    // Bloqueo al exceder maxSelect (réplica selectOptionValue de Flutter).
    if (current.length >= group.maxSelect) return
    // Grupo de selección única: reemplaza.
    if (group.maxSelect === 1) current.splice(0, current.length)
    current.push(value.id)
  }

  if (current.length === 0) selections.value.delete(group.id)
  else selections.value.set(group.id, current)
  showValidationError.value = false
}

/** Grupos visibles aplicando reglas condicionales (réplica getVisibleGroups). */
const visibleGroups = computed<CatalogOptionGroup[]>(() => {
  const rules = props.template.conditionalRules
  return props.template.optionGroups.filter((group) => {
    let shouldShow = true
    for (const rule of rules) {
      if (rule.targetGroupId === group.id) {
        const triggerSelected = (selections.value.get(rule.triggerGroupId) ?? []).length > 0
        if (rule.action === 'HIDE' && triggerSelected) shouldShow = false
        if (rule.action === 'SHOW' && !triggerSelected) shouldShow = false
      }
    }
    return shouldShow
  })
})

/** Precio dinámico por unidad (base + modificadores de valores elegidos). */
const unitPrice = computed<number>(() => {
  let total = props.template.basePrice
  for (const group of props.template.optionGroups) {
    for (const valueId of selectedIds(group.id)) {
      const value = group.values.find((v) => v.id === valueId)
      if (value != null) total += value.price
    }
  }
  return total
})

/** Réplica isFormValid: todos los grupos visibles cumplen min/max. */
const isFormValid = computed<boolean>(() => {
  for (const group of visibleGroups.value) {
    const count = selectedIds(group.id).length
    if (count < group.minSelect) return false
    if (count > group.maxSelect) return false
  }
  return true
})

/** Resumen legible: "Grupo: Valor, Valor" (precio si suma). */
const optionsSummary = computed<string>(() => {
  const parts: string[] = []
  for (const group of props.template.optionGroups) {
    const ids = selectedIds(group.id)
    if (ids.length === 0) continue
    const names = ids.map((id) => {
      const value = group.values.find((v) => v.id === id)
      if (value == null) return ''
      return value.price > 0 ? `${value.name} (+$${value.price})` : value.name
    })
    parts.push(`${group.name}: ${names.filter((n) => n !== '').join(', ')}`)
  }
  return parts.join(' | ')
})

function add(): void {
  if (!isFormValid.value) {
    showValidationError.value = true
    return
  }
  const selectedOptions: OrderItemSelectedOption[] = []
  for (const group of props.template.optionGroups) {
    const ids = selectedIds(group.id)
    if (ids.length > 0) selectedOptions.push({ groupId: group.id, valueIds: ids })
  }

  cart.addDynamicItem({
    productId: props.template.id,
    productName: props.template.name,
    totalPrice: unitPrice.value,
    selectedOptions,
    optionsSummary: optionsSummary.value,
    note: note.value,
  })
  emit('close')
}

function priceLabel(value: CatalogOptionValue): string {
  if (value.price <= 0) return ''
  return `+$${value.price}`
}

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/** Expuesto para tests/QA manuales. */
defineExpose({ isFormValid, unitPrice, cartItemUnitPrice })
</script>

<template>
  <AppModal :title="template.name" :width="560" @close="emit('close')">
    <div class="dyn">
      <p class="dyn__base">
        Precio base: <strong>{{ formatMoney(template.basePrice) }}</strong>
      </p>

      <section
        v-for="group in visibleGroups"
        :key="group.id"
        class="dyn__group"
      >
        <header class="dyn__group-header">
          <h3 class="dyn__group-name">{{ group.name }}</h3>
          <span
            class="dyn__group-badge"
            :class="{ 'dyn__group-badge--required': group.minSelect > 0 }"
          >
            {{ group.minSelect > 0 ? `Obligatorio · elige ${group.minSelect}` : 'Opcional' }}
            <template v-if="group.maxSelect > 1"> · hasta {{ group.maxSelect }}</template>
          </span>
        </header>

        <div class="dyn__values">
          <button
            v-for="value in group.values"
            :key="value.id"
            type="button"
            class="dyn__value"
            :class="{ 'dyn__value--selected': isSelected(group.id, value.id) }"
            :disabled="!isSelected(group.id, value.id) && selectedIds(group.id).length >= group.maxSelect"
            :aria-pressed="isSelected(group.id, value.id)"
            @click="toggleValue(group, value)"
          >
            <span class="dyn__value-name">{{ value.name }}</span>
            <span v-if="priceLabel(value)" class="dyn__value-price">
              {{ priceLabel(value) }}
            </span>
          </button>
        </div>
      </section>

      <div v-if="visibleGroups.length === 0" class="dyn__empty">
        Este producto no tiene opciones adicionales.
      </div>

      <AppBanner v-if="showValidationError && !isFormValid" type="error">
        Completa las opciones obligatorias antes de agregar.
      </AppBanner>

      <label class="dyn__note-label" for="dyn-note">Nota para cocina (opcional)</label>
      <textarea
        id="dyn-note"
        v-model="note"
        class="dyn__note"
        rows="2"
        placeholder="Ej. sin cebolla, término bien cocido…"
      ></textarea>

      <p v-if="optionsSummary" class="dyn__summary" data-testid="dyn-summary">
        <strong>OPT::</strong> {{ optionsSummary }}
      </p>
    </div>

    <template #footer>
      <div class="dyn__footer">
        <span class="dyn__total">Total: {{ formatMoney(unitPrice) }}</span>
        <div class="dyn__actions">
          <button
            type="button"
            class="dyn__btn dyn__btn--ghost"
            @click="emit('close')"
          >
            Cancelar
          </button>
          <button type="button" class="dyn__btn dyn__btn--primary" @click="add">
            Agregar
          </button>
        </div>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
.dyn {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.dyn__base {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.95rem;
}

.dyn__base strong {
  color: var(--text);
}

.dyn__group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dyn__group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.dyn__group-name {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text);
}

.dyn__group-badge {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-faint);
}

.dyn__group-badge--required {
  color: var(--primary);
}

.dyn__values {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.dyn__value {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font);
  font-size: 0.9rem;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.dyn__value:hover:not(:disabled) {
  border-color: var(--text-faint);
}

.dyn__value--selected {
  border-color: var(--primary);
  background: rgba(255, 87, 34, 0.12);
}

.dyn__value:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.dyn__value-name {
  font-weight: 600;
}

.dyn__value-price {
  color: var(--success);
  font-weight: 700;
  font-size: 0.8rem;
}

.dyn__empty {
  color: var(--text-faint);
  font-size: 0.9rem;
}

.dyn__note-label {
  display: block;
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: -8px;
}

.dyn__note {
  width: 100%;
  padding: 10px 12px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font);
  font-size: 0.9rem;
  resize: vertical;
}

.dyn__note:focus {
  outline: none;
  border-color: var(--primary);
}

.dyn__summary {
  margin: 0;
  padding: 8px 10px;
  background: var(--input-bg);
  border-radius: var(--radius);
  font-size: 0.8rem;
  color: var(--text-muted);
  word-break: break-word;
}

.dyn__summary strong {
  color: var(--primary);
}

.dyn__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.dyn__total {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--primary);
}

.dyn__actions {
  display: flex;
  gap: 10px;
}

.dyn__btn {
  padding: 12px 20px;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
}

.dyn__btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.dyn__btn--primary:hover {
  background: var(--primary-hover);
}

.dyn__btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-muted);
}

.dyn__btn--ghost:hover {
  color: var(--text);
  border-color: var(--text-faint);
}
</style>
