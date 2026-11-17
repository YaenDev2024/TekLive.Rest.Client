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
  Plus, Pizza, Sandwich, Beef, Salad, CupSoda, Cake, Package,
  Flame, Coffee, Cookie, Croissant, Hamburger, Drumstick, Wine,
} from 'lucide-vue-next'
import type { CatalogExtra, CatalogTemplate } from '../../api/pos-types'
import { POS_PLANT_ID, POS_SUCURSAL_ID, useCatalogStore } from '../../stores/catalog'
import { cartItemUnitPrice, useCartStore, type CartItem } from '../../stores/cart'
import { useCashStore } from '../../stores/cash'
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
const cashStore = useCashStore()
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
  // Gate de caja (Fase 1-P1): asegura la sesión del piso 1 para que
  // cart.canSell sea preciso (réplica del gate _openPosForFloor — si el
  // usuario entró directo por router sin pasar por el selector de módulos,
  // el cash store estaría vacío y bloquearía la venta LOCAL injustamente).
  if (cashStore.current == null || cashStore.current.plantId !== POS_PLANT_ID) {
    void cashStore.fetchCurrent(POS_PLANT_ID)
  }
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

/** Aspect ratio réplica L256/L290: no-Windows gridWidth<500 → 1.1, else 0.95.
 *  REPLICADO EN CSS (fix tarjetas aplastadas): .product-card/.extra-card
 *  aspect-ratio 0.95 + media query ≤515px → 1.1 (ancho de contenedor ≈
 *  viewport − padding del wrap en phone fullscreen). */
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
  // Cabe completo: la nota tiene su propia línea en la tarjeta
  return 'Nota adicional (ej. sin cebolla)…'
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

// --- Presentación del menú (ronda Piso 1 premium) ---------------------------
//
// ⚠️ SOLO PRESENTACIÓN. Nada de aquí altera precios, carrito, pagos ni
// contratos: son funciones puras de lectura sobre datos que ya existen.

/**
 * Arte de respaldo por categoría. El contrato del catálogo HOY no expone la URL
 * de la imagen (solo `hasImage: boolean`) y el endpoint
 * `/api/rest/catalog/templates/{id}/image` todavía no existe, así que todas las
 * tarjetas caerían al mismo icono genérico. Mientras el backend de imágenes no
 * esté listo, cada categoría se pinta con su propio icono + tinte para que el
 * grid sea legible y reconocible de un vistazo, sin fotos ni datos inventados.
 *
 * Cuando el backend exponga las imágenes, el <img> toma el control y este arte
 * solo aparece en los productos sin foto. No hay que tocar el diseño otra vez.
 */
const CATEGORY_ART: Array<{ match: RegExp; icon: unknown; pill: string; hue: string }> = [
  { match: /taco|burrito|antojito|mexican/i, icon: Flame, pill: 'rgba(255, 100, 45, 0.14)', hue: '#ff8a5c' },
  { match: /pizza/i, icon: Pizza, pill: 'rgba(255, 100, 45, 0.14)', hue: '#ff8a5c' },
  { match: /hamburg|burger|sandwich|torta|lonche/i, icon: Hamburger, pill: 'rgba(227, 160, 8, 0.14)', hue: '#e3a008' },
  { match: /pollo|wing|alita|boneless|drumstick/i, icon: Drumstick, pill: 'rgba(255, 100, 45, 0.14)', hue: '#ff8a5c' },
  { match: /carne|beef|steak|costilla|arrachera/i, icon: Beef, pill: 'rgba(242, 86, 91, 0.14)', hue: '#f2565b' },
  { match: /ensalada|salad|verdura|vegetal/i, icon: Salad, pill: 'rgba(63, 185, 80, 0.14)', hue: '#3fb950' },
  { match: /bebida|refresco|soda|jugo|agua|horchata|limonada/i, icon: CupSoda, pill: 'rgba(74, 158, 255, 0.14)', hue: '#4a9eff' },
  { match: /cerveza|vino|alcohol|michelada|coctel/i, icon: Wine, pill: 'rgba(163, 122, 255, 0.14)', hue: '#a37aff' },
  { match: /caf|espresso|capuchino|latte/i, icon: Coffee, pill: 'rgba(163, 122, 255, 0.14)', hue: '#a37aff' },
  { match: /postre|flan|pastel|tarta|cake|dulce/i, icon: Cake, pill: 'rgba(255, 138, 185, 0.14)', hue: '#ff8ab9' },
  { match: /galleta|cookie|brownie/i, icon: Cookie, pill: 'rgba(255, 138, 185, 0.14)', hue: '#ff8ab9' },
  { match: /pan|baguette|croissant|bolillo/i, icon: Croissant, pill: 'rgba(227, 160, 8, 0.14)', hue: '#e3a008' },
  { match: /paquete|combo|promo|familiar/i, icon: Package, pill: 'rgba(74, 158, 255, 0.14)', hue: '#4a9eff' },
  { match: /sopa|caldo|crema|consome/i, icon: Soup, pill: 'rgba(227, 160, 8, 0.14)', hue: '#e3a008' },
]

const DEFAULT_ART = { icon: Sandwich, pill: 'rgba(255, 255, 255, 0.05)', hue: '#a3a3a3' }

/** Nombre de la categoría del template ('' si el catálogo no la trae). */
function categoryNameOf(template: CatalogTemplate): string {
  if (template.categoryId == null) return ''
  return catalog.catalog?.categories.find((c) => c.id === template.categoryId)?.name ?? ''
}

/** Icono + tono de una tarjeta de producto, derivado de su categoría/nombre. */
function productArt(template: CatalogTemplate): { icon: unknown; pill: string; hue: string } {
  const hay = `${categoryNameOf(template)} ${template.name}`
  return CATEGORY_ART.find((a) => a.match.test(hay)) ?? DEFAULT_ART
}

/** Icono + tinte para una píldora de categoría del tab bar. */
function categoryArt(name: string): { icon: unknown; pill: string; hue: string } {
  return CATEGORY_ART.find((a) => a.match.test(name)) ?? DEFAULT_ART
}

/** Descripción en una línea para la tarjeta (el backend ya la envía). */
function descriptionOf(template: CatalogTemplate): string {
  return (template.description ?? '').trim()
}

/**
 * Subtotal del carrito para el bloque de totales.
 * `cart.subtotal` ya existe y NO incluye impuestos (CrazyWings: taxRate 0.0).
 * Aquí solo se muestra desglosado lo que el backend realmente cobra.
 */
function cartItemsUnitCount(): number {
  return cart.lines.reduce((sum, line) => sum + line.quantity, 0)
}

/** Gate de caja (Fase 1-P1): canSell real = sesión OPEN del piso 1.
 *  SOLO bloquea el pago LOCAL; guardar pendiente/externo NO (el backend hace
 *  CashSessionId opcional). */
const canSell = computed(() => cart.canSell)
/** Banner discreto: sin caja + carrito con items. */
const showCashGateBanner = computed(() => !canSell.value && !cart.isEmpty)
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
        <!-- Header: título+fecha izquierda, búsqueda ancha + acción derecha -->
        <header class="menu-header">
          <div class="menu-header-text">
            <h1 class="menu-title">Crazy Wings</h1>
            <span class="menu-date">{{ currentDate }}</span>
          </div>
          <div class="menu-search">
            <Search :size="16" class="menu-search-icon" aria-hidden="true" />
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

        <!-- Pills de categoría: icono + nombre, activo sólido naranja -->
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
              <span class="menu-tab-icon">
                <Utensils :size="18" aria-hidden="true" />
              </span>
              <span class="menu-tab-label">TODO</span>
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
              <!-- Activo: sin estilo inline, el pill sólido naranja manda (CSS) -->
              <span
                class="menu-tab-icon"
                :style="
                  selectedCategoryId === category.id
                    ? undefined
                    : { background: categoryArt(category.name).pill, color: categoryArt(category.name).hue }
                "
              >
                <component :is="categoryArt(category.name).icon" :size="18" aria-hidden="true" />
              </span>
              <span class="menu-tab-label">{{ category.name }}</span>
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
              <span class="menu-tab-icon">
                <Plus :size="18" aria-hidden="true" />
              </span>
              <span class="menu-tab-label">EXTRAS</span>
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
              <!-- Media: foto si el backend la sirve; si no, arte por categoría -->
              <span class="product-media">
                <img
                  v-if="template.hasImage && !brokenImageIds.has(template.id)"
                  :src="`/api/rest/catalog/templates/${template.id}/image`"
                  alt=""
                  loading="lazy"
                  @error="onImageError"
                />
                <!-- Sin foto: superficie neutra + icono de la categoría en su tono -->
                <span v-else class="product-media-fallback">
                  <component
                    :is="productArt(template).icon"
                    :size="44"
                    class="product-media-icon"
                    :style="{ color: productArt(template).hue }"
                    aria-hidden="true"
                  />
                </span>
              </span>

              <!-- Datos: nombre, descripción real del backend, precio + acción -->
              <span class="product-info">
                <span class="product-name">{{ template.name }}</span>
                <span v-if="descriptionOf(template) !== ''" class="product-desc">
                  {{ descriptionOf(template) }}
                </span>
                <span class="product-foot">
                  <span class="product-price">{{ formatMoney(template.basePrice) }}</span>
                  <span class="product-add" aria-hidden="true">
                    <Plus :size="18" />
                  </span>
                </span>
              </span>
            </div>

          </div>
          <div
            v-if="!isExtrasTab && filteredTemplates.length === 0"
            class="menu-empty"
          >
            <Search :size="44" class="menu-empty-icon" aria-hidden="true" />
            <p>No se encontraron productos.</p>
            <span class="menu-empty-hint">Prueba con otro nombre o cambia de categoría.</span>
          </div>
        </div>
      </section>

      <!-- ================= ORDER PANEL (290px / tab 2 phone) ================= -->
      <aside
        v-show="!isPhone || phoneTab === 1"
        class="order-panel"
        data-testid="order-panel"
      >
        <!-- Header: título + contador, toggle tipo, formularios condicionales -->
        <div class="op-header">
          <div class="op-title-row">
            <h2 class="op-title">Orden Actual</h2>
            <span v-if="!cart.isEmpty" class="op-count">{{ cartItemsUnitCount() }}</span>
          </div>

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

        <!-- Banner gate de caja (Fase 1-P1): sin sesión OPEN del piso 1 el
             pago LOCAL está bloqueado; guardar pendiente/externo sigue vivo. -->
        <AppBanner
          v-if="showCashGateBanner"
          type="warning"
          class="op-cash-banner"
          data-testid="cash-gate-banner"
        >
          Inicia sesión de caja para vender
        </AppBanner>

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

            <!-- Acciones: nota al blur + -/qty/+/editar/eliminar (L1140-1188) -->
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
              <div class="op-item-qty-row">
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
            </div>
          </li>
        </ul>

        <!-- Footer con totales + previews + acción única (réplica L432-806) -->
        <footer class="op-footer">
          <!-- Desglose: solo lo que el backend cobra (sin impuestos ni descuentos
               inventados: CrazyWings opera taxRate 0.0 y no tiene descuentos) -->
          <div v-if="!cart.isEmpty" class="op-breakdown">
            <div class="op-breakdown-row">
              <span>Subtotal</span>
              <span class="op-breakdown-value">{{ formatMoney(cart.subtotal) }}</span>
            </div>
            <div class="op-breakdown-row op-breakdown-row--muted">
              <span>Artículos</span>
              <span class="op-breakdown-value">{{ cartItemsUnitCount() }}</span>
            </div>
          </div>

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
   POS PISO 1 · rediseño premium (rama ui-exp)
   SOLO PRESENTACIÓN: ningún selector de aquí altera lógica, contratos ni
   flujo de venta. Tokens de src/style.css; naranja reservado a la acción
   principal y a la selección.
   ========================================================================== */

/* Layout raíz: menú flexible + panel de orden fijo.
   Altura 100% (no 100vh): el shell ya define el alto del viewport y reserva el
   espacio del bottom nav en móvil. Con 100vh la vista se salía 64px y el nav
   tapaba el CTA del panel. */
.pos {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
}

.pos-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 80px 24px;
  color: var(--text-2);
}

.pos-body {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
}

/* ==========================================================================
   MENÚ
   ========================================================================== */
.menu {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* Header: título + fecha a la izquierda, buscador ancho a la derecha */
.menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 18px 20px 14px;
}

.menu-header-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: none;
}

.menu-title {
  margin: 0;
  font-size: var(--text-h1);
  line-height: 1.2;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text-1);
  white-space: nowrap;
}

.menu-date {
  font-size: 12.5px;
  color: var(--text-2);
  white-space: nowrap;
}

/* Buscador: ocupa el ancho disponible (referencia: barra protagonista) */
.menu-search {
  position: relative;
  flex: 1;
  max-width: 560px;
  min-width: 0;
}

.menu-search-icon {
  position: absolute;
  top: 50%;
  left: 14px;
  transform: translateY(-50%);
  color: var(--text-3);
  pointer-events: none;
}

.menu-search-input {
  width: 100%;
  height: 46px;
  padding: 0 14px 0 40px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-full);
  color: var(--text-1);
  font-family: var(--font);
  font-size: var(--text-body);
  outline: none;
  transition:
    border-color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

.menu-search-input::placeholder {
  color: var(--text-3);
}

.menu-search-input:focus {
  background: var(--elevated);
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}

/* Pills de categoría: icono en tile + label, activo sólido naranja */
.menu-tabs {
  padding: 0 20px;
}

.menu-tabs-scroll {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  white-space: nowrap;
  padding-bottom: 4px;
  scrollbar-width: none;
}

.menu-tabs-scroll::-webkit-scrollbar {
  display: none;
}

.menu-tab {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  flex: none;
  min-height: 48px;
  padding: 5px 16px 5px 5px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-full);
  color: var(--text-2);
  font-family: var(--font);
  font-size: var(--text-sm);
  font-weight: 500;
  letter-spacing: -0.005em;
  cursor: pointer;
  transition:
    color var(--dur) var(--ease),
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease);
}

.menu-tab-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-2);
  transition:
    background var(--dur) var(--ease),
    color var(--dur) var(--ease);
}

.menu-tab-label {
  padding-right: 4px;
}

@media (hover: hover) {
  .menu-tab:hover {
    color: var(--text-1);
    border-color: var(--border);
  }
}

.menu-tab--active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
  font-weight: 600;
}

.menu-tab--active .menu-tab-icon {
  background: rgba(255, 255, 255, 0.2);
  color: var(--on-primary);
}

.menu-divider {
  height: 1px;
  background: var(--border-soft);
  margin: 12px 20px 0;
}

/* Grid: alto de fila por aspect-ratio del card (ancho/alto) */
.menu-grid-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  min-height: 0;
}

.menu-grid {
  display: grid;
  gap: 14px;
  grid-auto-rows: auto;
}

/* Estado vacío */
.menu-empty {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 56px 24px;
  text-align: center;
  color: var(--text-2);
  font-size: var(--text-body);
}

.menu-empty p {
  margin: 0;
  font-weight: 500;
  color: var(--text-2);
}

.menu-empty-hint {
  color: var(--text-3);
  font-size: var(--text-sm);
}

.menu-empty-icon {
  color: var(--text-3);
  opacity: 0.45;
}

/* ==========================================================================
   TARJETA DE PRODUCTO
   Media arriba (foto o arte por categoría) + datos + precio con acción.
   ========================================================================== */
.product-card {
  display: flex;
  flex-direction: column;
  aspect-ratio: 1.06;
  min-width: 0;
  overflow: hidden;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  cursor: pointer;
  user-select: none;
  transition:
    border-color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease),
    transform var(--dur) var(--ease);
}

@media (hover: hover) {
  .product-card:hover {
    /* Fallback estático (WebView Android viejo sin color-mix) */
    border-color: #80422c;
    border-color: color-mix(in srgb, var(--primary) 40%, var(--border-soft));
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
  }

  .product-card:hover .product-add {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--on-primary);
  }
}

.product-card:active {
  transform: scale(0.99);
}

.product-card:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

/* Media: ocupa el bloque superior; la foto manda si existe */
.product-media {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.03);
}

.product-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* Arte de respaldo: superficie neutra con el icono de la categoría en su tono.
   No simula una foto: es un marcador limpio que desaparece cuando hay imagen. */
.product-media-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(120% 100% at 50% 0%, rgba(255, 255, 255, 0.045), transparent 70%),
    var(--elevated);
}

.product-media-icon {
  opacity: 0.9;
  transition: transform var(--dur) var(--ease);
}

.product-card:hover .product-media-icon {
  transform: scale(1.06);
}

/* Datos: nombre dominante, descripción secundaria, precio + botón */
.product-info {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px 12px;
}

.product-name {
  color: var(--text-1);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.product-desc {
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.product-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 4px;
}

.product-price {
  color: var(--text-1);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.015em;
  font-variant-numeric: tabular-nums;
}

/* Afordance de "agregar": neutro hasta el hover, entonces acento */
.product-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-soft);
  color: var(--text-2);
  transition:
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease),
    color var(--dur) var(--ease);
}

/* ==========================================================================
   TARJETA DE EXTRA (tap agrega directo al carrito)
   ========================================================================== */
.extra-card {
  display: flex;
  flex-direction: column;
  aspect-ratio: 1.06;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  font-family: var(--font);
  text-align: left;
  cursor: pointer;
  user-select: none;
  transition:
    border-color var(--dur) var(--ease),
    transform var(--dur) var(--ease);
}

@media (hover: hover) {
  .extra-card:hover {
    /* Fallback estático (WebView Android viejo sin color-mix) */
    border-color: #80422c;
    border-color: color-mix(in srgb, var(--primary) 40%, var(--border-soft));
    transform: translateY(-2px);
  }
}

.extra-card:active {
  transform: scale(0.99);
}

.extra-card:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.extra-card-top {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(120% 100% at 50% 0%, rgba(255, 255, 255, 0.045), transparent 70%),
    var(--elevated);
}

.extra-card-icon {
  color: var(--primary);
  opacity: 0.9;
  transition: transform var(--dur) var(--ease);
}

.extra-card:hover .extra-card-icon {
  transform: scale(1.06);
}

.extra-card-bottom {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 14px;
}

.extra-card-name {
  color: var(--text-1);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
}

.extra-card-price {
  color: var(--text-2);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

/* ==========================================================================
   PANEL DE ORDEN
   ========================================================================== */
.order-panel {
  width: 320px;
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-soft);
}

/* Tablet ancha: panel más angosto para no ahogar el grid */
@media (max-width: 1200px) {
  .order-panel {
    width: 300px;
  }
}

@media (max-width: 900px) {
  .order-panel {
    width: 288px;
  }
}

/* Tablet vertical (768x1024): el panel lateral deja tarjetas de 113px, así que
   se apila debajo — hay altura suficiente para que siga siendo usable. */
@media (max-width: 880px) and (min-width: 700px) {
  .pos-body {
    flex-direction: column;
  }

  /* Sin min-height:0 el menú no encoge en columna y el panel queda aplastado */
  .menu {
    min-height: 0;
  }

  .order-panel {
    width: 100%;
    flex: 0 0 auto;
    height: 56vh;
    max-height: 56vh;
    border-left: none;
    border-top: 1px solid var(--border-soft);
  }

  .op-empty {
    padding: 16px;
  }

  .op-header {
    padding: 12px 16px 10px;
    gap: 10px;
  }

  /* Pie compacto: el desglose y el CTA importan, los huecos no */
  .op-footer {
    padding: 10px 16px 12px;
    gap: 8px;
  }

  .op-breakdown {
    gap: 4px;
    padding-bottom: 8px;
  }

  .op-total-value {
    font-size: 24px;
  }

  .op-btn {
    min-height: 46px;
    padding: 12px 16px;
  }
}

.op-header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  padding: 18px 16px 14px;
}

.op-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.op-title {
  margin: 0;
  font-size: var(--text-h3);
  font-weight: 600;
  letter-spacing: -0.015em;
  color: var(--text-1);
}

/* Contador de artículos: pill neutra, no compite con el CTA */
.op-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 8px;
  background: var(--primary-soft);
  border-radius: var(--radius-full);
  color: var(--primary);
  font-size: var(--text-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* Toggle tipo de orden: riel de superficie, activo sólido naranja */
.op-toggle {
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}

.op-toggle-seg {
  flex: 1;
  min-height: 36px;
  padding: 0 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: calc(var(--radius-md) - 4px);
  color: var(--text-2);
  font-family: var(--font);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    color var(--dur) var(--ease);
}

@media (hover: hover) {
  .op-toggle-seg:hover {
    color: var(--text-1);
    background: rgba(255, 255, 255, 0.04);
  }
}

.op-toggle-seg--active {
  background: var(--primary);
  color: var(--on-primary);
  font-weight: 600;
}

.op-toggle-seg--active:hover {
  color: var(--on-primary);
}

/* Form UBER/DIDI: superficie neutra con acento en el borde izquierdo */
.op-platform-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-left: 3px solid var(--primary);
  border-radius: var(--radius);
}

.op-platform-label {
  color: var(--text-2);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.op-platform-input-wrap {
  position: relative;
}

.op-platform-icon {
  position: absolute;
  top: 50%;
  left: 11px;
  transform: translateY(-50%);
  color: var(--text-3);
  pointer-events: none;
}

.op-platform-input {
  width: 100%;
  height: 42px;
  padding: 0 12px 0 34px;
  background: var(--elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
  font-family: var(--font);
  font-size: var(--text-sm);
  outline: none;
  transition:
    border-color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease);
}

.op-platform-input::placeholder {
  color: var(--text-3);
}

.op-platform-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}

.op-external-form {
  /* el hijo trae sus propios estilos */
}

.op-divider {
  height: 1px;
  background: var(--border-soft);
}

/* Vacío */
.op-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 20px;
  color: var(--text-3);
  font-size: var(--text-body);
  text-align: center;
}

/* Lista de líneas */
.op-items {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin: 0;
  padding: 10px 16px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Cada línea es una superficie propia: se lee como recibo, no como tabla */
.op-item {
  padding: 12px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}

.op-item-top {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}

.op-item-media {
  flex: none;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border-soft);
}

.op-item-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.op-item-media-icon {
  color: var(--text-2);
  opacity: 0.75;
}

.op-item-mid {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.op-item-name {
  color: var(--text-1);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.op-item-unit {
  color: var(--text-2);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}

.op-item-total {
  flex: none;
  text-align: right;
  color: var(--text-1);
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* Meta bajo la fila, alineada con el nombre */
.op-item-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 55px;
  margin-top: 6px;
}

.op-item-meta-title {
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 600;
}

.op-item-meta-line {
  color: var(--text-2);
  font-size: 12.5px;
  word-break: break-word;
}

.op-item-notes {
  margin-top: 6px;
}

.op-item-note-line {
  color: var(--text-2);
  font-size: 12.5px;
  word-break: break-word;
}

/* Acciones de la línea: nota arriba (ancho completo) y stepper debajo.
   En 320px, compartir fila cortaba el placeholder ("Nota adi…"). */
.op-item-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-soft);
}

.op-item-qty-row {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: flex-end;
}

.op-item-note-input {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-1);
  font-family: var(--font);
  font-size: 12.5px;
  outline: none;
  transition:
    border-color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

.op-item-note-input::placeholder {
  color: var(--text-3);
}

.op-item-note-input:hover {
  background: rgba(255, 255, 255, 0.03);
}

.op-item-note-input:focus {
  background: var(--elevated);
  border-color: var(--primary);
}

.op-qty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-2);
  cursor: pointer;
  transition:
    color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

@media (hover: hover) {
  .op-qty:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-1);
  }
}

.op-qty--danger {
  color: var(--text-3);
}

.op-qty--danger:hover {
  background: var(--error-soft);
  color: var(--error);
}

.op-qty-num {
  min-width: 26px;
  text-align: center;
  color: var(--text-1);
  font-weight: 600;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

/* Footer: desglose + total + acción */
.op-footer {
  flex: none;
  padding: 14px 16px 16px;
  background: var(--bg-surface);
  border-top: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.op-cash-banner {
  margin: 0 16px 4px;
  font-size: var(--text-xs);
  padding: 8px 10px;
}

/* Desglose: filas discretas, valores tabulares */
.op-breakdown {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-soft);
}

.op-breakdown-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-2);
  font-size: var(--text-sm);
}

.op-breakdown-value {
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}

.op-breakdown-row--muted .op-breakdown-value {
  color: var(--text-2);
}

.op-total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.op-total-label {
  color: var(--text-2);
  font-size: var(--text-body);
  font-weight: 500;
}

/* Total: cifra protagonista de la pantalla, tabular */
.op-total-value {
  color: var(--text-1);
  font-size: 28px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.025em;
  font-variant-numeric: tabular-nums;
}

/* Previews de ticket: acciones secundarias, superficie neutra */
.op-previews {
  display: flex;
  gap: 8px;
}

.op-preview {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  flex: none;
  padding: 0;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  color: var(--text-2);
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease),
    color var(--dur) var(--ease);
}

@media (hover: hover) {
  .op-preview:hover {
    border-color: var(--border);
    color: var(--text-1);
  }
}

/* CTA principal: el único naranja sólido de la pantalla */
.op-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 50px;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  font-family: var(--font);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    color var(--dur) var(--ease),
    border-color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease);
}

.op-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
}

.op-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.op-btn--primary:active:not(:disabled) {
  transform: scale(0.995);
}

.op-btn--primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Guardar Orden: superficie neutra con acento (un solo CTA sólido) */
.op-btn--save {
  background: var(--card);
  color: var(--primary);
  /* Fallback estático (WebView Android viejo sin color-mix) */
  border-color: #7a462f;
  border-color: color-mix(in srgb, var(--primary) 45%, transparent);
}

.op-btn--save:hover:not(:disabled) {
  background: var(--primary-subtle);
  border-color: var(--primary);
}

.op-btn--save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ==========================================================================
   RESPONSIVE
   ========================================================================== */

/* Tablet: se mantiene el panel lateral (es la herramienta de cobro), solo se
   ajustan márgenes. Apilar el panel lo deja inutilizable en 1024x768. */
@media (max-width: 1024px) {
  .menu-grid-wrap {
    padding: 12px 16px;
  }

  .menu-header,
  .menu-tabs {
    padding-left: 16px;
    padding-right: 16px;
  }

  .menu-divider {
    margin-left: 16px;
    margin-right: 16px;
  }

  .menu-title {
    font-size: 20px;
  }
}

/* Tarjetas más altas en pantallas estrechas (equivalente al aspect 1.1) */
@media (max-width: 515px) {
  .product-card,
  .extra-card {
    aspect-ratio: 0.98;
  }
}

/* ==========================================================================
   PHONE (<700px): TabBar Menú | Orden a pantalla completa
   ========================================================================== */
.pos-body--phone {
  flex-direction: column;
}

.phone-tabs {
  display: none;
}

@media (max-width: 699px) {
  .pos-body--phone {
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .phone-tabs {
    display: flex;
    flex: none;
    gap: 4px;
    padding: 8px 12px 0;
    background: var(--bg);
  }

  .phone-tab {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 44px;
    padding: 8px 10px;
    background: transparent;
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-md);
    color: var(--text-2);
    font-family: var(--font);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease),
      border-color var(--dur) var(--ease);
  }

  .phone-tab--active {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--on-primary);
    font-weight: 600;
  }

  .order-panel {
    width: 100%;
    flex: 1;
    min-height: 0;
    border-top: none;
  }

  .menu-header {
    flex-wrap: wrap;
    gap: 12px;
    padding: 14px 12px 10px;
  }

  .menu-search {
    flex: 1 0 100%;
    max-width: none;
  }

  .menu-search-input {
    height: 44px;
  }

  .menu-tabs {
    padding: 0 12px;
  }

  .menu-divider {
    margin: 10px 12px 0;
  }

  .menu-grid {
    gap: 10px;
  }

  .menu-grid-wrap {
    padding: 12px;
  }

  .product-name {
    font-size: 14px;
  }

  .product-desc {
    -webkit-line-clamp: 1;
  }

  .product-price {
    font-size: 15px;
  }

  .op-header {
    padding: 14px 12px 12px;
  }

  .op-items {
    padding: 10px 12px;
  }

  .op-footer {
    padding: 12px;
  }
}

/* Respeta la preferencia de movimiento reducido */
@media (prefers-reduced-motion: reduce) {
  .product-card,
  .extra-card,
  .menu-tab,
  .op-qty,
  .op-preview,
  .op-btn {
    transition: none;
  }

  .product-card:hover,
  .extra-card:hover {
    transform: none;
  }
}
</style>
