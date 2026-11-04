<script setup lang="ts">
/**
 * PosPiso1View · shell del POS desktop (Fase 3a+3b).
 *
 * Réplica del POS P1 de CrazyWings: selector de categorías (izquierda) +
 * grid de productos (centro) + panel carrito (derecha). Modales: opciones
 * dinámicas (templates con optionGroups), extras+nota, checkout, pendientes.
 * Desktop-first, mínimo 1024px (POS de caja).
 */
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { Clock, Minus, Plus, Trash2 } from 'lucide-vue-next'
import type { CatalogTemplate } from '../../api/pos-types'
import { POS_PLANT_ID, useCatalogStore } from '../../stores/catalog'
import { cartItemUnitPrice, useCartStore } from '../../stores/cart'
import { useOrdersStore } from '../../stores/orders'
import { useToastStore } from '../../stores/toast'
import { session } from '../../services/auth'
import { AppBanner, AppButton, AppSpinner } from '../../components/ui'
import DynamicOptionsModal from '../../components/pos/DynamicOptionsModal.vue'
import ExtrasNoteModal from '../../components/pos/ExtrasNoteModal.vue'
import CheckoutModal from '../../components/pos/CheckoutModal.vue'
import PendingOrdersView from './PendingOrdersView.vue'

const catalog = useCatalogStore()
const cart = useCartStore()
const ordersStore = useOrdersStore()
const toast = useToastStore()

// --- Catálogo ---------------------------------------------------------------

onMounted(() => {
  void catalog.fetchCatalog(POS_PLANT_ID)
})

const selectedCategoryId = ref<number | null>(null)

const filteredTemplates = computed<CatalogTemplate[]>(() => {
  const list = catalog.catalog?.templates ?? []
  if (selectedCategoryId.value == null) return list
  return list.filter((t) => t.categoryId === selectedCategoryId.value)
})

// --- Modales ----------------------------------------------------------------

type ModalState =
  | { kind: 'none' }
  | { kind: 'dynamic'; template: CatalogTemplate }
  | { kind: 'extras'; template: CatalogTemplate }
  | { kind: 'checkout' }
  | { kind: 'pending' }

const modal = ref<ModalState>({ kind: 'none' })

function onProductClick(template: CatalogTemplate): void {
  if (template.optionGroups.length > 0) {
    modal.value = { kind: 'dynamic', template }
  } else {
    modal.value = { kind: 'extras', template }
  }
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
    <!-- Header -->
    <header class="pos-header">
      <div class="pos-header-left">
        <RouterLink to="/home" class="pos-back" aria-label="Volver al inicio">←</RouterLink>
        <h1 class="pos-title">POS Piso 1</h1>
      </div>
      <div class="pos-header-right">
        <button
          type="button"
          class="pos-pending-link"
          data-testid="open-pending"
          @click="modal = { kind: 'pending' }"
        >
          <Clock :size="16" aria-hidden="true" />
          Pendientes
          <span v-if="cart.itemCount >= 0" class="pos-pending-badge" data-testid="pending-badge">0</span>
        </button>
      </div>
    </header>

    <!-- Estado catálogo -->
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

    <!-- Shell POS -->
    <div v-else-if="catalog.catalog" class="pos-body">
      <!-- Categorías -->
      <nav class="pos-categories" aria-label="Categorías">
        <button
          type="button"
          class="pos-category"
          :class="{ 'pos-category--active': selectedCategoryId == null }"
          @click="selectedCategoryId = null"
        >
          Todo
        </button>
        <button
          v-for="category in catalog.catalog.categories"
          :key="category.id"
          type="button"
          class="pos-category"
          :class="{ 'pos-category--active': selectedCategoryId === category.id }"
          @click="selectedCategoryId = category.id"
        >
          {{ category.name }}
        </button>
      </nav>

      <!-- Grid de productos -->
      <main class="pos-grid-wrap">
        <div class="pos-grid" data-testid="product-grid">
          <button
            v-for="template in filteredTemplates"
            :key="template.id"
            type="button"
            class="pos-product"
            :data-testid="`product-${template.id}`"
            @click="onProductClick(template)"
          >
            <span class="pos-product-img">
              <img
                v-if="template.hasImage"
                src="/logoWText.png"
                alt=""
                loading="lazy"
              />
              <span v-else class="pos-product-placeholder" aria-hidden="true">🍽</span>
            </span>
            <span class="pos-product-name">{{ template.name }}</span>
            <span class="pos-product-price">{{ formatMoney(template.basePrice) }}</span>
            <span
              v-if="template.optionGroups.length > 0"
              class="pos-product-options"
              title="Producto con opciones"
            >
              Opciones
            </span>
          </button>
        </div>
        <div v-if="filteredTemplates.length === 0" class="pos-empty">
          No hay productos en esta categoría.
        </div>
      </main>

      <!-- Carrito -->
      <aside class="pos-cart">
        <header class="pos-cart-header">
          <h2 class="pos-cart-title">Orden actual</h2>
          <span class="pos-cart-count" data-testid="cart-count">{{ cart.itemCount }}</span>
        </header>

        <div v-if="cart.isEmpty" class="pos-cart-empty">
          <p>Toca un producto para agregarlo</p>
        </div>

        <ul v-else class="pos-cart-items" data-testid="cart-items">
          <li v-for="item in cart.lines" :key="item.key" class="pos-cart-item">
            <div class="pos-cart-item-main">
              <span class="pos-cart-item-name">{{ item.productName }}</span>
              <span
                v-if="itemSubtitle(item.dynamicOptionsSummary, item.note, item.extras.length)"
                class="pos-cart-item-sub"
              >
                {{ itemSubtitle(item.dynamicOptionsSummary, item.note, item.extras.length) }}
              </span>
            </div>
            <div class="pos-cart-item-controls">
              <button
                type="button"
                class="pos-qty-btn"
                :aria-label="`Quitar uno de ${item.productName}`"
                @click="cart.decrementItem(item.key)"
              >
                <Minus :size="14" />
              </button>
              <span class="pos-cart-item-qty">{{ item.quantity }}</span>
              <button
                type="button"
                class="pos-qty-btn"
                :aria-label="`Agregar uno de ${item.productName}`"
                @click="cart.incrementItem(item.key)"
              >
                <Plus :size="14" />
              </button>
              <span class="pos-cart-item-price" data-testid="cart-line-total">
                {{ formatMoney(cartItemUnitPrice(item) * item.quantity) }}
              </span>
              <button
                type="button"
                class="pos-qty-btn pos-qty-btn--danger"
                :aria-label="`Eliminar ${item.productName}`"
                @click="cart.removeItem(item.key)"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </li>
        </ul>

        <footer class="pos-cart-footer">
          <div class="pos-cart-total">
            <span>Total</span>
            <span data-testid="cart-total">{{ formatMoney(cart.total) }}</span>
          </div>
          <div class="pos-cart-actions">
            <AppButton
              variant="ghost"
              :disabled="cart.isEmpty || pendingSubmitting"
              :loading="pendingSubmitting"
              data-testid="submit-pending"
              @click="submitAsPending"
            >
              Pendiente
            </AppButton>
            <AppButton
              :disabled="cart.isEmpty || !canSell"
              data-testid="open-checkout"
              @click="modal = { kind: 'checkout' }"
            >
              Cobrar
            </AppButton>
          </div>
        </footer>
      </aside>
    </div>

    <!-- Modales -->
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
    <PendingOrdersView
      v-if="modal.kind === 'pending'"
      @close="modal = { kind: 'none' }"
    />
  </div>
</template>

<style scoped>
.pos {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg);
}

.pos-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 20px;
  background: var(--bg-surface);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.pos-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pos-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius);
  background: var(--input-bg);
  color: var(--text-muted);
  text-decoration: none;
  font-size: 18px;
}

.pos-back:hover {
  color: var(--text);
}

.pos-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text);
}

.pos-pending-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-family: var(--font);
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
}

.pos-pending-link:hover {
  color: var(--text);
  border-color: var(--text-faint);
}

.pos-pending-badge {
  min-width: 22px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--primary);
  color: var(--on-primary);
  font-size: 0.75rem;
  text-align: center;
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
  display: grid;
  grid-template-columns: 200px 1fr 340px;
  min-height: 0;
}

/* --- Categorías ------------------------------------------------------------ */
.pos-categories {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 12px;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-soft);
  overflow-y: auto;
}

.pos-category {
  padding: 12px 14px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius);
  color: var(--text-muted);
  font-family: var(--font);
  font-size: 0.95rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.pos-category:hover {
  color: var(--text);
  background: var(--card-overlay);
}

.pos-category--active {
  background: rgba(255, 87, 34, 0.12);
  border-color: var(--primary);
  color: var(--primary);
}

/* --- Grid ------------------------------------------------------------------ */
.pos-grid-wrap {
  overflow-y: auto;
  padding: 16px;
  min-height: 0;
}

.pos-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.pos-product {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, transform 0.05s ease;
}

.pos-product:hover {
  border-color: var(--primary);
}

.pos-product:active {
  transform: translateY(1px);
}

.pos-product-img {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 90px;
  border-radius: 8px;
  background: var(--input-bg);
  overflow: hidden;
}

.pos-product-img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pos-product-placeholder {
  font-size: 40px;
  opacity: 0.5;
}

.pos-product-name {
  color: var(--text);
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1.25;
}

.pos-product-price {
  color: var(--primary);
  font-size: 1.05rem;
  font-weight: 700;
}

.pos-product-options {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--info);
  color: #ffffff;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.pos-empty {
  padding: 40px;
  text-align: center;
  color: var(--text-faint);
}

/* --- Carrito ---------------------------------------------------------------- */
.pos-cart {
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-soft);
  min-height: 0;
}

.pos-cart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-soft);
}

.pos-cart-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--text);
}

.pos-cart-count {
  min-width: 26px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--primary);
  color: var(--on-primary);
  font-size: 0.8rem;
  font-weight: 700;
  text-align: center;
}

.pos-cart-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  font-size: 0.9rem;
}

.pos-cart-items {
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 10px 12px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pos-cart-item {
  padding: 10px 12px;
  background: var(--input-bg);
  border-radius: var(--radius);
}

.pos-cart-item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
}

.pos-cart-item-name {
  color: var(--text);
  font-size: 0.9rem;
  font-weight: 700;
}

.pos-cart-item-sub {
  color: var(--text-faint);
  font-size: 0.75rem;
  word-break: break-word;
}

.pos-cart-item-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pos-qty-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: var(--bg-surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  color: var(--text-muted);
  cursor: pointer;
}

.pos-qty-btn:hover {
  color: var(--text);
  border-color: var(--text-faint);
}

.pos-qty-btn--danger:hover {
  color: var(--error);
  border-color: var(--error);
}

.pos-cart-item-qty {
  min-width: 20px;
  text-align: center;
  color: var(--text);
  font-weight: 700;
}

.pos-cart-item-price {
  flex: 1;
  text-align: right;
  color: var(--primary);
  font-weight: 700;
  font-size: 0.9rem;
}

.pos-cart-footer {
  padding: 14px 16px;
  border-top: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pos-cart-total {
  display: flex;
  justify-content: space-between;
  color: var(--text);
  font-size: 1.25rem;
  font-weight: 700;
}

.pos-cart-actions {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 10px;
}
</style>
