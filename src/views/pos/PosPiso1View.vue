<script setup lang="ts">
/**
 * PosPiso1View · vista VENDER del POS desktop (ronda 3 — OrderPanel EXACTO).
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
 * - order_panel.dart    COMPLETO (ronda 3):
 *                       · Header: 'Orden Actual' + ToggleButtons tipo orden
 *                         (Local / UBER-DIDI / Externo, fill deepOrange).
 *                       · Form UBER/DIDI (L883-932): naranja, repartidor.
 *                       · Form EXTERNO (external_customer_form.dart): sin
 *                         backend de clientes → serializa en platformInfo.
 *                       · Items (OrderListItem L946-1192): imagen 50, nombre
 *                         bold, unitario gris, total bold; complemento/extras
 *                         itálica, opciones '•' 11px, notas '-'; input nota
 *                         adicional al blur + −/qty/+/editar/eliminar.
 *                       · Footer (L432-806): Total deepOrange headlineSmall,
 *                         2 previews de ticket (Cocina/Cliente), y UN botón:
 *                         LOCAL → 'Proceder al Pago' (checkout con pago);
 *                         UBER/DIDI|EXTERNO → 'Guardar Orden' (pendiente).
 *                       · SIN botón 'Pendiente' (el dueño fue explícito).
 *
 * Lógica de carrito/checkout intacta (stores + modales Fase 3).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import {
  Soup, Info, Search, Trash2, Utensils, CircleMinus, CirclePlus,
  SquarePen, User, UtensilsCrossed, ReceiptText, SquareMenu,
} from 'lucide-vue-next'
import type { CatalogExtra, CatalogTemplate } from '../../api/pos-types'
import { POS_PLANT_ID, POS_SUCURSAL_ID, useCatalogStore } from '../../stores/catalog'
import { cartItemUnitPrice, useCartStore, type CartItem } from '../../stores/cart'
import { useOrdersStore } from '../../stores/orders'
import { useToastStore } from '../../stores/toast'
import { session } from '../../services/auth'
import { printPendingKitchenTicket } from '../../services/ticket'
import { AppBanner, AppButton, AppSpinner } from '../../components/ui'
import DynamicOptionsModal from '../../components/pos/DynamicOptionsModal.vue'
import ExtrasNoteModal from '../../components/pos/ExtrasNoteModal.vue'
import CheckoutModal from '../../components/pos/CheckoutModal.vue'
import TicketPreviewModal from '../../components/pos/TicketPreviewModal.vue'
import ExternalCustomerForm from '../../components/pos/ExternalCustomerForm.vue'

const catalog = useCatalogStore()
const cart = useCartStore()
const ordersStore = useOrdersStore()
const toast = useToastStore()

// --- Phone layout (pos_view.dart L53-82 del original Flutter) ---------------
// En phones (!Windows && width<1000) el original NO apila: usa DefaultTabController
// con TabBar 'Menú | Orden' a pantalla completa. Aquí el breakpoint demo es
// <700px (donde el rail desaparece); 700-1024 conserva el stack de tablet.

const isPhone = ref(false)
let phoneMq: MediaQueryList | null = null
function onPhoneMq(e: MediaQueryListEvent | MediaQueryList): void {
  isPhone.value = e.matches
}

onMounted(() => {
  void catalog.fetchCatalog(POS_PLANT_ID)
  // Flutter mide el ancho del CONTENEDOR (LayoutBuilder), no la ventana:
  // con panel de 290px fijo, contenedor = viewport − 290. ResizeObserver
  // porque el wrap solo existe cuando el catálogo termina de cargar.
  gridObserver = new ResizeObserver(onGridWrapResize)
  // Tab phone Menú|Orden (pos_view.dart L57-82).
  phoneMq = matchMedia('(max-width: 699px)')
  isPhone.value = phoneMq.matches
  phoneMq.addEventListener('change', onPhoneMq)
})

onBeforeUnmount(() => {
  gridObserver?.disconnect()
  gridObserver = null
  phoneMq?.removeEventListener('change', onPhoneMq)
  phoneMq = null
})

/** Pestaña activa del TabBar phone: 0 = Menú, 1 = Orden (TabBarView). */
const phoneTab = ref(0)

// --- Catálogo ---------------------------------------------------------------

const gridWrap = ref<HTMLElement | null>(null)
const gridWidth = ref(0)

function onGridWrapResize(): void {
  if (gridWrap.value != null) gridWidth.value = gridWrap.value.clientWidth
}

/**
 * Réplica LayoutBuilder menu_content.dart L249-256/L283-290: NO-Windows
 * gridWidth<700 → 2 columnas aspect 1.1 (phone); <1100 → 3; else → 4.
 * En desktop-VENTANA (nuestro caso) se conserva 3/4/5 del rail desktop,
 * pero cuando el TabBar phone está activo aplica la rama no-Windows.
 */
const gridColumns = computed<number>(() => {
  if (isPhone.value) {
    // Rama no-Windows del .dart (gridWidth<700 → 2; <1100 → 3; else 4).
    if (gridWidth.value < 700) return 2
    if (gridWidth.value < 1100) return 3
    return 4
  }
  if (gridWidth.value < 900) return 3
  if (gridWidth.value < 1200) return 4
  return 5
})

/** Aspect ratio réplica L256/L290: no-Windows gridWidth<500 → 1.1, else 0.95. */
const gridAspectRatio = computed<string>(() => {
  if (isPhone.value && gridWidth.value < 500) return '1.1'
  return '0.95'
})

let gridObserver: ResizeObserver | null = null

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
  | { kind: 'dynamic'; template: CatalogTemplate; edit?: EditContext | null }
  | { kind: 'extras'; template: CatalogTemplate; edit?: EditContext | null }
  | { kind: 'checkout' }
  | { kind: 'preview-kitchen' }
  | { kind: 'preview-client' }

/** Contexto de edición de una línea del carrito (ronda 3, réplica wizard). */
interface EditContext {
  key: string
  selections: import('../../api/pos-types').OrderItemSelectedOption[] | null
  extras: number[]
  note: string
  /** Ronda 5: dynamicOptionsSummary de la línea (mitades MIXTO y salsas
   * aparte no viven en las selecciones estructurales). */
  summary?: string
}

const modal = ref<ModalState>({ kind: 'none' })

function onProductClick(template: CatalogTemplate): void {
  // Ronda 5b: el Flutter abre el wizard SIEMPRE (_handleProductTap L395-410 no
  // condiciona por grupos); el wizard muestra 'Sin opciones disponibles'+Cerrar
  // si el template no trae grupos (DynamicProductWizardDialog L2843-2889).
  modal.value = { kind: 'dynamic', template }
}

/** Réplica edit_outlined (L1168-1181): reabre el modal en modo EDICIÓN. */
function onEditItem(item: CartItem): void {
  const template = catalog.catalog?.templates.find((t) => t.id === item.productId)
  if (template == null) {
    // Ítem standalone de extras o template no encontrado: editar nota/qty
    // desde el panel (el modal de producto no aplica).
    toast.info('Edita este ítem con su nota o cantidad desde el panel.')
    return
  }
  const edit: EditContext = {
    key: item.key,
    selections: item.selectedOptions,
    extras: item.extras.map((e) => e.id),
    note: item.note,
    summary: item.dynamicOptionsSummary ?? '',
  }
  modal.value = { kind: 'dynamic', template, edit }
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

/**
 * Ronda 3 (Guarda Orden, order_panel.dart L710-803): UBER/DIDI/EXTERNO →
 * POST sin payment (status pendiente, payment_method PENDIENTE) → toast
 * '✓ Orden guardada como pendiente' + limpiar y volver a LOCAL.
 */
async function submitAsPending(): Promise<void> {
  if (cart.isEmpty || pendingSubmitting.value) return
  // Validaciones réplica Flutter L722-751.
  const type = cart.orderType.toUpperCase()
  if (type === 'EXTERNO' && cart.customerId == null) {
    toast.warning('⚠️ Debes seleccionar un cliente para órdenes EXTERNO')
    return
  }
  if (type.includes('UBER') || type.includes('DIDI')) {
    if (cart.platformDeliveryInfo.trim() === '') {
      toast.warning('⚠️ Debes agregar el nombre del repartidor o ID de pedido')
      return
    }
  }
  pendingSubmitting.value = true
  try {
    // Snapshot ANTES de cart.clear() (la impresión necesita items).
    const items = [...cart.lines]
    const type = cart.orderType
    const deliveryInfo = cart.platformDeliveryInfo
    const created = await ordersStore.submitOrder(
      {
        plantId: POS_PLANT_ID,
        sucursalId: POS_SUCURSAL_ID,
        tableId: 1,
        // 'UBER/DIDI' (UI) → 'DIDI' (catálogo cerrado del backend Rest).
        orderType: backendOrderType(cart.orderType) as typeof cart.orderType,
        // Ronda 4 (API real de clientes, backend 0700a12): EXTERNO manda
        // customerId; el backend toca last_order_date. platformDeliveryInfo
        // queda SOLO para UBER/DIDI (ya no se serializa texto del cliente).
        ...(cart.customerId != null ? { customerId: cart.customerId } : {}),
        items: cart.toOrderItems(),
      },
      session.displayName ?? 'Cajero',
    )
    // Auto-impresión silenciosa SOLO COCINA (réplica order_provider.dart
    // L374-388: pendiente → kitchen ticket al momento; x2 si keywords).
    printPendingKitchenTicket({
      folio: created.dailyOrderNumber.toString(),
      orderType: type,
      platformDeliveryInfo: deliveryInfo,
      items,
      total: created.total,
      orderId: created.id,
    })
    toast.success('✓ Orden guardada como pendiente')
    cart.clear()
  } catch {
    toast.error('No se pudo crear la orden pendiente. Intenta de nuevo.')
  } finally {
    pendingSubmitting.value = false
  }
}

// --- Tipo de orden (toggle) + formularios (ronda 3) --------------------------

/** Labels EXACTOS del ToggleButtons Flutter (L843, L859-875). */
const ORDER_TYPE_LABELS = [
  { value: 'LOCAL', label: 'Local' },
  { value: 'UBER/DIDI', label: 'UBER/DIDI' },
  { value: 'EXTERNO', label: 'Externo' },
] as const

/**
 * orderType que viaja al backend. El Flutter manda 'UBER/DIDI' literal, pero
 * el backend Rest tiene catálogo CERRADO (RestOrderService.cs L35-36:
 * LOCAL|DELIVERY|EXTERNO|UBER|DIDI|TRANSFER_P1_P2) → se manda 'DIDI' (valor
 * válido de plataforma). La UI muestra 'UBER/DIDI' como el Flutter.
 * DIVERGENCIA MENOR documentada (el valor BD difiere del Flutter).
 */
function backendOrderType(type: string): string {
  return type === 'UBER/DIDI' ? 'DIDI' : type
}

const isUberDidi = computed(() => cart.orderType === 'UBER/DIDI')
const isExterno = computed(() => cart.orderType === 'EXTERNO')

// Ronda 4: el cliente EXTERNO vive en el cart store (RestCustomer completo
// del API real de clientes). Ya NO se serializa texto en platformDeliveryInfo.

// --- OrderListItem (ronda 3) -------------------------------------------------

/** Imagen 50x50 por productId; null = icono fastfood (fallback). */
const brokenLineImageIds = ref<Set<number>>(new Set())
function onLineImageError(event: Event): void {
  const img = event.target as HTMLImageElement
  const match = img.src.match(/templates\/(\d+)\/image/)
  if (match != null) brokenLineImageIds.value = new Set(brokenLineImageIds.value).add(Number(match[1]))
}

/** Extras itálica: '+ A, + B' (réplica extrasText L1013). */
function extrasText(item: CartItem): string {
  return item.extras.map((e) => `+ ${e.name}`).join(', ')
}

/** Notas parseadas sin mezclar prefijos (réplica _parsePanelNotes L1195+). */
function panelNotes(item: CartItem): string[] {
  const out: string[] = []
  const raw = item.note
  if (raw.trim() === '') return out
  if (
    !raw.includes('OPT::') && !raw.includes('MIXTO') &&
    !raw.includes('NOTA::') && !raw.includes('NOTE::')
  ) {
    return [`- ${raw}`]
  }
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (t === '') continue
    if (t.startsWith('OPT::')) out.push(`- ${t.slice(5).trim()}`)
    else if (t.startsWith('NOTE::')) out.push(`- ${t.slice(6).trim()}`)
    else if (t.startsWith('NOTA::')) out.push(`- ${t.slice(6).trim()}`)
    else out.push(`- ${t}`)
  }
  return out.filter((s) => s !== '- ')
}

/** Input de nota adicional por línea: guarda al blur (réplica L1140-1153). */
const lineNotes = ref<Record<string, string>>({})
function onLineNoteBlur(item: CartItem): void {
  const value = lineNotes.value[item.key]
  if (value == null) return
  cart.updateItem(item.key, { note: value })
  // Muestra aparte de la nota previa de opciones (sin mezclar prefijos).
  lineNotes.value = { ...lineNotes.value, [item.key]: '' }
}

function lineNotePlaceholder(): string {
  return 'Nota adicional (ej. sin cebolla)...'
}

/** Opciones dinámicas en líneas '• x' (réplica dynamicOptionsSummary L1094+). */
function optionLines(item: CartItem): string[] {
  const summary = item.dynamicOptionsSummary
  if (summary == null || summary.trim() === '') return []
  return summary.split('\n').map((l) => l.trim()).filter((l) => l !== '')
}

// --- Preview de tickets (ronda 3, réplica _TicketPreviewDialog) --------------

// --- Formato ----------------------------------------------------------------

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`
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

    <!-- Layout raíz: phone → TabBar Menú|Orden (pos_view.dart L57-82);
         desktop/tablet → Row = MenuContent(expandible) + OrderPanel(290px) -->
    <div v-else-if="catalog.catalog" class="pos-body" :class="{ 'pos-body--phone': isPhone }">
      <!-- TabBar phone (solo <700px): réplica Tab Flutter 'Menú' icon restaurant_menu
           + 'Orden' icon receipt_long; bg cardTheme, indicador deepOrange -->
      <div v-if="isPhone" class="phone-tabs" role="tablist" aria-label="Menú u Orden">
        <button
          type="button"
          role="tab"
          class="phone-tab"
          :class="{ 'phone-tab--active': phoneTab === 0 }"
          :aria-selected="phoneTab === 0"
          data-testid="phone-tab-menu"
          @click="phoneTab = 0"
        >
          <SquareMenu :size="18" aria-hidden="true" />
          Menú
        </button>
        <button
          type="button"
          role="tab"
          class="phone-tab"
          :class="{ 'phone-tab--active': phoneTab === 1 }"
          :aria-selected="phoneTab === 1"
          data-testid="phone-tab-orden"
          @click="phoneTab = 1"
        >
          <ReceiptText :size="18" aria-hidden="true" />
          Orden
        </button>
      </div>

      <!-- ================= MENUCONTENT ================= -->
      <section
        v-show="!isPhone || phoneTab === 0"
        class="menu"
        aria-label="Menú"
      >
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
            :style="{ gridTemplateColumns: `repeat(${gridColumns}, 1fr)`, gridAutoRows: `calc(100% / ${gridColumns} / ${gridAspectRatio})` }"
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
            :style="{ gridTemplateColumns: `repeat(${gridColumns}, 1fr)`, gridAutoRows: `calc(100% / ${gridColumns} / ${gridAspectRatio})` }"
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

      <!-- ================= ORDER PANEL (290px / tab 2 phone) ================= -->
      <aside
        v-show="!isPhone || phoneTab === 1"
        class="order-panel"
        data-testid="order-panel"
      >
        <!-- Header: título + toggle tipo + formularios condicionales
             (réplica order_panel.dart L346-405) -->
        <div class="op-header">
          <h2 class="op-title">Orden Actual</h2>

          <!-- ToggleButtons tipo orden (réplica _buildOrderTypeToggle L839-880) -->
          <div class="op-toggle" role="radiogroup" aria-label="Tipo de orden" data-testid="order-type-toggle">
            <button
              v-for="t in ORDER_TYPE_LABELS"
              :key="t.value"
              type="button"
              role="radio"
              class="op-toggle-seg"
              :class="{ 'op-toggle-seg--active': cart.orderType === t.value }"
              :aria-checked="cart.orderType === t.value"
              :data-testid="`order-type-${t.value}`"
              @click="cart.setOrderType(t.value)"
            >
              {{ t.label }}
            </button>
          </div>

          <!-- Form UBER/DIDI (réplica _buildPlatformOrderForm L883-932) -->
          <div v-if="isUberDidi" class="op-platform-form" data-testid="platform-form">
            <span class="op-platform-label">Información del Repartidor</span>
            <div class="op-platform-input-wrap">
              <User :size="16" class="op-platform-icon" aria-hidden="true" />
              <input
                type="text"
                class="op-platform-input"
                placeholder="Ej: Juan, ID: #12345"
                aria-label="Información del repartidor"
                data-testid="platform-info-input"
                :value="cart.platformDeliveryInfo"
                @input="cart.setPlatformDeliveryInfo(($event.target as HTMLInputElement).value)"
              />
            </div>
          </div>

          <!-- Form EXTERNO (ronda 4: API real de clientes — search/frequent/
               create contra backend 0700a12; guarda customerId en el cart) -->
          <div v-if="isExterno" class="op-external-form" data-testid="external-form">
            <ExternalCustomerForm
              :initial="cart.customer"
              @change="cart.setCustomer($event)"
            />
          </div>
        </div>

        <div class="op-divider" aria-hidden="true"></div>

        <!-- Lista de items (réplica OrderListItem L946-1192) -->
        <div v-if="cart.isEmpty" class="op-empty">
          La orden está vacía.
        </div>
        <ul v-else class="op-items" data-testid="cart-items">
          <li v-for="item in cart.lines" :key="item.key" class="op-item" :data-testid="`cart-line-${item.key}`">
            <!-- Fila principal: imagen 50 + nombre/unitario + total bold -->
            <div class="op-item-top">
              <span class="op-item-media">
                <img
                  v-if="item.productId != null && !brokenLineImageIds.has(item.productId)"
                  :src="`/api/rest/catalog/templates/${item.productId}/image`"
                  alt=""
                  loading="lazy"
                  @error="onLineImageError"
                />
                <Soup v-else :size="34" class="op-item-media-icon" aria-hidden="true" />
              </span>
              <span class="op-item-mid">
                <span class="op-item-name">{{ item.productName }}</span>
                <span class="op-item-unit">{{ formatMoney(cartItemUnitPrice(item)) }}</span>
              </span>
              <span class="op-item-total" data-testid="cart-line-total">
                {{ formatMoney(cartItemUnitPrice(item) * item.quantity) }}
              </span>
            </div>

            <!-- Complemento / Extras itálica (réplica L1065-1089) -->
            <div
              v-if="item.complement != null || extrasText(item) !== ''"
              class="op-item-meta"
            >
              <span v-if="item.complement != null" class="op-item-meta-line">
                Complemento: {{ item.complement.name }}
              </span>
              <span v-if="extrasText(item) !== ''" class="op-item-meta-line">
                Extras: {{ extrasText(item) }}
              </span>
            </div>

            <!-- Opciones dinámicas '•' 11px (réplica L1093-1126) -->
            <div v-if="optionLines(item).length > 0" class="op-item-meta">
              <span class="op-item-meta-title">Opciones:</span>
              <span v-for="(line, i) in optionLines(item)" :key="i" class="op-item-meta-line">
                • {{ line }}
              </span>
            </div>

            <!-- Notas previas '- texto' 11px #B0B0B0 (réplica _parsePanelNotes) -->
            <div v-if="panelNotes(item).length > 0" class="op-item-meta op-item-notes">
              <span v-for="(line, i) in panelNotes(item)" :key="i" class="op-item-note-line">
                {{ line }}
              </span>
            </div>

            <!-- Acciones: nota al blur + −/qty/+/editar/eliminar (L1140-1188) -->
            <div class="op-item-controls">
              <input
                v-model="lineNotes[item.key]"
                type="text"
                class="op-item-note-input"
                :placeholder="lineNotePlaceholder()"
                :aria-label="`Nota adicional para ${item.productName}`"
                :data-testid="`note-input-${item.key}`"
                @blur="onLineNoteBlur(item)"
                @keydown.enter="($event.target as HTMLInputElement).blur()"
              />
              <button
                type="button"
                class="op-qty"
                :aria-label="`Quitar uno de ${item.productName}`"
                :data-testid="`dec-${item.key}`"
                @click="cart.decrementItem(item.key)"
              >
                <CircleMinus :size="22" />
              </button>
              <span class="op-qty-num" :data-testid="`qty-${item.key}`">{{ item.quantity }}</span>
              <button
                type="button"
                class="op-qty"
                :aria-label="`Agregar uno de ${item.productName}`"
                :data-testid="`inc-${item.key}`"
                @click="cart.incrementItem(item.key)"
              >
                <CirclePlus :size="22" />
              </button>
              <button
                type="button"
                class="op-qty"
                :aria-label="`Editar ${item.productName}`"
                :data-testid="`edit-${item.key}`"
                @click="onEditItem(item)"
              >
                <SquarePen :size="18" />
              </button>
              <button
                type="button"
                class="op-qty op-qty--danger"
                :aria-label="`Eliminar ${item.productName}`"
                :data-testid="`del-${item.key}`"
                @click="cart.removeItem(item.key)"
              >
                <Trash2 :size="18" />
              </button>
            </div>
          </li>
        </ul>

        <!-- Footer con totales + previews + acción única (réplica L432-806) -->
        <footer class="op-footer">
          <div class="op-total">
            <span class="op-total-label">Total</span>
            <span class="op-total-value" data-testid="cart-total">{{ formatMoney(cart.total) }}</span>
          </div>

          <!-- Previews de ticket (solo con items; réplica L454-484) -->
          <div v-if="!cart.isEmpty" class="op-previews">
            <button
              type="button"
              class="op-preview op-preview--kitchen"
              title="Preview Cocina"
              aria-label="Preview Cocina"
              data-testid="preview-kitchen"
              @click="modal = { kind: 'preview-kitchen' }"
            >
              <UtensilsCrossed :size="20" />
            </button>
            <button
              type="button"
              class="op-preview op-preview--client"
              title="Preview Cliente"
              aria-label="Preview Cliente"
              data-testid="preview-client"
              @click="modal = { kind: 'preview-client' }"
            >
              <ReceiptText :size="20" />
            </button>
          </div>

          <!-- LOCAL: UN solo botón 'Proceder al Pago' (sin 'Pendiente') -->
          <button
            v-if="cart.orderType === 'LOCAL'"
            type="button"
            class="op-btn op-btn--primary"
            :disabled="cart.isEmpty || !canSell"
            data-testid="open-checkout"
            @click="modal = { kind: 'checkout' }"
          >
            Proceder al Pago
          </button>

          <!-- UBER/DIDI / EXTERNO: 'Guardar Orden' (bg orange[700]) -->
          <button
            v-else
            type="button"
            class="op-btn op-btn--save"
            :disabled="cart.isEmpty || pendingSubmitting"
            data-testid="save-order"
            @click="submitAsPending"
          >
            {{ pendingSubmitting ? 'Guardando…' : 'Guardar Orden' }}
          </button>
        </footer>
      </aside>
    </div>

    <!-- Modales (ronda 5b: el wizard maneja TODOS los productos; ExtrasNoteModal
         queda sin uso desde el click de producto — se conserva por si se reusa) -->
    <DynamicOptionsModal
      v-if="modal.kind === 'dynamic'"
      :template="modal.template"
      :initial-selections="modal.edit?.selections ?? null"
      :initial-summary="modal.edit?.summary ?? ''"
      :initial-note="modal.edit?.note ?? ''"
      :edit-key="modal.edit?.key"
      @close="modal = { kind: 'none' }"
    />
    <ExtrasNoteModal
      v-if="modal.kind === 'extras'"
      :template="modal.template"
      :extras="catalog.catalog?.extras ?? []"
      :initial-extra-ids="modal.edit?.extras ?? null"
      :initial-note="modal.edit?.note ?? ''"
      :edit-key="modal.edit?.key"
      @close="modal = { kind: 'none' }"
    />
    <CheckoutModal
      v-if="modal.kind === 'checkout'"
      @close="modal = { kind: 'none' }"
    />
    <TicketPreviewModal
      v-if="modal.kind === 'preview-kitchen'"
      :items="cart.lines"
      :total="cart.total"
      :order-type="cart.orderType"
      :platform-delivery-info="
        isExterno && cart.customer != null
          ? cart.customer.customerName
          : cart.platformDeliveryInfo
      "
      :is-kitchen="true"
      @close="modal = { kind: 'none' }"
    />
    <TicketPreviewModal
      v-if="modal.kind === 'preview-client'"
      :items="cart.lines"
      :total="cart.total"
      :order-type="cart.orderType"
      :platform-delivery-info="
        isExterno && cart.customer != null
          ? cart.customer.customerName
          : cart.platformDeliveryInfo
      "
      :is-kitchen="false"
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

/* Grid responsivo por ancho de contenedor: <900→3 | <1200→4 | else→5
   (columnas + altura de fila calculadas en el script: réplica del
   childAspectRatio Flutter — ancho/aspecto = alto de fila) */
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

/* Header scrollable: título + toggle + forms condicionales (L346-405) */
.op-header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  padding: 16px 16px 12px;
}

.op-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  text-align: center;
}

/* ToggleButtons centrado (L839-880): fill deepOrange, radius 6, minHeight 32 */
.op-toggle {
  display: flex;
  justify-content: center;
}

.op-toggle-seg {
  padding: 0 10px;
  min-height: 32px;
  background: transparent;
  border: 1px solid var(--bg-surface); /* borderColor = surface (#303030) */
  border-right-width: 0;
  color: rgba(255, 255, 255, 0.8); /* onSurface 80% */
  font-family: var(--font);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.op-toggle-seg:first-child {
  border-radius: 6px 0 0 6px;
}

.op-toggle-seg:last-child {
  border-radius: 0 6px 6px 0;
  border-right-width: 1px;
}

.op-toggle-seg--active {
  background: var(--primary); /* fillColor primary */
  border-color: var(--primary); /* selectedBorderColor */
  color: #fff; /* onPrimary */
}

/* Form UBER/DIDI (L883-932): naranja alpha .3, borde shade700, radius 6 */
.op-platform-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: rgba(230, 81, 0, 0.3); /* orange.shade900 .3 */
  border: 1px solid #ef6c00; /* orange.shade700 */
  border-radius: 6px;
}

.op-platform-label {
  color: #ffcc80; /* orange.shade300 */
  font-size: 11px;
  font-weight: 700;
}

.op-platform-input-wrap {
  position: relative;
}

.op-platform-icon {
  position: absolute;
  top: 50%;
  left: 8px;
  transform: translateY(-50%);
  color: var(--warning); /* Icons.person orange */
  pointer-events: none;
}

.op-platform-input {
  width: 100%;
  padding: 8px 8px 8px 30px;
  background: #212121; /* grey[900] */
  border: 1px solid #616161; /* grey[700] */
  border-radius: 4px;
  color: var(--text);
  font-family: var(--font);
  font-size: 11px;
  outline: none;
}

.op-platform-input::placeholder {
  color: var(--text-faint); /* grey[600] */
  font-size: 11px;
}

/* Form EXTERNO (envuelve ExternalCustomerForm) */
.op-external-form {
  /* el hijo trae sus propios estilos */
}

.op-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.24);
}

/* Items (OrderListItem: imagen 50 + nombre/unitario + total 80 bold) */
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

/* Fila imagen 50x50 radius 8 + mid + total (L1021-1063) */
.op-item-top {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.op-item-media {
  flex: none;
  width: 50px;
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-surface-2);
}

.op-item-media img {
  width: 50px;
  height: 50px;
  object-fit: cover;
  display: block;
}

.op-item-media-icon {
  color: #616161; /* grey[700] errorBuilder */
}

.op-item-mid {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.op-item-name {
  color: var(--text);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.op-item-unit {
  color: var(--text-muted); /* bodySmall */
  font-size: 11px;
}

.op-item-total {
  flex: none;
  width: 80px; /* SizedBox width 80 (L1053) */
  text-align: right;
  color: var(--text);
  font-size: 15px;
  font-weight: 700;
}

/* Meta itálica bajo la fila (padding-left 62 = 50 + gap 12; L1065-1126) */
.op-item-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 62px;
  margin-top: 4px;
}

.op-item-meta-title {
  color: rgba(255, 255, 255, 0.9);
  font-size: 11px;
  font-weight: 700;
}

.op-item-meta-line {
  color: rgba(189, 189, 189, 0.7); /* bodySmall alpha .7 */
  font-size: 11px;
  font-style: italic;
  word-break: break-word;
}

/* Notas '- texto' #B0B0B0 (réplica L1212) */
.op-item-notes {
  margin-top: 4px;
  margin-bottom: 12px;
}

.op-item-note-line {
  color: #b0b0b0;
  font-size: 11px;
  word-break: break-word;
}

.op-item-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
}

/* Input nota adicional (L1143-1152): densidad baja */
.op-item-note-input {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  background: var(--input-bg);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  color: var(--text);
  font-family: var(--font);
  font-size: 11px;
  outline: none;
}

.op-item-note-input::placeholder {
  color: var(--text-faint);
  font-size: 10px;
}

.op-item-note-input:focus {
  border-color: var(--primary);
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

.op-qty--danger {
  color: var(--error); /* delete_outline colorScheme.error */
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

/* Footer (Container radius-top 16, border-top grey[800], padding 24→16) */
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

/* Total deepOrange headlineSmall (~28px) bold (L812-822) */
.op-total-value {
  color: var(--primary);
  font-size: 28px;
  font-weight: 700;
  line-height: 1.2;
}

/* Previews de ticket centrados (réplica Row L455-484) */
.op-previews {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.op-preview {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  background: transparent;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background 0.15s ease;
}

.op-preview--kitchen {
  color: var(--primary); /* deepOrangeAccent */
  border: 1px solid rgba(255, 87, 34, 0.5);
}

.op-preview--kitchen:hover {
  background: rgba(255, 87, 34, 0.12);
}

.op-preview--client {
  color: var(--info); /* blueAccent */
  border: 1px solid rgba(33, 150, 243, 0.5);
}

.op-preview--client:hover {
  background: rgba(33, 150, 243, 0.12);
}

.op-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid transparent;
  font-family: var(--font);
  font-size: 16px;
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

/* Guardar Orden (UBER/DIDI|EXTERNO): bg orange[700] (L717) */
.op-btn--save {
  background: #f57c00; /* Colors.orange[700] */
  color: #fff;
}

.op-btn--save:hover:not(:disabled) {
  background: #ff9800;
}

.op-btn--save:disabled {
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

/* ==========================================================================
   PHONE (<700px) — pos_view.dart L53-82 del original Flutter:
   NO apila el POS. TabBar 'Menú | Orden' arriba (Container cardTheme +
   TabBar M3: labels+iconos, indicador deepOrange 2px abajo) y la pestaña
   activa ocupa la pantalla completa. Grid 2 cols aspect 1.1 (rama
   no-Windows width<700 del menu_content.dart).
   ========================================================================== */
.pos-body--phone {
  flex-direction: column;
}

.phone-tabs {
  display: none; /* solo visible <700px */
}

@media (max-width: 699px) {
  .pos-body--phone {
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  /* TabBar Flutter: Container color cardTheme (#303030) full width */
  .phone-tabs {
    display: flex;
    flex: none;
    background: #303030;
  }

  /* Tab M3: label+icono 14px w500, alto 48-56, indicador 2px deepOrange
     bajo la pestaña activa; inactivo blanco70 */
  .phone-tab {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 48px;
    padding: 10px 8px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: rgba(255, 255, 255, 0.7);
    font-family: var(--font);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .phone-tab--active {
    color: var(--primary);
    border-bottom-color: var(--primary);
  }

  /* La pestaña visible llena la pantalla (TabBarView): el menú ya es
     flex:1 del column; el order-panel pasa a ancho completo */
  .order-panel {
    width: 100%;
    flex: 1;
    min-height: 0;
    border-top: none;
  }

  /* Menú 2 columnas: el spacing del grid pasa a 8 (isNarrow L262-263) */
  .menu-grid {
    gap: 8px;
  }

  .menu-grid-wrap {
    padding: 8px;
  }

  /* Header compacto en phone: la búsqueda ocupa el resto (170px fijo
     desborda a 360px) */
  .menu-header {
    flex-wrap: wrap;
    gap: 8px;
  }

  .menu-search {
    width: min(170px, 100%);
  }
}
</style>
