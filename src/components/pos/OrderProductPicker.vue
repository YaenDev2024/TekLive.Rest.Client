<script setup lang="ts">
/**
 * OrderProductPicker · picker de productos para agregar items a una orden
 * PENDIENTE (Fase 1-P1 · réplica _ProductPickerDialog de
 * pending_order_card.dart L40-169).
 *
 * - Modal ancho móvil (520px como el .dart): buscador por nombre + tabs
 *   Todos/categorías + lista plana (nombre, precio, icono add teal).
 * - Fuente de datos: catalog store YA CARGADO del POS (fetch-once con caché
 *   por planta). Si la store está vacía (p.ej. entraron directo a Órdenes y
 *   nunca montaron PosPiso1View), carga el catálogo del piso 1 aquí —
 *   EXACTAMENTE lo que hace el Flutter (menuProvider.fetchData si
 *   categories.isEmpty, L253-259).
 * - Al tocar un producto: si el template tiene optionGroups → abre el MISMO
 *   DynamicOptionsModal del POS (réplica del flujo Flutter L263-281:
 *   showDialog picker → showDialog wizard → item). Si NO tiene grupos →
 *   agrega directo quantity 1 (el backend recalcula el precio).
 * - Intercepción del wizard: el wizard del POS SIEMPRE agrega al carrito
 *   local (cart.addDynamicItem — comportamiento intacto, no se toca). Este
 *   picker registra las keys del carrito ANTES de abrir el wizard; al
 *   cerrarse, si apareció una línea dinámica nueva del template → fue
 *   Confirmar: se extrae (selectedOptions + summary), se REMUEVE del carrito
 *   local (el item va a la orden remota, no a la venta en curso) y se emite
 *   `added`. Si no apareció → el usuario canceló (X/ESC) y no se hace nada.
 * - Extras standalone: OMITIDOS en ronda 1 (viven en la tab EXTRAS del
 *   carrito del POS; el picker solo agrega productos del menú).
 *
 * El picker NUNCA llama a la API de items: emite `added` con el payload
 * armado y la vista (PendingOrdersView) hace el POST — misma separación que
 * CancelOrderModal/CheckoutModal.
 */
import { computed, onMounted, ref } from 'vue'
import { CirclePlus, Info, Search, Soup } from 'lucide-vue-next'
import type {
  CatalogTemplate,
  OrderItemPayload,
  OrderItemSelectedOption,
} from '../../api/pos-types'
import { POS_PLANT_ID, useCatalogStore } from '../../stores/catalog'
import { useCartStore } from '../../stores/cart'
import AppModal from './AppModal.vue'
import AppSpinner from '../ui/AppSpinner.vue'
import AppBanner from '../ui/AppBanner.vue'
import DynamicOptionsModal from './DynamicOptionsModal.vue'

const emit = defineEmits<{ close: []; added: [payload: OrderItemPayload, name: string] }>()

const catalog = useCatalogStore()
const cart = useCartStore()

// --- Búsqueda + categoría (réplica _searchQuery / _productsForCategory) ------

const searchText = ref('')
/** null = Todos; >0 = categoryId (la tab EXTRAS del .dart no aplica aquí). */
const selectedCategoryId = ref<number | null>(null)

const categories = computed(() => catalog.catalog?.categories ?? [])

const filteredTemplates = computed<CatalogTemplate[]>(() => {
  const list = catalog.catalog?.templates ?? []
  const query = searchText.value.trim().toLowerCase()
  return list.filter((t) => {
    const byCategory =
      selectedCategoryId.value == null || t.categoryId === selectedCategoryId.value
    const bySearch = query === '' || t.name.toLowerCase().includes(query)
    return byCategory && bySearch
  })
})

// --- Wizard dinámico (réplica DynamicProductWizardDialog returnItem) ---------

/** Template con wizard abierto (null = cerrado). */
const wizardTemplate = ref<CatalogTemplate | null>(null)
/** Keys del carrito al momento de abrir el wizard (para detectar el insert). */
const wizardBaselineKeys = ref<Set<string>>(new Set())

/** Tap en producto de la lista (réplica Navigator.pop(product) → wizard). */
function onProductClick(template: CatalogTemplate): void {
  if (template.optionGroups.length > 0) {
    // Con grupos: el MISMO wizard del POS arma las selecciones y el resumen.
    wizardBaselineKeys.value = new Set(cart.items.map((it) => it.key))
    wizardTemplate.value = template
    return
  }
  // Sin grupos: directo (el wizard Flutter con 0 grupos obligatorios solo
  // mostraba el paso único; el original agregaba quantity 1 sin opciones).
  emitAdded(template, [], '')
}

/**
 * Cierre del wizard: si el wizard insertó una línea dinámica nueva del
 * template → fue Confirmar (el wizard llama cart.addDynamicItem ANTES de
 * emit('close')). Se extrae, se remueve del carrito y se emite.
 */
function onWizardClose(): void {
  const template = wizardTemplate.value
  if (template == null) return
  wizardTemplate.value = null
  const inserted = cart.items.find(
    (it) => !wizardBaselineKeys.value.has(it.key) && it.productId === template.id && it.selectedOptions != null,
  )
  if (inserted == null) return // canceló: X / ESC / click fuera
  cart.removeItem(inserted.key)
  emitAdded(
    template,
    inserted.selectedOptions ?? [],
    inserted.dynamicOptionsSummary ?? '',
  )
}

function emitAdded(
  template: CatalogTemplate,
  selectedOptions: OrderItemSelectedOption[],
  summary: string,
): void {
  // Nota réplica Flutter (notesToSave L285-289): 'OPT::summary' si hay resumen.
  const trimmed = summary.trim()
  const notes = trimmed !== '' ? `OPT::${trimmed}` : undefined
  const payload: OrderItemPayload = {
    productId: template.id,
    quantity: 1,
    ...(notes != null ? { notes } : {}),
    extras: [],
    complements: [],
    // selectedOptions solo aplica a templates con grupos (contrato backend:
    // SelectedOptions del RestOrderItemRequest).
    ...(selectedOptions.length > 0 ? { selectedOptions } : {}),
  }
  emit('added', payload, template.name)
}

onMounted(() => {
  // Catálogo YA cargado (caché fetch-once). Si está vacío (entraron directo a
  // Órdenes), carga el del piso 1 — réplica menuProvider.fetchData L253-259.
  if (!catalog.hasCacheForPlant(POS_PLANT_ID)) {
    void catalog.fetchCatalog(POS_PLANT_ID)
  }
})

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`
}
</script>

<template>
  <!-- Wizard de opciones ENCIMA del picker (cuando hay template con grupos):
       réplica de los 2 showDialog secuenciales del Flutter. El wizard cubre
       toda la pantalla (overlay propio); al cerrarse vuelve el picker. -->
  <DynamicOptionsModal
    v-if="wizardTemplate != null"
    :template="wizardTemplate"
    @close="onWizardClose"
  />

  <AppModal
    v-else
    title="Agregar producto a la orden"
    :width="520"
    @close="emit('close')"
  >
    <div class="picker">
      <AppSpinner v-if="catalog.loading && catalog.catalog == null" :size="24" tone="primary" />
      <AppBanner v-else-if="catalog.error" type="error">{{ catalog.error }}</AppBanner>

      <template v-else>
        <div class="picker__search">
          <Search :size="16" class="picker__search-icon" aria-hidden="true" />
          <input
            v-model="searchText"
            type="text"
            class="picker__search-input"
            placeholder="Buscar producto..."
            aria-label="Buscar producto"
            data-testid="picker-search"
          />
        </div>

        <!-- Tabs Todos / categorías (réplica TabBar L108-114) -->
        <nav class="picker__tabs" role="tablist" aria-label="Categorías">
          <button
            type="button"
            role="tab"
            class="picker__tab"
            :class="{ 'picker__tab--active': selectedCategoryId === null }"
            :aria-selected="selectedCategoryId === null"
            @click="selectedCategoryId = null"
          >
            Todos
          </button>
          <button
            v-for="cat in categories"
            :key="cat.id"
            type="button"
            role="tab"
            class="picker__tab"
            :class="{ 'picker__tab--active': selectedCategoryId === cat.id }"
            :aria-selected="selectedCategoryId === cat.id"
            @click="selectedCategoryId = cat.id"
          >
            {{ cat.name }}
          </button>
        </nav>

        <!-- Lista plana (réplica ListView.separated L151-166) -->
        <div v-if="filteredTemplates.length === 0" class="picker__empty">
          <Info :size="40" class="picker__empty-icon" aria-hidden="true" />
          <p>No se encontraron productos</p>
        </div>
        <ul v-else class="picker__list" data-testid="picker-list">
          <li v-for="t in filteredTemplates" :key="t.id">
            <button
              type="button"
              class="picker__item"
              :data-testid="`picker-item-${t.id}`"
              @click="onProductClick(t)"
            >
              <span class="picker__item-media">
                <Soup :size="24" aria-hidden="true" />
              </span>
              <span class="picker__item-info">
                <span class="picker__item-name">{{ t.name }}</span>
                <span class="picker__item-price">{{ formatMoney(t.basePrice) }}</span>
              </span>
              <CirclePlus :size="20" class="picker__item-add" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </template>
    </div>

    <template #footer>
      <button
        type="button"
        class="picker__btn"
        @click="emit('close')"
      >
        Cancelar
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 200px;
}

/* Buscador (réplica TextField L100-106, fill #212121 radius 8) */
.picker__search {
  position: relative;
}

.picker__search-icon {
  position: absolute;
  top: 50%;
  left: 10px;
  transform: translateY(-50%);
  color: var(--text-faint);
  pointer-events: none;
}

.picker__search-input {
  width: 100%;
  padding: 9px 10px 9px 32px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-family: var(--font);
  font-size: 14px;
  outline: none;
}

.picker__search-input:focus {
  border-color: var(--primary);
}

/* Tabs (réplica TabBar scrollable con underline) */
.picker__tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border-soft);
}

.picker__tab {
  flex: none;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  font-family: var(--font);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.picker__tab--active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

/* Lista (ListView.separated denso) */
.picker__list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 340px;
  overflow-y: auto;
}

.picker__item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 8px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-soft);
  color: var(--text);
  font-family: var(--font);
  text-align: left;
  cursor: pointer;
}

.picker__item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.picker__item-media {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-faint);
}

.picker__item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.picker__item-name {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker__item-price {
  font-size: 13px;
  color: var(--primary);
  font-weight: 700;
}

.picker__item-add {
  flex: none;
  color: #26a69a; /* teal (trailing add_circle del .dart) */
}

.picker__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px 16px;
  color: var(--text-muted);
}

.picker__empty-icon {
  color: var(--text-faint);
}

.picker__empty p {
  margin: 0;
}

.picker__btn {
  padding: 10px 20px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-family: var(--font);
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
}

.picker__btn:hover {
  color: var(--text);
  border-color: var(--text-faint);
}
</style>
