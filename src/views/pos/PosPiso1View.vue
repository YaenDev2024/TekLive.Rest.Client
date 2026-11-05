<script setup lang="ts">
/**
 * PosPiso1View · vista VENDER del POS desktop (Fase 3 ronda 2 — réplica exacta).
 *
 * Copia PIXEL-FIEL del POS Piso 1 de CrazyWings Flutter:
 * - pos_view.dart:      Row = MenuContent (Expanded) + OrderPanel (290px fijo)
 * - menu_content.dart:  header (título+fecha izq / búsqueda der), TabBar
 *                       scrollable horizontal (TODO · categorías · EXTRAS),
 *                       divider white24, grid responsivo 3/4/5 columnas
 * - ProductCard REAL    (menu_content.dart L316-411, el que usa el grid del
 *                       POS vía L302): Card #303030 radius 12 elev 2, Column
 *                       stretch → imagen flex 3 (ClipRRect top 12, cover, si
 *                       falla icono fastfood 46 grey[700]) + info flex 2
 *                       (padding 12h/8v, spaceEvenly: nombre bold 13 blanco
 *                       centrado 2 líneas + precio deepOrange bold 13).
 *                       SIN botón Add: el click en el CARD abre el modal.
 * - ExtraCard           (menu_content.dart L413-524): top flex 3 deepOrange
 *                       alpha 0.1 + icono local_dining 60 deepOrange; bottom
 *                       flex 2 nombre bold 14 + precio deepOrange bold 14.
 *                       Tap AGREGA DIRECTO al carrito + SnackBar 2s.
 * - order_panel.dart:   "Orden Actual" centrado, items 50px, totales, footer
 *                       radius-top con botones Proceder al Pago / Pendiente.
 *                       SIN botón de reloj (el acceso a pendientes es SOLO
 *                       por el rail → Órdenes; réplica exacta del panel).
 *
 * Lógica de carrito/checkout/pendientes intacta (stores + modales Fase 3).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { Soup, Info, Search, Trash2, Utensils, CircleMinus, CirclePlus } from 'lucide-vue-next'
import type { CatalogExtra, CatalogTemplate } from '../../api/pos-types'
import { POS_PLANT_ID, useCatalogStore } from '../../stores/catalog'
import { cartItemUnitPrice, useCartStore } from '../../stores/cart'
import { useOrdersStore } from '../../stores/orders'
import { useToastStore } from '../../stores/toast'
import { session } from '../../services/auth'
import { AppBanner, AppButton, AppSpinner } from '../../components/ui'
import DynamicOptionsModal from '../../components/pos/DynamicOptionsModal.vue'
import ExtrasNoteModal from '../../components/pos/ExtrasNoteModal.vue'
import CheckoutModal from '../../components/pos/CheckoutModal.vue'

const catalog = useCatalogStore()
const cart = useCartStore()
const ordersStore = useOrdersStore()
const toast = useToastStore()

// --- Catálogo ---------------------------------------------------------------

const gridWrap = ref<HTMLElement | null>(null)
const gridWidth = ref(0)

function onGridWrapResize(): void {
  if (gridWrap.value != null) gridWidth.value = gridWrap.value.clientWidth
}

/** Réplica LayoutBuilder menu_content.dart: <900→3 | <1200→4 | else→5 columnas. */
const gridColumns = computed<number>(() => {
  if (gridWidth.value < 900) return 3
  if (gridWidth.value < 1200) return 4
  return 5
})

let gridObserver: ResizeObserver | null = null

onMounted(() => {
  void catalog.fetchCatalog(POS_PLANT_ID)
  // Flutter mide el ancho del CONTENEDOR (LayoutBuilder), no la ventana:
  // con panel de 290px fijo, contenedor = viewport − 290. ResizeObserver
  // porque el wrap solo existe cuando el catálogo termina de cargar.
  gridObserver = new ResizeObserver(onGridWrapResize)
})

onBeforeUnmount(() => {
  gridObserver?.disconnect()
  gridObserver = null
})

/** Observa el wrap cuando aparece en el DOM (v-else-if tras el fetch). */
function onGridWrapRef(el: Element | ComponentPublicInstance | null): void {
  const node = el instanceof HTMLElement ? el : null
  gridWrap.value = node
  if (gridObserver != null && node != null) {
    gridObserver.disconnect()
    gridObserver.observe(node)
    onGridWrapResize()
  }
}

/** null = TODO; -1 = tab EXTRAS; >0 = categoryId real. */
type MenuTab = number | null
const EXTRAS_TAB = -1

const selectedCategoryId = ref<MenuTab>(null)
const isExtrasTab = computed(() => selectedCategoryId.value === EXTRAS_TAB)

// --- Búsqueda (replica MenuProvider.search: nombre contiene, case-insensitive)

const searchText = ref('')

// --- Fecha formateada (replica DateFormat('EEEE, d MMMM yyyy', 'es_ES')) -----

const currentDate = computed(() => {
  const formatted = new Intl.DateTimeFormat('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date())
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
})

// --- Filtrado (categoría + búsqueda, replica MenuProvider) --------------------

const filteredTemplates = computed<CatalogTemplate[]>(() => {
  const list = catalog.catalog?.templates ?? []
  const query = searchText.value.trim().toLowerCase()
  return list.filter((t) => {
    const byCategory = selectedCategoryId.value == null || selectedCategoryId.value < 0
      || t.categoryId === selectedCategoryId.value
    const bySearch = query === '' || t.name.toLowerCase().includes(query)
    return byCategory && bySearch
  })
})

const filteredExtras = computed<CatalogExtra[]>(() => catalog.catalog?.extras ?? [])

// --- Modales ----------------------------------------------------------------

type ModalState =
  | { kind: 'none' }
  | { kind: 'dynamic'; template: CatalogTemplate }
  | { kind: 'extras'; template: CatalogTemplate }
  | { kind: 'checkout' }

const modal = ref<ModalState>({ kind: 'none' })

function onProductClick(template: CatalogTemplate): void {
  if (template.optionGroups.length > 0) {
    modal.value = { kind: 'dynamic', template }
  } else {
    modal.value = { kind: 'extras', template }
  }
}

/**
 * Fallback de imagen (réplica errorBuilder de Image.network L350-354): si la
 * imagen falla, muestra el icono fastfood 46px grey[700]. Se marca hasImage
 * localmente en false para que el icono tome el lugar del <img> roto.
 */
const brokenImageIds = ref<Set<number>>(new Set())
function onImageError(event: Event): void {
  const img = event.target as HTMLImageElement
  const match = img.src.match(/templates\/(\d+)\/image/)
  if (match != null) {
    const id = Number(match[1])
    if (!brokenImageIds.value.has(id)) {
      const next = new Set(brokenImageIds.value)
      next.add(id)
      brokenImageIds.value = next
    }
  }
}

/**
 * Réplica de _handleExtraTap (menu_content.dart L500): el Flutter agrega el
 * extra como PRODUCTO standalone (productId = extra.id) + SnackBar. Nuestro
 * backend resuelve productId SIEMPRE contra REST_PRODUCT_TEMPLATES y los
 * ID_EXTRAS locales (1..3) COLISIONAN con templates (1..6) — mandar el extra
 * como productId crearía una orden con productos equivocados.
 *
 * Solución sin tocar backend: ítem standalone con productId = null y el extra
 * viaja en `extras` (líneas: rest_extras_order_items, precio resuelto por el
 * backend desde REST_EXTRAS — verificado en PriceItemsAsync). El carrito
 * trata productId null como ítem de solo-extras (su precio vive 100% en
 * extras y el backend lo recalcula igual).
 */
function onExtraClick(extra: CatalogExtra): void {
  cart.addItem({
    productId: null,
    productName: extra.name,
    basePrice: 0,
    extras: [{ id: extra.id, name: extra.name, price: extra.price }],
    complement: null,
    note: '',
  })
  toast.success(`${extra.name} agregado a la orden`)
}

/** "Pendiente": crear orden sin payment → toast con folio. */
const pendingSubmitting = ref(false)

async function submitAsPending(): Promise<void> {
  if (cart.isEmpty || pendingSubmitting.value) return
  pendingSubmitting.value = true
  try {
    const created = await ordersStore.submitOrder(
      {
        plantId: POS_PLANT_ID,
        sucursalId: 1,
        tableId: 1,
        orderType: cart.orderType,
        items: cart.toOrderItems(),
      },
      session.displayName ?? 'Cajero',
    )
    toast.success(`Orden pendiente #${created.dailyOrderNumber} creada`)
    cart.clear()
  } catch {
    toast.error('No se pudo crear la orden pendiente. Intenta de nuevo.')
  } finally {
    pendingSubmitting.value = false
  }
}

// --- Formato ----------------------------------------------------------------

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`
}

function itemSubtitle(summary: string | null, note: string, extrasCount: number): string {
  const parts: string[] = []
  if (summary != null && summary !== '') parts.push(summary)
  if (extrasCount > 0) parts.push(`+${extrasCount} extra(s)`)
  if (note !== '') parts.push(`Nota: ${note}`)
  return parts.join(' · ')
}

/** Gate de caja: TODO(cash-round-2) — cart.canSell enchufará la sesión. */
const canSell = computed(() => cart.canSell)
</script>

<template>
  <div class="pos">
    <!-- Estado catálogo (mantiene loading/error de la Fase 3) -->
    <div v-if="catalog.loading" class="pos-state">
      <AppSpinner :size="32" tone="primary" />
      <p>Cargando catálogo…</p>
    </div>

    <div v-else-if="catalog.error" class="pos-state">
      <AppBanner type="error">{{ catalog.error }}</AppBanner>
      <AppButton variant="ghost" :block="false" @click="catalog.refetchCatalog()">
        Reintentar
      </AppButton>
    </div>

    <!-- Layout raíz: Row = MenuContent(expandible) + OrderPanel(290px) -->
    <div v-else-if="catalog.catalog" class="pos-body">
      <!-- ================= MENUCONTENT ================= -->
      <section class="menu" aria-label="Menú">
        <!-- Header: título+fecha izquierda, búsqueda derecha -->
        <header class="menu-header">
          <div class="menu-header-text">
            <h1 class="menu-title">Crazy Wings</h1>
            <span class="menu-date">{{ currentDate }}</span>
          </div>
          <div class="menu-search">
            <Search :size="14" class="menu-search-icon" aria-hidden="true" />
            <input
              v-model="searchText"
              type="text"
              class="menu-search-input"
              placeholder="Buscar comida, combo, etc..."
              aria-label="Buscar comida, combo, etc"
              data-testid="menu-search"
            />
          </div>
        </header>

        <!-- TabBar scrollable horizontal -->
        <nav class="menu-tabs" aria-label="Categorías">
          <div class="menu-tabs-scroll" role="tablist">
            <button
              type="button"
              role="tab"
              class="menu-tab"
              :class="{ 'menu-tab--active': selectedCategoryId === null }"
              :aria-selected="selectedCategoryId === null"
              @click="selectedCategoryId = null"
            >
              TODO
            </button>
            <button
              v-for="category in catalog.catalog.categories"
              :key="category.id"
              type="button"
              role="tab"
              class="menu-tab"
              :class="{ 'menu-tab--active': selectedCategoryId === category.id }"
              :aria-selected="selectedCategoryId === category.id"
              @click="selectedCategoryId = category.id"
            >
              {{ category.name }}
            </button>
            <button
              type="button"
              role="tab"
              class="menu-tab"
              :class="{ 'menu-tab--active': isExtrasTab }"
              :aria-selected="isExtrasTab"
              data-testid="extras-tab"
              @click="selectedCategoryId = EXTRAS_TAB"
            >
              EXTRAS
            </button>
          </div>
        </nav>
        <div class="menu-divider" aria-hidden="true"></div>

        <!-- Grid: extras (tab EXTRAS) o productos -->
        <div
          :ref="onGridWrapRef"
          class="menu-grid-wrap"
          data-testid="product-grid"
        >
          <!-- GRID EXTRAS (ExtraCard de menu_content.dart) -->
          <div
            v-if="isExtrasTab"
            class="menu-grid"
            :style="{ gridTemplateColumns: `repeat(${gridColumns}, 1fr)` }"
            data-testid="extras-grid"
          >
            <button
              v-for="extra in filteredExtras"
              :key="`extra-${extra.id}`"
              type="button"
              class="extra-card"
              :data-testid="`extra-${extra.id}`"
              @click="onExtraClick(extra)"
            >
              <span class="extra-card-top">
                <Utensils :size="60" class="extra-card-icon" aria-hidden="true" />
              </span>
              <span class="extra-card-bottom">
                <span class="extra-card-name">{{ extra.name }}</span>
                <span class="extra-card-price">{{ formatMoney(extra.price) }}</span>
              </span>
            </button>
          </div>
          <div v-else-if="isExtrasTab && filteredExtras.length === 0" class="menu-empty">
            <Info :size="64" class="menu-empty-icon" />
            <p>No hay extras disponibles.</p>
          </div>

          <!-- GRID PRODUCTOS (ProductCard REAL de menu_content.dart L316-411) -->
          <div
            v-else
            class="menu-grid"
            :style="{ gridTemplateColumns: `repeat(${gridColumns}, 1fr)` }"
          >
            <div
              v-for="template in filteredTemplates"
              :key="template.id"
              class="product-card"
              :data-testid="`product-${template.id}`"
              role="button"
              tabindex="0"
              @click="onProductClick(template)"
              @keydown.enter="onProductClick(template)"
              @keydown.space.prevent="onProductClick(template)"
            >
              <!-- flex 3: imagen cover con esquinas superiores 12; fallback fastfood -->
              <span class="product-media">
                <img
                  v-if="template.hasImage && !brokenImageIds.has(template.id)"
                  :src="`/api/rest/catalog/templates/${template.id}/image`"
                  alt=""
                  loading="lazy"
                  @error="onImageError"
                />
                <Soup v-else :size="46" class="product-media-icon" aria-hidden="true" />
              </span>
              <!-- flex 2: nombre bold 13 blanco centrado + precio deepOrange bold 13 -->
              <span class="product-info">
                <span class="product-name">{{ template.name }}</span>
                <span class="product-price">{{ formatMoney(template.basePrice) }}</span>
              </span>
            </div>
          </div>
          <div
            v-if="!isExtrasTab && filteredTemplates.length === 0"
            class="menu-empty"
          >
            No se encontraron productos.
          </div>
        </div>
      </section>

      <!-- ================= ORDER PANEL (290px) ================= -->
      <aside class="order-panel" data-testid="order-panel">
        <!-- Header: título centrado (réplica order_panel.dart; el acceso a
             pendientes es SOLO por el rail → Órdenes) -->
        <div class="op-header">
          <h2 class="op-title">Orden Actual</h2>
        </div>

        <div class="op-divider" aria-hidden="true"></div>

        <!-- Lista de items (réplica OrderListItem) -->
        <div v-if="cart.isEmpty" class="op-empty">
          La orden está vacía.
        </div>
        <ul v-else class="op-items" data-testid="cart-items">
          <li v-for="item in cart.lines" :key="item.key" class="op-item">
            <div class="op-item-top">
              <span class="op-item-name">{{ item.productName }}</span>
              <span
                v-if="itemSubtitle(item.dynamicOptionsSummary, item.note, item.extras.length)"
                class="op-item-sub"
              >
                {{ itemSubtitle(item.dynamicOptionsSummary, item.note, item.extras.length) }}
              </span>
            </div>
            <div class="op-item-controls">
              <span class="op-item-price" data-testid="cart-line-total">
                {{ formatMoney(cartItemUnitPrice(item) * item.quantity) }}
              </span>
              <button
                type="button"
                class="op-qty"
                :aria-label="`Quitar uno de ${item.productName}`"
                @click="cart.decrementItem(item.key)"
              >
                <CircleMinus :size="20" />
              </button>
              <span class="op-qty-num">{{ item.quantity }}</span>
              <button
                type="button"
                class="op-qty"
                :aria-label="`Agregar uno de ${item.productName}`"
                @click="cart.incrementItem(item.key)"
              >
                <CirclePlus :size="20" />
              </button>
              <button
                type="button"
                class="op-qty op-qty--danger"
                :aria-label="`Eliminar ${item.productName}`"
                @click="cart.removeItem(item.key)"
              >
                <Trash2 :size="16" />
              </button>
            </div>
          </li>
        </ul>

        <!-- Footer con totales + acciones (réplica footer order_panel) -->
        <footer class="op-footer">
          <div class="op-total">
            <span class="op-total-label">Total</span>
            <span class="op-total-value" data-testid="cart-total">{{ formatMoney(cart.total) }}</span>
          </div>
          <div class="op-actions">
            <button
              type="button"
              class="op-btn op-btn--ghost"
              :disabled="cart.isEmpty || pendingSubmitting"
              data-testid="submit-pending"
              @click="submitAsPending"
            >
              {{ pendingSubmitting ? 'Guardando…' : 'Pendiente' }}
            </button>
            <button
              type="button"
              class="op-btn op-btn--primary"
              :disabled="cart.isEmpty || !canSell"
              data-testid="open-checkout"
              @click="modal = { kind: 'checkout' }"
            >
              Cobrar
            </button>
          </div>
        </footer>
      </aside>
    </div>

    <!-- Modales (intactos de Fase 3) -->
    <DynamicOptionsModal
      v-if="modal.kind === 'dynamic'"
      :template="modal.template"
      @close="modal = { kind: 'none' }"
    />
    <ExtrasNoteModal
      v-if="modal.kind === 'extras'"
      :template="modal.template"
      :extras="catalog.catalog?.extras ?? []"
      @close="modal = { kind: 'none' }"
    />
    <CheckoutModal
      v-if="modal.kind === 'checkout'"
      @close="modal = { kind: 'none' }"
    />
  </div>
</template>

<style scoped>
/* ==========================================================================
   Layout raíz (pos_view.dart): Row → menú flexible + panel 290px fijo
   ========================================================================== */
.pos {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
}

.pos-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 80px 24px;
  color: var(--text-muted);
}

.pos-body {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
}

/* ==========================================================================
   MENU CONTENT (menu_content.dart)
   ========================================================================== */
.menu {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* Header (padding 10 como Flutter; sin back: la navegación es por el rail) */
.menu-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 10px;
}

.menu-header-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.menu-title {
  margin: 0;
  font-size: 28px;
  line-height: 1.2;
  font-weight: 700;
  color: var(--text);
  letter-spacing: 0;
}

.menu-date {
  font-size: 10px;
  color: var(--text-muted);
}

.menu-search {
  position: relative;
  width: 170px;
  flex: none;
}

.menu-search-icon {
  position: absolute;
  top: 50%;
  left: 8px;
  transform: translateY(-50%);
  color: var(--text-faint);
  pointer-events: none;
}

.menu-search-input {
  width: 100%;
  padding: 5px 8px 5px 26px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font);
  font-size: 11px;
  outline: none;
  transition: border-color 0.15s ease;
}

.menu-search-input::placeholder {
  color: var(--text-faint);
  font-size: 10px;
}

.menu-search-input:focus {
  border-color: var(--primary);
}

/* TabBar scrollable horizontal con underline deepOrange */
.menu-tabs {
  padding: 0 10px;
}

.menu-tabs-scroll {
  display: flex;
  gap: 0;
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-width: none;
}

.menu-tabs-scroll::-webkit-scrollbar {
  display: none;
}

.menu-tab {
  flex: none;
  padding: 10px 6px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text);
  font-family: var(--font);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.menu-tab:hover {
  color: var(--primary-hover);
}

.menu-tab--active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

/* Divider white24 bajo tabs (Divider(height:1, thickness:1, white24)) */
.menu-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.24);
  margin: 0 10px;
}

/* Grid responsivo por ancho de contenedor: <900→3 | <1200→4 | else→5 */
.menu-grid-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  min-height: 0;
}

.menu-grid {
  display: grid;
  gap: 12px;
}

.menu-empty {
  padding: 40px 24px;
  text-align: center;
  color: var(--text-faint);
}

/* ==========================================================================
   PRODUCT CARD (ProductCard REAL de menu_content.dart L316-411)
   Card #303030 radius 12 elev 2 → Column stretch:
   - flex 3: ClipRRect top 12 imagen cover; fallback fastfood 46 grey[700]
   - flex 2: padding 12h/8v spaceEvenly: nombre bold 13 blanco centrado
     (max 2 líneas ellipsis) + precio deepOrange bold 13.
   SIN botón Add: el click en cualquier parte del card abre el modal.
   ========================================================================== */
.product-card {
  aspect-ratio: 0.95;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-surface);
  border-radius: var(--radius);
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.3),
    0 1px 2px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  user-select: none;
  transition:
    filter 0.15s ease,
    box-shadow 0.15s ease;
}

.product-card:hover {
  filter: brightness(1.15);
  box-shadow:
    0 2px 6px rgba(0, 0, 0, 0.35),
    0 1px 3px rgba(0, 0, 0, 0.2);
}

.product-card:active {
  background: var(--primary);
}

/* flex 3: media cuadrada arriba (imagen cover o icono fastfood grey[700]) */
.product-media {
  flex: 3;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #303030;
  border-radius: 12px 12px 0 0;
  overflow: hidden;
}

.product-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.product-media-icon {
  color: #616161; /* Colors.grey[700] (errorBuilder L353) */
}

/* flex 2: info padding 12h/8v, spaceEvenly centrado */
.product-info {
  flex: 2;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-evenly;
  padding: 8px 12px;
}

.product-name {
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.25;
  text-align: center;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Precio deepOrange bold (theme.colorScheme.primary, L381) */
.product-price {
  color: var(--primary);
  font-size: 13px;
  font-weight: 700;
}

/* ==========================================================================
   EXTRA CARD (menu_content.dart L413-524)
   Top flex 3 con deepOrange alpha 0.1 + icono local_dining 60; bottom flex 2:
   nombre bold 14 blanco centrado, gap 8, precio deepOrange bold 14, gap 4,
   categoryName gris alpha 0.7 (omitida: el catálogo Rest no trae categoryName
   en CatalogExtra, solo CategoryId).
   ========================================================================== */
.extra-card {
  aspect-ratio: 0.95;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
  background: var(--bg-surface);
  border: none;
  border-radius: var(--radius);
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.3),
    0 1px 2px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  text-align: center;
  transition: filter 0.15s ease;
}

.extra-card:hover {
  filter: brightness(1.15);
}

.extra-card-top {
  flex: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 87, 34, 0.1);
  border-radius: 12px 12px 0 0;
}

.extra-card-icon {
  color: var(--primary);
}

.extra-card-bottom {
  flex: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12px;
}

.extra-card-name {
  color: var(--text);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* SizedBox(height: 8) entre nombre y precio (L473) */
.extra-card-price {
  margin-top: 8px;
  color: var(--primary);
  font-size: 14px;
  font-weight: 700;
}

/* SizedBox(height: 4) antes de categoryName (L482) — omitida por contrato */
.extra-card-category {
  margin-top: 4px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
}

/* ==========================================================================
   ORDER PANEL (order_panel.dart) — 290px exactos
   ========================================================================== */
.order-panel {
  width: 290px;
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: rgba(48, 48, 48, 0.98);
}

.op-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 12px 8px;
}

.op-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.op-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.24);
}

/* Items (OrderListItem: nombre+precio izq, total der, qty abajo) */
.op-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text);
  font-size: 16px;
  font-weight: 600;
  padding: 16px;
  text-align: center;
}

.op-items {
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 8px 16px;
  list-style: none;
  display: flex;
  flex-direction: column;
}

.op-item {
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.op-item:last-child {
  border-bottom: none;
}

.op-item-top {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.op-item-name {
  color: var(--text);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.3;
}

.op-item-sub {
  color: var(--text-faint);
  font-size: 0.72rem;
  font-style: italic;
  word-break: break-word;
}

.op-item-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
}

.op-item-price {
  flex: 1;
  color: var(--text);
  font-size: 0.95rem;
  font-weight: 700;
}

.op-qty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: color 0.15s ease;
}

.op-qty:hover {
  color: var(--text);
}

.op-qty--danger:hover {
  color: var(--error);
}

.op-qty-num {
  min-width: 20px;
  text-align: center;
  color: var(--text);
  font-weight: 700;
  font-size: 15px;
}

/* Footer (Container radius-top 16, border-top grey[800]) */
.op-footer {
  padding: 16px 16px 14px;
  background: var(--bg-surface);
  border-radius: 16px 16px 0 0;
  border-top: 1px solid #424242;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.op-total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.op-total-label {
  color: var(--text-muted);
  font-size: 16px;
}

.op-total-value {
  color: var(--primary);
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
}

.op-actions {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 10px;
}

.op-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 12px 16px;
  border-radius: var(--radius);
  border: 1px solid transparent;
  font-family: var(--font);
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.op-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.op-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.op-btn--primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.op-btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-muted);
}

.op-btn--ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
  background: var(--card-overlay);
}

.op-btn--ghost:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Responsive: bajo 1024px el panel puede envolver (POS es desktop-first) */
@media (max-width: 1024px) {
  .pos-body {
    flex-direction: column;
  }

  .order-panel {
    width: 100%;
    border-top: 1px solid var(--border-soft);
  }

  .menu-grid-wrap {
    padding: 8px;
  }
}
</style>
