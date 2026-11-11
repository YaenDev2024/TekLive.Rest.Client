<script setup lang="ts">
/**
 * DynamicOptionsModal · WIZARD de opciones dinámicas (ronda 5).
 *
 * Réplica EXACTA de DynamicProductWizardDialog (dynamic_product_stepper_dialog.dart,
 * clase en L1415) del POS CrazyWings Flutter:
 *
 * - Dialog a pantalla completa bg #212121 radius 28, inset 40h/60v, con 2 paneles:
 *   · IZQUIERDO 200px tipo ticket (L3081-3173): bg grey[950] #101010, border-right
 *     2px grey[800], header 'Orden Actual' 18px bold + nombre deepOrange bold 16,
 *     divider, contenido scroll = preview en vivo por grupo (_buildOrderPreview),
 *     footer 'Subtotal:' + total deepOrange bold 16.
 *   · DERECHO (L3177-3281): header solo con X 32px alineado derecha; contenido
 *     scroll padding 36: nombre del grupo 26px w900 → banner azul (bg rgba(33,150,243,.12),
 *     border 2px rgba(33,150,243,.35), radius 14, icono lightbulb + descripción
 *     blue[100] 15 w600) → grid de cards (5/6/7 cols según width, aspect 1.05).
 * - Footer wizard (L3283-3356): bg #303030, border-top 1.5px #616161, padding
 *   32h/28v — 'Atrás' (grey[700]) / 'Siguiente'-'Confirmar' (deepOrange),
 *   disabled si el paso no es válido (_isStepValid).
 * - Cards (L3726-3856): radius 16, bg grey[800]/border 1.5 grey[700]; seleccionada
 *   bg deepOrange alpha .30 + border 3 deepOrange; badge verde '+$X' si suma;
 *   salsas (max>1) con steppers ± y qty; check badge circular si seleccionada
 *   (no para complementos).
 * - Estado (L1418-1437): selections Map<groupId, number[]> (salsas/complementos
 *   con REPETIDOS = cantidad), _mixtoSelections {mitad: salsa}, _salsaAparte
 *   {salsa: qty}, _salsaExtra string, _complementQuantities visual.
 * - _selectValue (L1962-2113): complementos por TAPS (1=add, 2=duplica, 3=remueve),
 *   salsas max>1 acumulan qty (sin tope), single alterna/reemplaza; al elegir
 *   MIXTO/NATURAL/SALSA EXTRA abre su sub-diálogo.
 * - _nextStep/_previousStep (L2153-2228): saltan grupo SALSAS/SABOR si MIXTO o
 *   SALSA EXTRA activos (adelante y atrás).
 * - Precio (L2231-2369 _calculateLocalTotalPrice): base + modifiers por entrada
 *   (repetidos incluidos); BONELESS en el PRIMER grupo → valores BAÑADA gratis;
 *   producto ENSALADA no cobra grupos SALSA/SABOR.
 * - Nota final (_addItemToOrder L2608-2750): líneas por grupo — complementos
 *   'A + B', salsas '2x BBQ', normales 'A, B'; MIXTO → 'MIXTO' + '  - Mitad X: Y';
 *   NATURAL → '{qty}x SALSA APARTE DE X'; SALSA EXTRA → '  - {elección}'.
 *   Viaja en optionsSummary (el cart store lo envuelve con OPT::).
 * - Sub-diálogos (L3866-4857): Mitades Mixto (+salsa por mitad, Natural→aparte),
 *   Salsa Natural (solo/aparte con steppers), Salsa Extra (+variante aparte).
 * - Emite al carrito vía cart.addDynamicItem (selectedOptions con repetidos +
 *   optionsSummary formato Flutter + note ''). Modo edición (editKey) → replaceKey.
 *
 * Interfaz con PosPiso1View (misma que ronda 3 + initialSummary para restaurar
 * mitades/salsas-aparte que no viven en las selecciones estructurales).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, Check, CircleMinus, CirclePlus, Lightbulb, ReceiptText, X } from 'lucide-vue-next'
import type {
  CatalogOptionGroup,
  CatalogOptionValue,
  CatalogTemplate,
  OrderItemSelectedOption,
} from '../../api/pos-types'
import { useCartStore } from '../../stores/cart'
import { useToastStore } from '../../stores/toast'

const props = defineProps<{
  template: CatalogTemplate
  /** Ronda 5 (edición): groupId → valueIds ya elegidos (repetidos = qty salsas). */
  initialSelections?: OrderItemSelectedOption[] | null
  /** Ronda 5 (edición): dynamicOptionsSummary de la línea (mitades MIXTO y
   * salsas aparte no viven en las selecciones estructurales). */
  initialSummary?: string
  /** Ronda 3 (compat): nota del usuario de la línea original. El wizard Flutter
   * no tiene textarea de nota y emite note='' (additionalNote L2751). */
  initialNote?: string
  /** Ronda 3 (edición): key de la línea a reemplazar al confirmar. */
  editKey?: string
}>()

const emit = defineEmits<{ close: [] }>()

const cart = useCartStore()
const toast = useToastStore()

// --- Narrow layout (réplica DynamicProductWizardDialog L2896-2899: el .dart
// SÍ define layout narrow <900px de ancho o <700px de alto) ---------------
const isNarrow = ref(false)
let narrowMq: MediaQueryList | null = null
function onNarrowMq(e: MediaQueryListEvent | MediaQueryList): void {
  isNarrow.value = e.matches
  if (!e.matches) ticketExpanded.value = false
}

/** En narrow el ticket lateral se colapsa a la barra superior; esto controla
 * el resumen desplegable (desviación documentada: el .dart muestra el resumen
 * SIEMPRE inline al final del scroll; aquí es colapsable para no empujar el
 * grid fuera de pantalla con teclado). */
const ticketExpanded = ref(false)

onMounted(() => {
  narrowMq = matchMedia('(max-width: 899px), (max-height: 699px)')
  isNarrow.value = narrowMq.matches
  narrowMq.addEventListener('change', onNarrowMq)
})

onBeforeUnmount(() => {
  narrowMq?.removeEventListener('change', onNarrowMq)
  narrowMq = null
})

// ---------------------------------------------------------------------------
// Estado (réplica L1418-1437)
// ---------------------------------------------------------------------------

/** groupId → ids seleccionados. Salsas/complementos con REPETIDOS = cantidad.
 * Grupos single también viven como lista de 1 (uniforme para el emit). */
const selections = ref<Map<number, number[]>>(new Map())
const currentStep = ref(0)

/** MIXTO: {mitadName → salsaName} en orden de inserción. */
const mixtoSelections = ref<Map<string, string>>(new Map())
/** NATURAL → salsas aparte {salsaName → qty}. */
const salsaAparte = ref<Map<string, number>>(new Map())
/** SALSA EXTRA: valor elegido en el sub-diálogo. */
const salsaExtra = ref<string | null>(null)
/** Cantidades visuales {groupId_valueId → count} (complementos/salsas). */
const complementQuantities = ref<Map<string, number>>(new Map())
/** Taps para complementos {groupId_valueId → taps}. */
const tapCounts = ref<Map<string, number>>(new Map())

/** Sub-diálogo activo (confirmación + especiales). */
type SubDialog =
  | 'none'
  | 'confirm'
  | 'mixto'
  | 'salsa-mitad'
  | 'natural-mitad'
  | 'aparte-mitad'
  | 'natural'
  | 'aparte'
  | 'extra'
  | 'extra-natural'
  | 'extra-aparte'
const activeDialog = ref<SubDialog>('none')
/** Mitad en curso en los sub-diálogos de MIXTO ('BONELESS' | 'ALITAS'). */
const activeMitad = ref<string | null>(null)

// ---------------------------------------------------------------------------
// Prefill de edición (réplica _loadProductTemplate L1859-1880 +
// _restoreMixtoHalvesFromSummary L1535 + _loadPreviousSelections L1576)
// ---------------------------------------------------------------------------

/** Restaura mitades MIXTO y salsas aparte desde el resumen guardado. */
function restoreSpecialFromSummary(summary: string | undefined): void {
  if (summary == null || summary.trim() === '') return
  if (mixtoSelections.value.size > 0) return
  let clean = summary
    .replaceAll('OPT::', '')
    .replaceAll('NOTE::', '')
    .replaceAll('NOTA::', '')
    .trim()
  clean = clean.replaceAll(' | ', '\n')
  const lines = clean.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  if (lines.length === 0) return

  // Mitades: "  - Mitad BONELESS: BBQ" (formato "MIXTO\n - Mitad ...")
  if (lines[0].toUpperCase() === 'MIXTO') {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line.startsWith('- Mitad')) continue
      const mitad = line.replace('- Mitad ', '')
      const idx = mitad.indexOf(':')
      if (idx !== -1) {
        mixtoSelections.value.set(mitad.slice(0, idx).trim(), mitad.slice(idx + 1).trim())
      }
    }
  }

  // Salsas aparte: "1x SALSA APARTE DE BBQ" (qualquier línea)
  for (const line of lines) {
    const m = line.match(/(\d+)x\s+salsa\s+aparte\s+de\s+(.+)/i)
    if (m != null) {
      const qty = Number.parseInt(m[1] ?? '1', 10) || 1
      const salsa = (m[2] ?? '').trim()
      if (salsa !== '') salsaAparte.value.set(salsa, qty)
    }
  }
}

/** Parsea el resumen legacy "GroupName: v1, v2" / líneas sueltas a selecciones
 * (solo si NO hay selecciones estructurales — réplica _loadPreviousSelections). */
function restoreSelectionsFromSummary(summary: string | undefined): void {
  if (summary == null || summary.trim() === '') return
  let clean = summary
    .replaceAll('OPT::', '')
    .replaceAll('NOTE::', '')
    .replaceAll('NOTA::', '')
    .trim()
  clean = clean.replaceAll(' | ', '\n')
  const lines = clean.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  if (lines.length === 0) return

  // Formato nuevo: "GroupName: value1, value2"
  let matchedNew = false
  for (const line of lines) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const groupName = line.slice(0, idx).trim()
    const values = line.slice(idx + 1).trim()
    const group = props.template.optionGroups.find((g) => g.name === groupName)
    if (group == null) continue
    matchedNew = true
    const ids: number[] = []
    for (const valName of values.split(',').map((v) => v.trim())) {
      const value = group.values.find((v) => v.name === valName)
      if (value != null) ids.push(value.id)
    }
    if (ids.length > 0) selections.value.set(group.id, ids)
  }
  if (matchedNew) return

  // Formato viejo: valores sueltos, match lineal con grupos en orden.
  let groupIndex = 0
  for (const line of lines) {
    if (groupIndex >= props.template.optionGroups.length) break
    let matched = false
    for (let i = groupIndex; i < props.template.optionGroups.length && !matched; i++) {
      const group = props.template.optionGroups[i]
      const value = group.values.find((v) => v.name === line.trim())
      if (value != null) {
        matched = true
        selections.value.set(group.id, [value.id])
        groupIndex = i + 1
      }
    }
  }
}

// Prefill (setup corre una vez por instancia del modal).
if (props.initialSelections != null && props.initialSelections.length > 0) {
  for (const sel of props.initialSelections) {
    selections.value.set(sel.groupId, [...sel.valueIds])
    // Cantidades visuales para salsas/complementos con repetidos.
    for (const id of new Set(sel.valueIds)) {
      const count = sel.valueIds.filter((v) => v === id).length
      if (count > 1) complementQuantities.value.set(`${sel.groupId}_${id}`, count)
    }
  }
} else {
  restoreSelectionsFromSummary(props.initialSummary)
}
restoreSpecialFromSummary(props.initialSummary)

// Reset al cambiar de template (reuso del modal en la misma vista).
watch(
  () => props.template.id,
  () => {
    selections.value = new Map()
    mixtoSelections.value = new Map()
    salsaAparte.value = new Map()
    salsaExtra.value = null
    complementQuantities.value = new Map()
    tapCounts.value = new Map()
    currentStep.value = 0
    activeDialog.value = 'none'
    activeMitad.value = null
  },
)

// ---------------------------------------------------------------------------
// Grupos visibles (conditionalRules) + helpers por nombre
// ---------------------------------------------------------------------------

const visibleGroups = computed<CatalogOptionGroup[]>(() => {
  const rules = props.template.conditionalRules
  return props.template.optionGroups.filter((group) => {
    let shouldShow = true
    for (const rule of rules) {
      if (rule.targetGroupId === group.id) {
        const triggerSelection = selections.value.get(rule.triggerGroupId) ?? []
        const triggerSelected =
          rule.triggerValueId != null
            ? triggerSelection.includes(rule.triggerValueId)
            : triggerSelection.length > 0
        const action = rule.action?.toLowerCase()
        if (action === 'hide' && triggerSelected) shouldShow = false
        if (action === 'show' && !triggerSelected) shouldShow = false
      }
    }
    return shouldShow
  })
})

/** Réplica _isComplementsGroup (L2116): COMPLEMENT / ACOMPAÑAMIENTO. */
function isComplementsGroup(group: CatalogOptionGroup): boolean {
  const upper = group.name.toUpperCase()
  return upper.includes('COMPLEMENT') || upper.includes('ACOMPAÑAMIENTO')
}

/** Réplica _isSalsaGroup (L2122): SALSA / SABOR. */
function isSalsaGroup(group: CatalogOptionGroup): boolean {
  const upper = group.name.toUpperCase()
  return upper.includes('SALSA') || upper.includes('SABOR')
}

function isSalsasLikeName(name: string): boolean {
  const upper = name.toUpperCase()
  return upper.includes('SALSA') || upper.includes('SABOR')
}

/** Réplica banner _getGroupDescription (L3631). */
const groupBanner = computed<string>(() => {
  const group = currentGroup.value
  if (group == null) return ''
  if (group.maxSelect > 1) {
    return `Selecciona entre ${group.minSelect} y ${group.maxSelect} opción${group.maxSelect > 1 ? 'es' : ''}`
  }
  return 'Selecciona una opción'
})

// ---------------------------------------------------------------------------
// Reglas BONELESS/BAÑADA/ENSALADA (precio L2271-2363, filtro cards L3659-3694)
// ---------------------------------------------------------------------------

function normalizeUpper(s: string): string {
  return s
    .toUpperCase()
    .replaceAll('Á', 'A')
    .replaceAll('É', 'E')
    .replaceAll('Í', 'I')
    .replaceAll('Ó', 'O')
    .replaceAll('Ú', 'U')
    .replaceAll('Ñ', 'N')
}

function isBanadaValue(value: CatalogOptionValue): boolean {
  return normalizeUpper(value.name).includes('BANADA')
}

/** BONELESS seleccionado en el PRIMER grupo del template (para el precio). */
const hasBonelessInFirstGroup = computed<boolean>(() => {
  const first = props.template.optionGroups[0]
  if (first == null) return false
  const ids = selections.value.get(first.id) ?? []
  return ids.some((id) => {
    const v = first.values.find((val) => val.id === id)
    return v != null && normalizeUpper(v.name).includes('BONELESS')
  })
})

/** BONELESS seleccionado dentro de UN grupo dado (para filtrar BAÑADA). */
function hasBonelessInGroup(group: CatalogOptionGroup): boolean {
  const ids = selections.value.get(group.id) ?? []
  return ids.some((id) => {
    const v = group.values.find((val) => val.id === id)
    return v != null && normalizeUpper(v.name).includes('BONELESS')
  })
}

const isEnsaladaProduct = computed<boolean>(() =>
  normalizeUpper(props.template.name).includes('ENSALADA'),
)

// ---------------------------------------------------------------------------
// Precio local (réplica _calculateLocalTotalPrice L2231-2369)
// ---------------------------------------------------------------------------

const unitPrice = computed<number>(() => {
  let total = props.template.basePrice
  for (const group of props.template.optionGroups) {
    const ids = selections.value.get(group.id)
    if (ids == null) continue
    const skipSalsa = isEnsaladaProduct.value && isSalsasLikeName(group.name)
    for (const valueId of ids) {
      const value = group.values.find((v) => v.id === valueId)
      if (value == null) continue
      if (isBanadaValue(value) && hasBonelessInFirstGroup.value) continue // BAÑADA gratis con BONELESS
      if (skipSalsa) continue
      total += value.price
    }
  }
  return total
})

// ---------------------------------------------------------------------------
// Validación por paso (réplica _isStepValid L1895-1960 +
// validateQuantityGroupSelections L21-29)
// ---------------------------------------------------------------------------

function stepValid(index: number): boolean {
  const groups = visibleGroups.value
  if (index >= groups.length) return true
  const group = groups[index]

  // TAMAÑO: SALSA EXTRA exige sub-selección (L1900-1924).
  if (group.name.toUpperCase().includes('TAMAÑO')) {
    const ids = selections.value.get(group.id) ?? []
    const hasExtra = ids.some((id) => {
      const v = group.values.find((val) => val.id === id)
      return v != null && v.name.toUpperCase() === 'SALSA EXTRA'
    })
    if (hasExtra && (salsaExtra.value == null || salsaExtra.value === '')) return false
  }

  // MIXTO activo → grupo Salsas/Sabor se considera válido (se salta).
  if (mixtoSelections.value.size > 0) {
    const upper = group.name.toUpperCase()
    if (upper === 'SALSAS' || upper.includes('SABOR')) return true
  }

  const ids = selections.value.get(group.id) ?? []
  if (group.minSelect > 0 && ids.length === 0) return false
  if (ids.length > 0) {
    const isQuantityGroup = isComplementsGroup(group) || isSalsaGroup(group)
    if (isQuantityGroup) {
      // Mínimo por TOTAL de entradas; máximo por variedades ÚNICAS.
      if (ids.length < group.minSelect) return false
      if (new Set(ids).size > group.maxSelect) return false
    } else {
      if (ids.length < group.minSelect) return false
      if (ids.length > group.maxSelect) return false
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Selección (réplica _selectValue L1962-2113 + _adjustQuantity L2127-2151)
// ---------------------------------------------------------------------------

function adjustQuantity(group: CatalogOptionGroup, valueId: number, delta: number): void {
  const tapKey = `${group.id}_${valueId}`
  const list = selections.value.get(group.id) ?? []
  const current = list.filter((id) => id === valueId).length
  const newCount = Math.min(999, Math.max(0, current + delta))

  const next = list.filter((id) => id !== valueId)
  for (let i = 0; i < newCount; i++) next.push(valueId)
  if (next.length > 0) selections.value.set(group.id, next)
  else selections.value.delete(group.id)

  if (newCount > 0) complementQuantities.value.set(tapKey, newCount)
  else complementQuantities.value.delete(tapKey)
}

function selectValue(group: CatalogOptionGroup, value: CatalogOptionValue): void {
  const tapKey = `${group.id}_${value.id}`
  const selectedName = value.name.toUpperCase()
  let maxReached = false

  // Salsa aparte se limpia al elegir otra salsa del grupo (no NATURAL).
  if (isSalsaGroup(group) && selectedName !== 'NATURAL') {
    salsaAparte.value = new Map()
  }

  if (isComplementsGroup(group)) {
    // TAPS: 1 = agregar, 2 = duplicar, 3+ = remover.
    const list = selections.value.get(group.id) ?? []
    const maxAllowed = group.maxSelect > 0 ? group.maxSelect : 999
    const taps = (tapCounts.value.get(tapKey) ?? 0) + 1
    if (taps === 1) {
      if (!list.includes(value.id) && list.length < maxAllowed) {
        selections.value.set(group.id, [...list, value.id])
      } else if (!list.includes(value.id)) {
        tapCounts.value.set(tapKey, 0)
        maxReached = true
      } else {
        tapCounts.value.set(tapKey, 1)
      }
    } else if (taps === 2) {
      if (list.length < maxAllowed) {
        selections.value.set(group.id, [...list, value.id])
        tapCounts.value.set(tapKey, 2)
      } else if (list.includes(value.id)) {
        tapCounts.value.set(tapKey, 2) // próximo tap remueve
      } else {
        tapCounts.value.set(tapKey, 1)
        maxReached = true
      }
    } else {
      selections.value.set(group.id, list.filter((id) => id !== value.id))
      if ((selections.value.get(group.id) ?? []).length === 0) selections.value.delete(group.id)
      tapCounts.value.set(tapKey, 0)
    }
    if (selections.value.has(group.id)) {
      const list2 = selections.value.get(group.id) ?? []
      for (const id of new Set(list2)) {
        const count = list2.filter((v) => v === id).length
        complementQuantities.value.set(`${group.id}_${id}`, count)
      }
    }
  } else if (isSalsaGroup(group)) {
    const list = selections.value.get(group.id) ?? []
    if (group.maxSelect <= 1) {
      // Sabor único: tap alterna como selección simple.
      if (list.includes(value.id)) {
        selections.value.delete(group.id)
        complementQuantities.value.delete(tapKey)
      } else {
        for (const key of complementQuantities.value.keys()) {
          if (key.startsWith(`${group.id}_`)) complementQuantities.value.delete(key)
        }
        selections.value.set(group.id, [value.id])
        complementQuantities.value.set(tapKey, 1)
      }
    } else if (list.includes(value.id) || new Set(list).size < group.maxSelect) {
      adjustQuantity(group, value.id, 1)
    } else {
      maxReached = true
    }
  } else {
    // Normal: single alterna/reemplaza; multiple toggle con tope.
    const list = selections.value.get(group.id) ?? []
    if (group.maxSelect === 1) {
      if (list.length === 1 && list[0] === value.id) {
        selections.value.delete(group.id)
      } else {
        selections.value.set(group.id, [value.id])
      }
    } else if (list.includes(value.id)) {
      selections.value.set(group.id, list.filter((id) => id !== value.id))
    } else if (list.length < group.maxSelect) {
      selections.value.set(group.id, [...list, value.id])
    }
  }

  if (maxReached) {
    toast.warning(`Máximo ${group.maxSelect} opciones en ${group.name}`)
    return
  }

  // Valores especiales → sub-diálogo (réplica L2100-2112).
  if (selectedName === 'MIXTO') {
    activeDialog.value = 'mixto'
  } else if (selectedName === 'NATURAL') {
    activeDialog.value = 'natural'
  } else if (selectedName === 'SALSA EXTRA') {
    activeDialog.value = 'extra'
  }
}

/** Click directo en la tarjeta: réplica onTap → +1 en salsas con steppers. */
function onCardClick(group: CatalogOptionGroup, value: CatalogOptionValue): void {
  selectValue(group, value)
}

// ---------------------------------------------------------------------------
// Navegación de pasos (réplica _nextStep/_previousStep L2153-2228)
// ---------------------------------------------------------------------------

const currentGroup = computed<CatalogOptionGroup | null>(() => {
  const groups = visibleGroups.value
  if (groups.length === 0) return null
  const idx = Math.min(currentStep.value, groups.length - 1)
  return groups[idx]
})

const isFirstStep = computed(() => currentStep.value === 0)
const isLastStep = computed(
  () => visibleGroups.value.length > 0 && currentStep.value >= visibleGroups.value.length - 1,
)
const currentStepValid = computed(() => stepValid(Math.min(currentStep.value, visibleGroups.value.length - 1)))

/** Salsa/aparte activas → los grupos SALSAS/SABOR se saltan (L2158-2180). */
function skipSalsaStep(groups: CatalogOptionGroup[], index: number): number {
  if (index < 0 || index >= groups.length) return index
  const upper = groups[index].name.toUpperCase()
  if (upper === 'SALSAS' || upper.includes('SABOR')) return index + 1
  return index
}

function nextStep(): void {
  if (!stepValid(currentStep.value)) return
  const groups = visibleGroups.value
  if (currentStep.value < groups.length - 1) {
    let next = currentStep.value + 1
    if (salsaExtra.value != null && salsaExtra.value !== '' && next < groups.length) {
      const skipped = skipSalsaStep(groups, next)
      if (skipped !== next) next = skipped
    }
    if (mixtoSelections.value.size > 0 && next < groups.length) {
      const skipped = skipSalsaStep(groups, next)
      if (skipped !== next) next = skipped
    }
    if (next < groups.length) currentStep.value = next
    else activeDialog.value = 'confirm'
  } else {
    activeDialog.value = 'confirm'
  }
}

function previousStep(): void {
  if (currentStep.value <= 0) return
  const groups = visibleGroups.value
  let prev = currentStep.value - 1
  if (salsaExtra.value != null && salsaExtra.value !== '' && prev >= 0) {
    const skipped = skipSalsaStep(groups, prev)
    if (skipped !== prev) prev = Math.max(0, skipped)
  }
  if (mixtoSelections.value.size > 0 && prev >= 0) {
    const skipped = skipSalsaStep(groups, prev)
    if (skipped !== prev) prev = Math.max(0, skipped)
  }
  if (prev >= 0) currentStep.value = prev
}

// ---------------------------------------------------------------------------
// Cards visibles: filtro BAÑADA cuando BONELESS está en el MISMO grupo
// (réplica _buildOptionCards L3659-3694)
// ---------------------------------------------------------------------------

function visibleValues(group: CatalogOptionGroup): CatalogOptionValue[] {
  if (hasBonelessInGroup(group)) {
    return group.values.filter((v) => !normalizeUpper(v.name).includes('BAÑADA'))
  }
  return group.values
}

/** qty visual de un valor (repetidos en la lista o contador visual). */
function qtyOf(group: CatalogOptionGroup, value: CatalogOptionValue): number {
  const tapKey = `${group.id}_${value.id}`
  const visual = complementQuantities.value.get(tapKey)
  if (visual != null) return visual
  const list = selections.value.get(group.id)
  if (list == null) return 0
  return list.filter((id) => id === value.id).length
}

function isSelectedCard(group: CatalogOptionGroup, value: CatalogOptionValue): boolean {
  if (isSalsaGroup(group)) return qtyOf(group, value) > 0
  const list = selections.value.get(group.id) ?? []
  return list.includes(value.id)
}

function showSteppers(group: CatalogOptionGroup, value: CatalogOptionValue): boolean {
  return isSalsaGroup(group) && qtyOf(group, value) > 0 && group.maxSelect > 1
}

function priceBadge(value: CatalogOptionValue): string {
  if (value.price <= 0) return ''
  return `+$${Math.round(value.price)}`
}

// ---------------------------------------------------------------------------
// Preview del ticket (réplica _buildOrderPreview/_buildPreviewGroup L3368-3629)
// ---------------------------------------------------------------------------

interface PreviewRow {
  text: string
  tone: 'normal' | 'accent'
}
interface PreviewBlock {
  header: string | null
  rows: PreviewRow[]
}

const previewBlocks = computed<PreviewBlock[]>(() => {
  const blocks: PreviewBlock[] = []
  for (const [groupId, ids] of selections.value) {
    const group = visibleGroups.value.find((g) => g.id === groupId)
    if (group == null || ids.length === 0) continue

    const isComp = isComplementsGroup(group)
    const isSalsa = isSalsaGroup(group)
    const names: PreviewRow[] = []
    let hasNatural = false
    let hasSalsaExtraVal = false
    let hasMixto = false

    if (isComp) {
      // Complementos: cada entrada en línea (sin cantidad).
      for (const id of ids) {
        const v = group.values.find((val) => val.id === id)
        if (v != null) names.push({ text: v.name, tone: 'accent' })
      }
    } else if (isSalsa) {
      // Salsas: agrupar por id único con cantidad (2x BBQ).
      for (const id of new Set(ids)) {
        const v = group.values.find((val) => val.id === id)
        if (v == null) continue
        const count = ids.filter((x) => x === id).length
        names.push({ text: count > 1 ? `${count}x ${v.name}` : v.name, tone: 'accent' })
        if (v.name.toUpperCase() === 'NATURAL') hasNatural = true
        if (v.name.toUpperCase() === 'SALSA EXTRA') hasSalsaExtraVal = true
      }
    } else {
      for (const id of ids) {
        const v = group.values.find((val) => val.id === id)
        if (v == null) continue
        names.push({ text: v.name, tone: 'normal' })
        if (v.name.toUpperCase() === 'NATURAL') hasNatural = true
        if (v.name.toUpperCase() === 'SALSA EXTRA') hasSalsaExtraVal = true
        if (v.name.toUpperCase() === 'MIXTO') hasMixto = true
      }
    }

    // Insertar salsas aparte debajo de NATURAL (L3472-3491).
    if (hasNatural && salsaAparte.value.size > 0) {
      const naturalIdx = names.findIndex((n) => n.text.toUpperCase() === 'NATURAL')
      const inserts: PreviewRow[] = []
      for (const [salsa, qty] of salsaAparte.value) {
        inserts.push({ text: `  - ${qty}x SALSA APARTE DE ${salsa}`, tone: 'accent' })
      }
      if (naturalIdx !== -1) names.splice(naturalIdx + 1, 0, ...inserts)
      else names.push(...inserts)
    }

    // Insertar Salsa Extra debajo (L3493-3505).
    if (hasSalsaExtraVal && salsaExtra.value != null && salsaExtra.value !== '') {
      const idx = names.findIndex((n) => n.text.toUpperCase().includes('SALSA EXTRA'))
      const row: PreviewRow = { text: `  - ${salsaExtra.value}`, tone: 'accent' }
      if (idx !== -1) names.splice(idx + 1, 0, row)
      else names.push(row)
    }

    // Insertar mitades debajo de MIXTO (L3507-3520).
    if (hasMixto && mixtoSelections.value.size > 0) {
      const mixtoIdx = names.findIndex((n) => n.text.toUpperCase() === 'MIXTO')
      const inserts: PreviewRow[] = []
      for (const [mitad, salsa] of mixtoSelections.value) {
        inserts.push({ text: `  - Mitad ${mitad}: ${salsa}`, tone: 'accent' })
      }
      if (mixtoIdx !== -1) names.splice(mixtoIdx + 1, 0, ...inserts)
      else names.push(...inserts)
    }

    if (names.length === 0) continue
    // Grupos salsa NO muestran header (L3530-3538).
    blocks.push({ header: isSalsa ? null : `${group.name}:`, rows: names })
  }
  return blocks
})

// ---------------------------------------------------------------------------
// Resumen final (réplica _addItemToOrder L2608-2750 — formato de nota Flutter)
// ---------------------------------------------------------------------------

const optionsSummary = computed<string>(() => {
  const optionLines: string[] = []

  // MIXTO primero: 'MIXTO' + '  - Mitad X: Y'.
  if (mixtoSelections.value.size > 0) {
    optionLines.push('MIXTO')
    for (const [mitad, salsa] of mixtoSelections.value) {
      optionLines.push(`  - Mitad ${mitad}: ${salsa}`)
    }
  }

  for (const group of visibleGroups.value) {
    const ids = selections.value.get(group.id)
    if (ids == null || ids.length === 0) continue

    // Mixto activo: saltar grupos SALSAS/SABOR y el grupo que contiene MIXTO.
    if (mixtoSelections.value.size > 0) {
      const upper = group.name.toUpperCase()
      if (upper.includes('SALSA') || upper.includes('SABOR')) continue
      const hasMixtoVal = ids.some((id) => {
        const v = group.values.find((val) => val.id === id)
        return v != null && v.name.toUpperCase() === 'MIXTO'
      })
      if (hasMixtoVal) continue
    }

    const isComp = isComplementsGroup(group)
    const isSalsa = isSalsaGroup(group)

    let isNaturalGroup = false
    let isSalsaExtraGroup = false
    const names: string[] = []
    const nameCounts = new Map<string, number>()

    for (const id of ids) {
      const v = group.values.find((val) => val.id === id)
      if (v == null) continue
      const upper = v.name.toUpperCase()
      if (upper === 'NATURAL') isNaturalGroup = true
      if (upper === 'SALSA EXTRA') isSalsaExtraGroup = true
      if (isSalsa) nameCounts.set(v.name, (nameCounts.get(v.name) ?? 0) + 1)
      else names.push(v.name)
    }

    if (isComp && names.length > 0) {
      optionLines.push(names.join(' + '))
    } else if (isSalsa && nameCounts.size > 0) {
      for (const [name, count] of nameCounts) {
        optionLines.push(count > 1 ? `${count}x ${name}` : name)
      }
      if (isNaturalGroup && salsaAparte.value.size > 0) {
        for (const [salsa, qty] of salsaAparte.value) {
          optionLines.push(`${qty}x SALSA APARTE DE ${salsa}`)
        }
      }
      if (isSalsaExtraGroup && salsaExtra.value != null && salsaExtra.value !== '') {
        optionLines.push(`  - ${salsaExtra.value}`)
      }
    } else if (names.length > 0) {
      optionLines.push(names.join(', '))
      if (isNaturalGroup && salsaAparte.value.size > 0) {
        for (const [salsa, qty] of salsaAparte.value) {
          optionLines.push(`${qty}x SALSA APARTE DE ${salsa}`)
        }
      }
      if (isSalsaExtraGroup && salsaExtra.value != null && salsaExtra.value !== '') {
        optionLines.push(`  - ${salsaExtra.value}`)
      }
    }
  }

  return optionLines.join('\n')
})

// ---------------------------------------------------------------------------
// Confirmación (réplica _showConfirmationDialog L2371-2606)
// ---------------------------------------------------------------------------

interface ConfirmLine {
  text: string
  tone: 'normal' | 'accent' | 'special'
}

const confirmLines = computed<ConfirmLine[]>(() => {
  const lines: ConfirmLine[] = []
  for (const group of visibleGroups.value) {
    const ids = selections.value.get(group.id)
    if (ids == null || ids.length === 0) continue
    const isComp = isComplementsGroup(group)
    const isSalsa = isSalsaGroup(group)

    if (isComp) {
      const display = ids
        .map((id) => group.values.find((v) => v.id === id)?.name ?? '')
        .filter((n) => n !== '')
      lines.push({ text: `- ${display.join(' + ')}`, tone: 'normal' })
      continue
    }
    if (isSalsa) {
      for (const id of new Set(ids)) {
        const v = group.values.find((val) => val.id === id)
        if (v == null) continue
        const count = ids.filter((x) => x === id).length
        lines.push({ text: `- ${count > 1 ? `${count}x ${v.name}` : v.name}`, tone: 'normal' })
        if (v.name.toUpperCase() === 'NATURAL' && salsaAparte.value.size > 0) {
          for (const [salsa, qty] of salsaAparte.value) {
            lines.push({ text: `  • ${qty}x SALSA APARTE DE ${salsa}`, tone: 'special' })
          }
        }
      }
      continue
    }
    for (const id of ids) {
      const v = group.values.find((val) => val.id === id)
      if (v == null) continue
      lines.push({ text: `- ${v.name}`, tone: 'normal' })
      if (v.name.toUpperCase() === 'NATURAL' && salsaAparte.value.size > 0) {
        for (const [salsa, qty] of salsaAparte.value) {
          lines.push({ text: `• ${qty}x SALSA APARTE DE ${salsa}`, tone: 'special' })
        }
      }
      if (
        v.name.toUpperCase() === 'SALSA EXTRA' &&
        salsaExtra.value != null &&
        salsaExtra.value !== ''
      ) {
        lines.push({ text: `• ${salsaExtra.value}`, tone: 'special' })
      }
    }
  }
  return lines
})

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`
}

// ---------------------------------------------------------------------------
// Confirmar → carrito (réplica _addItemToOrder L2608-2796)
// ---------------------------------------------------------------------------

function confirmAdd(): void {
  activeDialog.value = 'none'
  const selectedOptions: OrderItemSelectedOption[] = []
  for (const group of props.template.optionGroups) {
    const ids = selections.value.get(group.id)
    if (ids != null && ids.length > 0) selectedOptions.push({ groupId: group.id, valueIds: [...ids] })
  }

  cart.addDynamicItem({
    productId: props.template.id,
    productName: props.template.name,
    totalPrice: unitPrice.value,
    selectedOptions,
    optionsSummary: optionsSummary.value.trim(),
    // Réplica Flutter: el wizard NO captura nota de usuario (additionalNote='').
    note: '',
    ...(props.editKey != null ? { replaceKey: props.editKey } : {}),
  })
  toast.success(`${props.template.name} agregado a la orden`)
  emit('close')
}

// ---------------------------------------------------------------------------
// Sub-diálogos especiales (réplica L3866-4857)
// ---------------------------------------------------------------------------

/** Grupos de salsas del template COMPLETO (para sub-diálogos). */
const allSalsaValues = computed<CatalogOptionValue[]>(() => {
  const out: CatalogOptionValue[] = []
  for (const group of props.template.optionGroups) {
    if (isSalsasLikeName(group.name)) out.push(...group.values)
  }
  return out
})

function onSalsaForMitad(salsa: CatalogOptionValue): void {
  if (activeMitad.value == null) return
  if (salsa.name.toUpperCase() === 'NATURAL') {
    activeDialog.value = 'natural-mitad'
    return
  }
  mixtoSelections.value.set(activeMitad.value, salsa.name)
  activeDialog.value = 'mixto'
}

function onNaturalMitadChoice(choice: 'solo' | 'aparte'): void {
  if (activeMitad.value == null) return
  if (choice === 'solo') {
    mixtoSelections.value.set(activeMitad.value, 'Natural')
    activeDialog.value = 'mixto'
    activeMitad.value = null
  } else {
    activeDialog.value = 'aparte-mitad'
  }
}

function onAparteMitadChoice(salsa: CatalogOptionValue): void {
  if (activeMitad.value == null) return
  mixtoSelections.value.set(activeMitad.value, `Natural aparte de ${salsa.name}`)
  activeDialog.value = 'mixto'
  activeMitad.value = null
}

function setAparteQty(salsa: CatalogOptionValue, delta: number): void {
  const current = salsaAparte.value.get(salsa.name) ?? 0
  const next = current + delta
  if (next <= 0) salsaAparte.value.delete(salsa.name)
  else salsaAparte.value.set(salsa.name, next)
  // Disparar reactividad del Map.
  salsaAparte.value = new Map(salsaAparte.value)
}

function onExtraSalsaChoice(salsa: CatalogOptionValue): void {
  if (salsa.name.toUpperCase() === 'NATURAL') {
    activeDialog.value = 'extra-natural'
    return
  }
  salsaExtra.value = salsa.name
  activeDialog.value = 'none'
}

function onExtraNaturalChoice(choice: 'solo' | 'aparte'): void {
  if (choice === 'solo') {
    salsaExtra.value = 'NATURAL'
    activeDialog.value = 'none'
  } else {
    activeDialog.value = 'extra-aparte'
  }
}

function onExtraAparteChoice(salsa: CatalogOptionValue): void {
  salsaExtra.value = `Salsa aparte de: ${salsa.name}`
  activeDialog.value = 'none'
}

function openMixtoMitad(optionName: string): void {
  activeMitad.value = optionName
  activeDialog.value = 'salsa-mitad'
}

function closeSubDialog(): void {
  activeDialog.value = 'none'
  activeMitad.value = null
}

// ---------------------------------------------------------------------------
// Esc para cerrar (réplica del Dialog Flutter: X y click fuera cierran).
// ---------------------------------------------------------------------------

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    if (activeDialog.value !== 'none') closeSubDialog()
    else emit('close')
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

/** Expuesto para tests/QA manuales. */
defineExpose({ stepValid, unitPrice, optionsSummary })
</script>

<template>
  <div class="wiz-overlay" @click.self="emit('close')">
    <div class="wiz" role="dialog" aria-modal="true" :aria-label="template.name" data-testid="wiz-root">
      <!-- EMPTY (réplica L2843-2889) -->
      <div v-if="visibleGroups.length === 0" class="wiz-empty">
        <p class="wiz-empty__title">Sin opciones disponibles</p>
        <p class="wiz-empty__text">No hay opciones disponibles para {{ template.name }}</p>
        <button type="button" class="wiz-empty__close" data-testid="wiz-empty-close" @click="emit('close')">
          Cerrar
        </button>
      </div>

      <template v-else>
        <!-- PHONE/NARROW (<900px, réplica L2899-3067): barra compacta superior
             con producto + Subtotal + expandir ticket; sin panel lateral -->
        <header v-if="isNarrow" class="wiz-topbar" data-testid="wiz-topbar">
          <button
            type="button"
            class="wiz-topbar__expand"
            :aria-expanded="ticketExpanded"
            aria-label="Ver resumen de la orden"
            data-testid="wiz-ticket-expand"
            @click="ticketExpanded = !ticketExpanded"
          >
            <ReceiptText :size="18" aria-hidden="true" />
          </button>
          <div class="wiz-topbar__mid">
            <span class="wiz-topbar__product">{{ template.name }}</span>
            <span class="wiz-topbar__subtotal">Subtotal: {{ formatMoney(unitPrice) }}</span>
          </div>
          <button
            type="button"
            class="wiz-topbar__close"
            aria-label="Cerrar"
            data-testid="wiz-close"
            @click="emit('close')"
          >
            <X :size="24" />
          </button>
        </header>

        <!-- Resumen desplegable (solo phone, al expandir): réplica del bloque
             'Resumen' del narrow .dart L2986-3014 -->
        <div v-if="isNarrow && ticketExpanded" class="wiz-summary" data-testid="wiz-summary">
          <div class="wiz-summary__scroll">
            <p v-if="previewBlocks.length === 0" class="wiz-summary__empty">Sin selecciones todavía</p>
            <div v-for="(block, bi) in previewBlocks" :key="bi" class="wiz-summary__block">
              <p v-if="block.header != null" class="wiz-summary__group">{{ block.header }}</p>
              <div
                v-for="(row, ri) in block.rows"
                :key="ri"
                class="wiz-summary__row"
                :class="{ 'wiz-summary__row--accent': row.tone === 'accent' }"
              >
                <Check :size="14" class="wiz-summary__check" aria-hidden="true" />
                <span class="wiz-summary__text">{{ row.text }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- PANEL IZQUIERDO: ticket (réplica L3081-3173) — oculto en narrow -->
        <aside v-if="!isNarrow" class="wiz-ticket" data-testid="wiz-ticket">
          <header class="wiz-ticket__header">
            <h2 class="wiz-ticket__title">Orden Actual</h2>
            <p class="wiz-ticket__product">{{ template.name }}</p>
          </header>
          <div class="wiz-ticket__divider" aria-hidden="true"></div>
          <div class="wiz-ticket__scroll">
            <div v-for="(block, bi) in previewBlocks" :key="bi" class="wiz-ticket__block">
              <p v-if="block.header != null" class="wiz-ticket__group">{{ block.header }}</p>
              <div
                v-for="(row, ri) in block.rows"
                :key="ri"
                class="wiz-ticket__row"
                :class="{ 'wiz-ticket__row--accent': row.tone === 'accent' }"
              >
                <Check :size="16" class="wiz-ticket__check" aria-hidden="true" />
                <span class="wiz-ticket__text">{{ row.text }}</span>
              </div>
            </div>
          </div>
          <footer class="wiz-ticket__footer">
            <span class="wiz-ticket__subtotal">Subtotal:</span>
            <span class="wiz-ticket__total" data-testid="wiz-subtotal">{{ formatMoney(unitPrice) }}</span>
          </footer>
        </aside>

        <!-- PANEL DERECHO: wizard (réplica L3177-3356) -->
        <section class="wiz-main">
          <header v-if="!isNarrow" class="wiz-main__header">
            <button
              type="button"
              class="wiz-main__close"
              aria-label="Cerrar"
              title="Cerrar"
              data-testid="wiz-close"
              @click="emit('close')"
            >
              <X :size="32" />
            </button>
          </header>

          <div class="wiz-main__scroll">
            <h2 class="wiz-main__group-name">{{ currentGroup?.name }}</h2>
            <div class="wiz-banner" data-testid="wiz-banner">
              <Lightbulb :size="22" class="wiz-banner__icon" aria-hidden="true" />
              <p class="wiz-banner__text">{{ groupBanner }}</p>
            </div>

            <div class="wiz-grid" data-testid="wiz-grid">
              <button
                v-for="value in visibleValues(currentGroup!)"
                :key="value.id"
                type="button"
                class="wiz-card"
                :class="{ 'wiz-card--selected': isSelectedCard(currentGroup!, value) }"
                :data-testid="`wiz-card-${value.id}`"
                :aria-pressed="isSelectedCard(currentGroup!, value)"
                @click="onCardClick(currentGroup!, value)"
              >
                <span v-if="priceBadge(value)" class="wiz-card__badge">{{ priceBadge(value) }}</span>

                <span v-if="showSteppers(currentGroup!, value)" class="wiz-card__steppers">
                  <span
                    class="wiz-card__step"
                    role="button"
                    aria-label="Quitar uno"
                    :data-testid="`wiz-minus-${value.id}`"
                    @click.stop="adjustQuantity(currentGroup!, value.id, -1)"
                  >
                    <CircleMinus :size="28" class="wiz-card__step-minus" />
                  </span>
                  <span class="wiz-card__qty">{{ qtyOf(currentGroup!, value) }}</span>
                  <span
                    class="wiz-card__step"
                    role="button"
                    aria-label="Agregar uno"
                    :data-testid="`wiz-plus-${value.id}`"
                    @click.stop="adjustQuantity(currentGroup!, value.id, 1)"
                  >
                    <CirclePlus :size="28" class="wiz-card__step-plus" />
                  </span>
                </span>

                <span class="wiz-card__name">{{ value.name }}</span>

                <span
                  v-if="isSelectedCard(currentGroup!, value) && !isComplementsGroup(currentGroup!)"
                  class="wiz-card__check"
                >
                  <Check :size="14" aria-hidden="true" />
                </span>
              </button>
            </div>
          </div>

          <footer class="wiz-footer">
            <span v-if="!isFirstStep" class="wiz-footer__placeholder" aria-hidden="true"></span>
            <button
              v-if="!isFirstStep"
              type="button"
              class="wiz-btn wiz-btn--back"
              data-testid="wiz-back"
              @click="previousStep"
            >
              <ArrowLeft :size="22" aria-hidden="true" />
              Atrás
            </button>
            <template v-else>
              <span class="wiz-footer__spacer" aria-hidden="true"></span>
            </template>
            <button
              type="button"
              class="wiz-btn wiz-btn--next"
              :disabled="!currentStepValid"
              data-testid="wiz-next"
              @click="nextStep"
            >
              <component :is="isLastStep ? Check : ArrowRight" :size="22" aria-hidden="true" />
              {{ isLastStep ? 'Confirmar' : 'Siguiente' }}
            </button>
          </footer>
        </section>
      </template>
    </div>

    <!-- ================= CONFIRMACIÓN (réplica L2371-2606) ================= -->
    <div v-if="activeDialog === 'confirm'" class="sub-overlay" @click.self="activeDialog = 'none'">
      <div class="sub-dialog" role="dialog" aria-modal="true" aria-label="Confirmar Orden" data-testid="wiz-confirm">
        <h3 class="sub-dialog__title">Confirmar Orden</h3>
        <p class="sub-dialog__q">¿Estás seguro de agregar este producto?</p>
        <p class="sub-dialog__resumen">Resumen:</p>
        <p class="sub-dialog__product">1 {{ template.name }}</p>
        <p v-for="(line, i) in confirmLines" :key="i" class="sub-dialog__line" :class="{ 'sub-dialog__line--special': line.tone === 'special' }">
          {{ line.text }}
        </p>
        <template v-if="mixtoSelections.size > 0">
          <p class="sub-dialog__mixto-title">MIXTO:</p>
          <p v-for="[mitad, salsa] in mixtoSelections" :key="mitad" class="sub-dialog__line">
            • {{ mitad }}: {{ salsa }}
          </p>
        </template>
        <p class="sub-dialog__price">Precio: {{ formatMoney(unitPrice) }}</p>
        <div class="sub-dialog__actions">
          <button type="button" class="sub-btn sub-btn--ghost" @click="activeDialog = 'none'">Cancelar</button>
          <button type="button" class="sub-btn sub-btn--primary" data-testid="wiz-confirm-add" @click="confirmAdd">
            Confirmar
          </button>
        </div>
      </div>
    </div>

    <!-- ================= MIXTO: mitades (réplica L3866-3990) ================= -->
    <div v-if="activeDialog === 'mixto'" class="sub-overlay" @click.self="activeDialog = 'none'">
      <div class="sub-dialog" role="dialog" aria-modal="true" aria-label="Mitades de Proteína (Mixto)">
        <h3 class="sub-dialog__title">Mitades de Proteína (Mixto)</h3>
        <p class="sub-dialog__q">¿Cuál es la composición?</p>
        <div v-if="mixtoSelections.size > 0" class="sub-mixto__current">
          <p class="sub-mixto__current-title">✓ Seleccionado:</p>
          <p v-for="[mitad, salsa] in mixtoSelections" :key="mitad" class="sub-mixto__current-line">
            • Mitad {{ mitad }}: {{ salsa }}
          </p>
        </div>
        <button type="button" class="sub-mixto__option" @click="openMixtoMitad('BONELESS')">
          <span>Mitad Boneless</span>
          <span class="sub-mixto__add">+</span>
        </button>
        <button type="button" class="sub-mixto__option" @click="openMixtoMitad('ALITAS')">
          <span>Mitad Alitas</span>
          <span class="sub-mixto__add">+</span>
        </button>
        <div class="sub-dialog__actions">
          <button type="button" class="sub-btn sub-btn--ghost" @click="closeSubDialog">Cancelar</button>
          <button
            v-if="mixtoSelections.size === 2"
            type="button"
            class="sub-btn sub-btn--green"
            data-testid="wiz-mixto-confirm"
            @click="activeDialog = 'none'"
          >
            Confirmar Mixto
          </button>
        </div>
      </div>
    </div>

    <!-- ================= MIXTO: salsa para mitad (réplica L3992-4128) ================= -->
    <div v-if="activeDialog === 'salsa-mitad'" class="sub-overlay" @click.self="activeDialog = 'mixto'">
      <div class="sub-dialog" role="dialog" aria-modal="true" :aria-label="`Salsa para ${activeMitad}`">
        <h3 class="sub-dialog__title">Salsa para {{ activeMitad }}</h3>
        <p class="sub-dialog__q">¿Qué salsa para la mitad de {{ activeMitad }}?</p>
        <div class="sub-dialog__scroll">
          <p v-if="allSalsaValues.length === 0" class="sub-dialog__warn">⚠️ No se encontraron salsas disponibles</p>
          <button
            v-for="salsa in allSalsaValues"
            :key="salsa.id"
            type="button"
            class="sub-chip"
            :class="{ 'sub-chip--natural': salsa.name.toUpperCase() === 'NATURAL' }"
            @click="onSalsaForMitad(salsa)"
          >
            {{ salsa.name }}
          </button>
        </div>
        <div class="sub-dialog__actions">
          <button type="button" class="sub-btn sub-btn--ghost" @click="activeDialog = 'mixto'">Cancelar</button>
        </div>
      </div>
    </div>

    <!-- ================= MIXTO: Natural para mitad (réplica L4130-4188) ================= -->
    <div v-if="activeDialog === 'natural-mitad'" class="sub-overlay" @click.self="activeDialog = 'mixto'">
      <div class="sub-dialog" role="dialog" aria-modal="true" :aria-label="`Natural para ${activeMitad}`">
        <h3 class="sub-dialog__title">Natural para {{ activeMitad }}</h3>
        <p class="sub-dialog__q">¿Solo Natural o Salsa Aparte?</p>
        <button type="button" class="sub-btn sub-btn--green sub-btn--block" @click="onNaturalMitadChoice('solo')">
          Solo Natural
        </button>
        <button type="button" class="sub-btn sub-btn--blue sub-btn--block" @click="onNaturalMitadChoice('aparte')">
          Salsa Aparte de...
        </button>
        <div class="sub-dialog__actions">
          <button type="button" class="sub-btn sub-btn--ghost" @click="activeDialog = 'mixto'">Cancelar</button>
        </div>
      </div>
    </div>

    <!-- ================= MIXTO: salsa aparte para mitad (réplica L4190-4290) ================= -->
    <div v-if="activeDialog === 'aparte-mitad'" class="sub-overlay" @click.self="activeDialog = 'mixto'">
      <div class="sub-dialog" role="dialog" aria-modal="true" :aria-label="`Salsa Aparte para ${activeMitad}`">
        <h3 class="sub-dialog__title">Salsa Aparte para {{ activeMitad }}</h3>
        <p class="sub-dialog__q">Elige la salsa aparte para {{ activeMitad }}</p>
        <div class="sub-dialog__scroll">
          <button
            v-for="salsa in allSalsaValues.filter((s) => s.name.toUpperCase() !== 'NATURAL')"
            :key="salsa.id"
            type="button"
            class="sub-chip sub-chip--orange"
            @click="onAparteMitadChoice(salsa)"
          >
            {{ salsa.name }}
          </button>
        </div>
        <div class="sub-dialog__actions">
          <button type="button" class="sub-btn sub-btn--ghost" @click="activeDialog = 'mixto'">Cancelar</button>
        </div>
      </div>
    </div>

    <!-- ================= NATURAL (grupo salsa): réplica L4292-4348 ================= -->
    <div v-if="activeDialog === 'natural'" class="sub-overlay" @click.self="activeDialog = 'none'">
      <div class="sub-dialog" role="dialog" aria-modal="true" aria-label="Salsa Natural">
        <h3 class="sub-dialog__title">Salsa Natural</h3>
        <p class="sub-dialog__q">¿Cómo deseas la salsa?</p>
        <button type="button" class="sub-btn sub-btn--green sub-btn--block" @click="activeDialog = 'none'">
          Solo Natural
        </button>
        <button type="button" class="sub-btn sub-btn--blue sub-btn--block" @click="activeDialog = 'aparte'">
          Salsa Aparte de...
        </button>
      </div>
    </div>

    <!-- ================= SALSA APARTE con steppers (réplica L4350-4521) ================= -->
    <div v-if="activeDialog === 'aparte'" class="sub-overlay" @click.self="activeDialog = 'none'">
      <div class="sub-dialog" role="dialog" aria-modal="true" aria-label="Selecciona Salsa Aparte">
        <h3 class="sub-dialog__title">Selecciona Salsa Aparte</h3>
        <p class="sub-dialog__q">Elige las salsas para llevar aparte</p>
        <div class="sub-dialog__scroll">
          <div
            v-for="salsa in allSalsaValues.filter((s) => s.name.toUpperCase() !== 'NATURAL')"
            :key="salsa.id"
            class="sub-aparte__row"
            :class="{ 'sub-aparte__row--active': (salsaAparte.get(salsa.name) ?? 0) > 0 }"
          >
            <span class="sub-aparte__name">{{ salsa.name }}</span>
            <span class="sub-aparte__steppers">
              <button
                type="button"
                class="sub-aparte__btn"
                :disabled="(salsaAparte.get(salsa.name) ?? 0) <= 0"
                :aria-label="`Quitar ${salsa.name}`"
                @click="setAparteQty(salsa, -1)"
              >
                <CircleMinus :size="22" />
              </button>
              <span class="sub-aparte__qty">{{ salsaAparte.get(salsa.name) ?? 0 }}</span>
              <button
                type="button"
                class="sub-aparte__btn sub-aparte__btn--plus"
                :aria-label="`Agregar ${salsa.name}`"
                @click="setAparteQty(salsa, 1)"
              >
                <CirclePlus :size="22" />
              </button>
            </span>
          </div>
        </div>
        <div class="sub-dialog__actions">
          <button type="button" class="sub-btn sub-btn--ghost" @click="activeDialog = 'none'">Cancelar</button>
          <button type="button" class="sub-btn sub-btn--orange" @click="activeDialog = 'none'">Confirmar</button>
        </div>
      </div>
    </div>

    <!-- ================= SALSA EXTRA (réplica L4525-4674) ================= -->
    <div v-if="activeDialog === 'extra'" class="sub-overlay" @click.self="activeDialog = 'none'">
      <div class="sub-dialog" role="dialog" aria-modal="true" aria-label="Selecciona Salsa Extra">
        <h3 class="sub-dialog__title">Selecciona Salsa Extra</h3>
        <p class="sub-dialog__q">Elige la salsa extra que deseas</p>
        <div class="sub-dialog__scroll">
          <p v-if="allSalsaValues.length === 0" class="sub-dialog__warn">
            ⚠️ No hay grupo de salsas — El producto necesita un grupo de SALSAS o SABOR en la BD
          </p>
          <button
            v-for="salsa in allSalsaValues"
            :key="salsa.id"
            type="button"
            class="sub-chip sub-chip--orange"
            @click="onExtraSalsaChoice(salsa)"
          >
            {{ salsa.name }}
          </button>
        </div>
        <div class="sub-dialog__actions">
          <button type="button" class="sub-btn sub-btn--ghost" @click="activeDialog = 'none'">Cancelar</button>
        </div>
      </div>
    </div>

    <!-- ================= SALSA EXTRA Natural (réplica L4676-4746) ================= -->
    <div v-if="activeDialog === 'extra-natural'" class="sub-overlay" @click.self="activeDialog = 'none'">
      <div class="sub-dialog" role="dialog" aria-modal="true" aria-label="Salsa Extra Natural">
        <h3 class="sub-dialog__title">Salsa Extra Natural</h3>
        <p class="sub-dialog__q">¿Cómo deseas la salsa natural?</p>
        <button type="button" class="sub-btn sub-btn--green sub-btn--block" @click="onExtraNaturalChoice('solo')">
          Solo Natural
        </button>
        <button type="button" class="sub-btn sub-btn--blue sub-btn--block" @click="onExtraNaturalChoice('aparte')">
          Salsa Aparte de...
        </button>
      </div>
    </div>

    <!-- ================= SALSA EXTRA aparte (réplica L4748-4857) ================= -->
    <div v-if="activeDialog === 'extra-aparte'" class="sub-overlay" @click.self="activeDialog = 'none'">
      <div class="sub-dialog" role="dialog" aria-modal="true" aria-label="Salsa Extra Aparte">
        <h3 class="sub-dialog__title">Salsa Extra Aparte</h3>
        <p class="sub-dialog__q">Elige la salsa extra para llevar aparte</p>
        <div class="sub-dialog__scroll">
          <button
            v-for="salsa in allSalsaValues.filter((s) => s.name.toUpperCase() !== 'NATURAL')"
            :key="salsa.id"
            type="button"
            class="sub-chip sub-chip--orange"
            @click="onExtraAparteChoice(salsa)"
          >
            {{ salsa.name }}
          </button>
        </div>
        <div class="sub-dialog__actions">
          <button type="button" class="sub-btn sub-btn--ghost" @click="activeDialog = 'none'">Cancelar</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ================= OVERLAY + DIALOG (réplica Dialog L3069-3072) ============ */
.wiz-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 40px;
  background: rgba(0, 0, 0, 0.6);
}

.wiz {
  display: flex;
  overflow: hidden;
  width: 100%;
  max-width: 1500px;
  height: 100%;
  background: #212121;
  border-radius: 28px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
}

/* ================= EMPTY (réplica L2843-2889) ============================== */
.wiz-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  text-align: center;
}

.wiz-empty__title {
  margin: 0;
  color: #fff;
  font-size: 18px;
  font-weight: 700;
}

.wiz-empty__text {
  margin: 0;
  color: #e0e0e0;
  font-size: 14px;
}

.wiz-empty__close {
  margin-top: 12px;
  padding: 14px 32px;
  background: var(--primary);
  border: none;
  border-radius: 12px;
  color: #fff;
  font-family: var(--font);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

/* ================= PANEL IZQUIERDO: TICKET (L3081-3173) ==================== */
.wiz-ticket {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 200px;
  background: #101010;
  border-right: 2px solid #424242;
  border-bottom-left-radius: 28px;
}

.wiz-ticket__header {
  padding: 20px;
}

.wiz-ticket__title {
  margin: 0;
  color: #fff;
  font-size: 18px;
  font-weight: 700;
}

.wiz-ticket__product {
  margin: 8px 0 0;
  color: var(--primary);
  font-size: 16px;
  font-weight: 700;
  overflow-wrap: break-word;
}

.wiz-ticket__divider {
  flex: none;
  height: 1px;
  background: #424242;
}

.wiz-ticket__scroll {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.wiz-ticket__block {
  margin-bottom: 12px;
}

.wiz-ticket__group {
  margin: 0 0 6px;
  color: var(--primary);
  font-size: 13px;
  font-weight: 700;
}

.wiz-ticket__row {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  padding: 0 0 4px 12px;
}

.wiz-ticket__check {
  flex: none;
  margin-top: 1px;
  color: #9e9e9e;
}

.wiz-ticket__text {
  color: #e0e0e0;
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

.wiz-ticket__row--accent .wiz-ticket__text {
  color: #ffcc80;
  font-weight: 600;
}

.wiz-ticket__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid #424242;
}

.wiz-ticket__subtotal {
  color: #bdbdbd;
  font-size: 14px;
}

.wiz-ticket__total {
  color: var(--primary);
  font-size: 16px;
  font-weight: 700;
}

/* ================= PANEL DERECHO: WIZARD (L3177-3281) ====================== */
.wiz-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.wiz-main__header {
  display: flex;
  flex: none;
  justify-content: flex-end;
  padding: 16px 36px;
}

.wiz-main__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: none;
  color: #fff;
  cursor: pointer;
}

.wiz-main__close:hover {
  color: #e0e0e0;
}

.wiz-main__scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 36px 36px;
}

.wiz-main__group-name {
  margin: 0;
  color: #fff;
  font-size: 26px;
  font-weight: 900;
  letter-spacing: 0.3px;
}

/* Banner azul (réplica L3229-3272) */
.wiz-banner {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-top: 16px;
  padding: 14px 16px;
  background: rgba(33, 150, 243, 0.12);
  border: 2px solid rgba(33, 150, 243, 0.35);
  border-radius: 14px;
  box-shadow: 0 0 0 1px rgba(33, 150, 243, 0.08), 0 0 10px rgba(33, 150, 243, 0.08);
}

.wiz-banner__icon {
  flex: none;
  color: #90caf9;
}

.wiz-banner__text {
  margin: 0;
  color: #bbdefb;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}

/* Grid de cards (réplica L3649-3655: 7/6/5 cols por ancho, aspect 1.05;
   narrow Android réplica L3649-3658: tight <420 → 2 cols aspect 0.72,
   phone <600 → 3 cols aspect 0.80, spacing 8/10, nombre 12px 3 líneas) */
.wiz-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
  margin-top: 28px;
}

@media (min-width: 1100px) {
  .wiz-grid {
    grid-template-columns: repeat(6, 1fr);
  }
}

@media (min-width: 1400px) {
  .wiz-grid {
    grid-template-columns: repeat(7, 1fr);
  }
}

/* ================= NARROW (<900px) — réplica L2899-3067 ====================
   Dialog inset 12h/24v radius 20, altura 85%, header compacto con nombre
   + X, contenido scroll, footer Atrás/Siguiente. Ticket lateral → barra
   superior compacta + resumen desplegable (desviación documentada).
   Grid: réplica _buildOptionCards narrow L3644-3658 (Android: tight<420
   2 cols / phone 3 cols). */
@media (max-width: 899px), (max-height: 699px) {
  .wiz-overlay {
    padding: 12px 12px 24px;
    align-items: stretch;
  }

  .wiz {
    flex-direction: column;
    border-radius: 20px;
    height: 100%;
    max-width: none;
  }

  /* Ticket lateral oculto: su contenido vive en la topbar + resumen */
  .wiz-ticket {
    display: none;
  }

  /* Barra superior compacta: expandir + producto/Subtotal + X */
  .wiz-topbar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: #101010; /* grey[950] como el ticket */
    border-bottom: 1px solid #424242;
  }

  .wiz-topbar__expand {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex: none;
    padding: 0;
    background: rgba(255, 87, 34, 0.14);
    border: 1px solid rgba(255, 87, 34, 0.4);
    border-radius: 10px;
    color: var(--primary);
    cursor: pointer;
  }

  .wiz-topbar__mid {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .wiz-topbar__product {
    color: #fff;
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .wiz-topbar__subtotal {
    color: var(--primary);
    font-size: 13px;
    font-weight: 700;
  }

  .wiz-topbar__close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex: none;
    padding: 0;
    background: transparent;
    border: none;
    color: #fff;
    cursor: pointer;
  }

  /* Resumen desplegable (bloque 'Resumen' del narrow .dart L2986-3014) */
  .wiz-summary {
    flex: none;
    max-height: 40%;
    overflow-y: auto;
    padding: 12px 16px;
    background: #101010;
    border-bottom: 1px solid #424242;
  }

  .wiz-summary__scroll {
    display: flex;
    flex-direction: column;
  }

  .wiz-summary__empty {
    margin: 0;
    color: #9e9e9e;
    font-size: 12px;
  }

  .wiz-summary__block {
    margin-bottom: 10px;
  }

  .wiz-summary__group {
    margin: 0 0 4px;
    color: var(--primary);
    font-size: 12px;
    font-weight: 700;
  }

  .wiz-summary__row {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    padding: 0 0 3px 10px;
  }

  .wiz-summary__check {
    flex: none;
    margin-top: 1px;
    color: #9e9e9e;
  }

  .wiz-summary__text {
    color: #e0e0e0;
    font-size: 12px;
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }

  .wiz-summary__row--accent .wiz-summary__text {
    color: #ffcc80;
    font-weight: 600;
  }

  /* Wizard: paddings compactos del narrow (16h/12v L2936) */
  .wiz-main__scroll {
    padding: 8px 16px 16px;
  }

  .wiz-main__group-name {
    font-size: 20px; /* titleLarge narrow */
  }

  /* Grid narrow: phone 3 cols, tight (<420px) 2 cols — réplica L3649-3655 */
  .wiz-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-top: 16px;
  }

  .wiz-card {
    aspect-ratio: 0.8; /* phone 0.80 */
    gap: 4px;
    padding: 6px;
  }

  .wiz-card__name {
    font-size: 12px; /* isAndroid nameFontSize */
    -webkit-line-clamp: 3; /* nameMaxLines narrow */
    line-height: 1.2;
  }

  .wiz-card__steppers {
    gap: 2px;
  }

  .wiz-card__step :deep(svg),
  .wiz-card__steppers svg {
    width: 20px;
    height: 20px;
  }

  .wiz-card__qty {
    font-size: 14px;
  }

  .wiz-card__badge {
    font-size: 10px;
    padding: 3px 6px;
  }

  /* Footer compacto (L3019-3062): padding 12h/12v, botones Expanded flex */
  .wiz-footer {
    padding: 12px;
    gap: 12px;
  }

  .wiz-btn {
    flex: 1;
    justify-content: center;
    padding: 12px 16px;
    font-size: 15px;
  }

  .wiz-btn--next {
    padding: 12px 16px;
  }

  .wiz-footer__spacer {
    display: none;
  }

  .wiz-footer__placeholder {
    display: none;
  }
}

/* Ocultar topbar/resumen en desktop (solo existen en narrow) */
.wiz-topbar,
.wiz-summary {
  display: none;
}

@media (max-width: 899px), (max-height: 699px) {
  .wiz-topbar,
  .wiz-summary {
    display: flex;
  }

  .wiz-summary {
    display: block;
  }
}

/* tight (shortestSide<420 del .dart): 2 cols aspect 0.72, spacing 8.
   DEBE ir DESPUÉS del bloque narrow: ambas queries aplican a <420px
   (360<419 y 360<899) y CSS resuelve por orden — si va antes, el
   repeat(2) del tight nunca gana y phone queda en 3 cols. */
@media (max-width: 419px) {
  .wiz-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .wiz-card {
    aspect-ratio: 0.72;
  }
}

/* Card (réplica L3726-3856).
   IMPORTANTE: esta regla base (aspect 1.05) va DESPUÉS de los bloques
   narrow/tight a propósito — CSS resuelve por orden de aparición, así el
   aspect 0.8/0.72 de narrow/tight (<900px/<419px) gana sobre la base.
   El grid-template-columns de .wiz-grid NUNCA se toca aquí (no hay
   columnas base tras narrow: repeat(5) base solo aplica >899px). */
.wiz-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  aspect-ratio: 1.05;
  padding: 8px;
  background: #424242;
  border: 1.5px solid #616161;
  border-radius: 16px;
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.3);
  color: #fff;
  cursor: pointer;
  font-family: var(--font);
  overflow: hidden;
}

.wiz-card--selected {
  background: rgba(255, 87, 34, 0.3);
  border: 3px solid var(--primary);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.45);
}

.wiz-card__badge {
  padding: 4px 8px;
  background: #388e3c;
  border-radius: 6px;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.wiz-card__steppers {
  display: flex;
  align-items: center;
  gap: 4px;
}

.wiz-card__step {
  display: inline-flex;
  padding: 0;
  background: transparent;
  border: none;
  cursor: pointer;
}

.wiz-card__step-minus {
  color: #ff5252;
}

.wiz-card__step-plus {
  color: #69f0ae;
}

.wiz-card__qty {
  min-width: 18px;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  text-align: center;
}

.wiz-card__name {
  display: -webkit-box;
  padding: 0 4px;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.15;
  text-align: center;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  word-break: break-word;
}

.wiz-card--selected .wiz-card__name {
  font-weight: 700;
}

.wiz-card__check {
  position: absolute;
  top: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: var(--primary);
  border-radius: 999px;
  color: #fff;
}

/* Footer wizard (réplica L3283-3356) */
.wiz-footer {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 28px 32px;
  background: #303030;
  border-top: 1.5px solid #616161;
}

.wiz-footer__spacer {
  width: 140px;
}

.wiz-btn {
  display: inline-flex;
  gap: 10px;
  align-items: center;
  padding: 18px 28px;
  border: none;
  border-radius: 14px;
  color: #fff;
  cursor: pointer;
  font-family: var(--font);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.3px;
}

.wiz-btn--back {
  background: #616161;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.wiz-btn--back:hover {
  background: #6e6e6e;
}

.wiz-btn--next {
  padding: 18px 32px;
  background: var(--primary);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35);
}

.wiz-btn--next:hover:not(:disabled) {
  background: var(--primary-hover);
}

.wiz-btn--next:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Sub-diálogos en narrow: quepan con teclado (max-height ya cubre) */
@media (max-width: 899px), (max-height: 699px) {
  .sub-overlay {
    padding: 16px;
    align-items: flex-end;
  }

  .sub-dialog {
    max-width: none;
    max-height: 82vh;
  }
}

/* ================= SUB-DIÁLOGOS (réplica AlertDialogs L3866-4857) ========== */
.sub-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.55);
}

.sub-dialog {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  max-width: 420px;
  max-height: calc(100vh - 120px);
  padding: 24px;
  background: #212121;
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
}

.sub-dialog__title {
  margin: 0;
  color: #fff;
  font-size: 18px;
  font-weight: 700;
}

.sub-dialog__q {
  margin: 0;
  color: #9e9e9e;
  font-size: 14px;
}

.sub-dialog__resumen {
  margin: 8px 0 0;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
}

.sub-dialog__product {
  margin: 0;
  color: #e0e0e0;
  font-size: 13px;
}

.sub-dialog__line {
  margin: 0 0 2px 16px;
  color: #e0e0e0;
  font-size: 12px;
}

.sub-dialog__line--special {
  color: #ffcc80;
  font-weight: 600;
}

.sub-dialog__mixto-title {
  margin: 8px 0 0;
  color: #ffc107;
  font-size: 12px;
  font-weight: 700;
}

.sub-dialog__price {
  margin: 8px 0 0;
  color: var(--primary);
  font-size: 14px;
  font-weight: 700;
}

.sub-dialog__warn {
  margin: 0;
  color: #ef5350;
  font-size: 13px;
  text-align: center;
}

.sub-dialog__scroll {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
}

.sub-dialog__actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 4px;
}

.sub-btn {
  padding: 10px 18px;
  border: none;
  border-radius: 8px;
  color: #fff;
  cursor: pointer;
  font-family: var(--font);
  font-size: 13px;
  font-weight: 600;
}

.sub-btn--primary {
  background: var(--primary);
}

.sub-btn--green {
  background: #388e3c;
}

.sub-btn--blue {
  background: #1565c0;
}

.sub-btn--orange {
  background: #ef6c00;
}

.sub-btn--ghost {
  background: transparent;
  border: 1px solid #616161;
  color: #bdbdbd;
}

.sub-btn--block {
  width: 100%;
  padding: 12px 0;
}

/* MIXTO mitades */
.sub-mixto__current {
  padding: 12px;
  background: rgba(27, 94, 32, 0.3);
  border: 1px solid #388e3c;
  border-radius: 8px;
}

.sub-mixto__current-title {
  margin: 0 0 6px;
  color: #4caf50;
  font-size: 12px;
  font-weight: 700;
}

.sub-mixto__current-line {
  margin: 0 0 2px 8px;
  color: #fff;
  font-size: 12px;
}

.sub-mixto__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background: transparent;
  border: 1px solid var(--primary);
  border-radius: 8px;
  color: #fff;
  cursor: pointer;
  font-family: var(--font);
  font-size: 14px;
}

.sub-mixto__option:hover {
  background: rgba(255, 87, 34, 0.12);
}

.sub-mixto__add {
  color: var(--primary);
  font-size: 20px;
  font-weight: 700;
}

/* Chips de salsas (sub-diálogos) */
.sub-chip {
  width: 100%;
  padding: 10px 12px;
  background: rgba(21, 101, 192, 0.8);
  border: 0.5px solid #64b5f6;
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  font-family: var(--font);
  font-size: 13px;
  font-weight: 500;
  text-align: center;
}

.sub-chip:hover {
  filter: brightness(1.12);
}

.sub-chip--natural {
  background: rgba(56, 142, 60, 0.8);
  border-color: #66bb6a;
}

.sub-chip--orange {
  background: rgba(239, 108, 0, 0.8);
  border-color: #ffb74d;
}

/* Steppers de salsa aparte */
.sub-aparte__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  background: #424242;
  border: 1.5px solid #757575;
  border-radius: 8px;
}

.sub-aparte__row--active {
  background: rgba(239, 108, 0, 0.3);
  border-color: #ffb74d;
}

.sub-aparte__name {
  color: #bdbdbd;
  font-size: 14px;
}

.sub-aparte__row--active .sub-aparte__name {
  color: #fff;
  font-weight: 600;
}

.sub-aparte__steppers {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sub-aparte__btn {
  display: inline-flex;
  padding: 0;
  background: transparent;
  border: none;
  color: #ef5350;
  cursor: pointer;
}

.sub-aparte__btn:disabled {
  color: #616161;
  cursor: not-allowed;
}

.sub-aparte__btn--plus {
  color: #66bb6a;
}

.sub-aparte__qty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  padding: 4px 12px;
  background: #616161;
  border-radius: 12px;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
}

.sub-aparte__row--active .sub-aparte__qty {
  background: #ef6c00;
}
</style>
