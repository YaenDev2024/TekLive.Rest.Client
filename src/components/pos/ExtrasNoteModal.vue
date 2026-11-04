<script setup lang="ts">
/**
 * ExtrasNoteModal · modal de extras + nota (producto normal, Fase 3a).
 * Checkboxes de extras del catálogo + textarea nota. Agregar → addItem
 * (SÍ deduplica: mismo producto + mismos extras + misma nota → qty++).
 */
import { computed, ref, watch } from 'vue'
import type { CatalogExtra, CatalogTemplate } from '../../api/pos-types'
import { useCartStore, type CartExtra } from '../../stores/cart'
import AppModal from './AppModal.vue'

const props = defineProps<{
  template: CatalogTemplate
  extras: CatalogExtra[]
}>()

const emit = defineEmits<{ close: [] }>()

const cart = useCartStore()

const selectedExtraIds = ref<number[]>([])
const note = ref('')

watch(
  () => props.template.id,
  () => {
    selectedExtraIds.value = []
    note.value = ''
  },
)

function toggleExtra(extraId: number): void {
  const index = selectedExtraIds.value.indexOf(extraId)
  if (index === -1) selectedExtraIds.value.push(extraId)
  else selectedExtraIds.value.splice(index, 1)
}

const selectedExtras = computed<CartExtra[]>(() =>
  props.extras
    .filter((e) => selectedExtraIds.value.includes(e.id))
    .map((e) => ({ id: e.id, name: e.name, price: e.price })),
)

const unitPrice = computed<number>(
  () =>
    props.template.basePrice +
    selectedExtras.value.reduce((sum, e) => sum + e.price, 0),
)

function add(): void {
  cart.addItem({
    productId: props.template.id,
    productName: props.template.name,
    basePrice: props.template.basePrice,
    extras: selectedExtras.value,
    complement: null,
    note: note.value,
  })
  emit('close')
}

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`
}
</script>

<template>
  <AppModal :title="template.name" :width="480" @close="emit('close')">
    <div class="ext">
      <p class="ext__base">
        Precio base: <strong>{{ formatMoney(template.basePrice) }}</strong>
      </p>

      <section v-if="extras.length > 0" class="ext__group">
        <h3 class="ext__group-name">Extras</h3>
        <label
          v-for="extra in extras"
          :key="extra.id"
          class="ext__extra"
          :class="{ 'ext__extra--selected': selectedExtraIds.includes(extra.id) }"
        >
          <input
            type="checkbox"
            :checked="selectedExtraIds.includes(extra.id)"
            @change="toggleExtra(extra.id)"
          />
          <span class="ext__extra-name">{{ extra.name }}</span>
          <span v-if="extra.price > 0" class="ext__extra-price">+${{ extra.price }}</span>
        </label>
      </section>
      <p v-else class="ext__empty">Este producto no tiene extras disponibles.</p>

      <label class="ext__note-label" for="ext-note">Nota para cocina (opcional)</label>
      <textarea
        id="ext-note"
        v-model="note"
        class="ext__note"
        rows="2"
        placeholder="Ej. sin pepinillos, envolver para llevar…"
      ></textarea>
    </div>

    <template #footer>
      <div class="ext__footer">
        <span class="ext__total">Total: {{ formatMoney(unitPrice) }}</span>
        <div class="ext__actions">
          <button type="button" class="ext__btn ext__btn--ghost" @click="emit('close')">
            Cancelar
          </button>
          <button type="button" class="ext__btn ext__btn--primary" @click="add">
            Agregar
          </button>
        </div>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
.ext {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ext__base {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.95rem;
}

.ext__base strong {
  color: var(--text);
}

.ext__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ext__group-name {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text);
}

.ext__extra {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.ext__extra:hover {
  border-color: var(--text-faint);
}

.ext__extra--selected {
  border-color: var(--primary);
  background: rgba(255, 87, 34, 0.12);
}

.ext__extra input {
  accent-color: var(--primary);
  width: 16px;
  height: 16px;
}

.ext__extra-name {
  flex: 1;
  color: var(--text);
  font-size: 0.9rem;
  font-weight: 600;
}

.ext__extra-price {
  color: var(--success);
  font-weight: 700;
  font-size: 0.85rem;
}

.ext__empty {
  margin: 0;
  color: var(--text-faint);
  font-size: 0.9rem;
}

.ext__note-label {
  display: block;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.ext__note {
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

.ext__note:focus {
  outline: none;
  border-color: var(--primary);
}

.ext__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.ext__total {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--primary);
}

.ext__actions {
  display: flex;
  gap: 10px;
}

.ext__btn {
  padding: 12px 20px;
  border-radius: var(--radius);
  font-family: var(--font);
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
}

.ext__btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.ext__btn--primary:hover {
  background: var(--primary-hover);
}

.ext__btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-muted);
}

.ext__btn--ghost:hover {
  color: var(--text);
  border-color: var(--text-faint);
}
</style>
