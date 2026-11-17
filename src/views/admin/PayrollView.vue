<script setup lang="ts">
/**
 * PayrollView · "Crear Nómina" (Fase admin M4) — réplica de
 * lib/screens/admin/create_nom.dart (CrazyWings, 1289 líneas) con la
 * estructura de ManageUsersView.vue: AppBar standalone + cards de sección
 * + guard de rol + toasts.
 *
 * Flujo replicado del Flutter:
 * - AppBar (L675-678): back → admin-dashboard, título 'Crear Nómina'.
 * - Sección empleado (L684-756): picker de empleados (Dropdown → AppSelect
 *   con nombre completo + puesto; aquí + número, brief) que AUTOCOMPLETA
 *   RFC/CURP/NSS/Puesto/Salarios EDITABLES después (_selectEmployee
 *   L173-189). Gestión ligera de empleados (backend f9ad45f — NO estaba en
 *   el legacy): botón 'Dar de alta otro' abre modal POST employees; por
 *   empleado seleccionado: desactivar (DELETE soft con confirm) y recargar
 *   lista. Si GET employees trae [] → banner + CTA 'Dar de alta empleado'
 *   (la captura manual con empleadoId=0 fue REMOVIDA: el backend la
 *   rechaza con 400 'El empleado es requerido.' — el flujo SIEMPRE viaja
 *   con empleadoId real).
 * - Periodo (L937-1019): periodoInicio/periodoFin (date inputs, envía
 *   yyyy-MM-dd) + Días trabajados (1-31, input numérico — el legacy lo
 *   derivaba del rango; el brief pide input directo).
 * - Percepciones/Deducciones (L1022-1137): listas dinámicas {concepto,
 *   cantidad} con 'Agregar percepción'/'Agregar deducción' + quitar
 *   (papelera roja L1326-1339). Totales EN VIVO client-side para display
 *   (SERVER recalcula de verdad al guardar).
 * - Neto a pagar (L1140-1166): display grande actualizado en vivo,
 *   badge rojo si < 0 (permitido).
 * - Guardar (L234-393): valida nombre + RFC + CURP + días 1-31 → POST →
 *   toast 'Nómina guardada - Neto: $X' → limpiar form (reset réplica
 *   L1176-1206: percepciones [Bono], deducciones [IMSS, Ahorro, Préstamo]).
 * - Historial abajo: GET records (sin filtros o por empleado si hay
 *   seleccionado) cards con periodo/días/neto + expandible para ver
 *   percepciones/deducciones parseadas del JSON (percepcionesJson/
 *   deduccionesJson son strings JSON '[{"concepto","cantidad"}]') +
 *   eliminar con confirm '¿Eliminar registro de nómina?' (HARD delete —
 *   texto 'se eliminará permanentemente').
 *
 * DESVIACIONES CONSCIENTES (mismas que las demás vistas admin):
 * - SnackBars → toasts (useToastStore); AlertDialog → AppModal.
 * - Secciones de datos de empresa (L759-808) y PDF/email (L395-659) del
 *   legacy NO aplican: el backend Rest no los modela (solo records).
 * - Día de pago/Método de pago (L981-1015) NO se envían (no existen en el
 *   contrato RestCreatePayrollRecordRequest — congelado).
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ChevronDown,
  CircleAlert,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
} from 'lucide-vue-next'
import AppModal from '../../components/pos/AppModal.vue'
import AppSelect from '../../components/ui/AppSelect.vue'
import AppBanner from '../../components/ui/AppBanner.vue'
import { AppSpinner } from '../../components/ui'
import { session } from '../../services/auth'
import { useAdminPayrollStore } from '../../stores/adminPayroll'
import { useToastStore } from '../../stores/toast'
import { ApiError } from '../../api/client'
import type {
  PayrollConceptoPayload,
  RestPayrollRecord,
  SavePayrollEmployeePayload,
} from '../../api/rest'

const router = useRouter()
const store = useAdminPayrollStore()
const toast = useToastStore()

// --- Guard de rol (copia EXACTA de ManageCategoriesView onMounted) -----------

onMounted(() => {
  const role = (session.role ?? '').toLowerCase()
  if (!['restadmin', 'superadmin', 'restmanager'].includes(role)) {
    void router.replace({ name: 'modules' })
    return
  }
  void store.loadEmployees(true)
  void store.loadRecords(true)
})

// --- goBack: back arrow del AppBar → admin-dashboard --------------------------

async function goBack(): Promise<void> {
  if (window.history.state?.back != null) {
    await router.back()
    return
  }
  await router.replace({ name: 'admin-dashboard' })
}

// --- Helpers -------------------------------------------------------------------

/** Formato moneda '$X.XX' (display; réplica toStringAsFixed(2) del legacy). */
function formatMoney(amount: number | null | undefined): string {
  const value = amount ?? 0
  return `$${value.toFixed(2)}`
}

/** Parse de cantidad decimal (replaceAll(',', '.') — réplica L111). */
function parseAmount(value: string): number {
  const parsed = Number.parseFloat(value.replaceAll(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

/** Parse de un JSON de conceptos persistido (server camelCase). */
function parseConceptos(json: string | null | undefined): PayrollConceptoPayload[] {
  if (json == null || json.length === 0) return []
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        const it = item as { concepto?: unknown; cantidad?: unknown }
        return {
          concepto: typeof it.concepto === 'string' ? it.concepto : '',
          cantidad: typeof it.cantidad === 'number' ? it.cantidad : 0,
        }
      })
      .filter((c) => c.concepto.length > 0 || c.cantidad !== 0)
  } catch {
    return []
  }
}

/** yyyy-MM-dd de HOY. */
function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** yyyy-MM-dd hace N días (default periodo: hoy-15 → hoy, réplica L43-44). */
function daysAgoIso(days: number): string {
  const now = new Date()
  now.setDate(now.getDate() - days)
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// --- Empleado: picker + autocompletado editable (L684-756 + L173-189) ----------

const hasEmployees = computed(() => store.employees.length > 0)

const employeeOptions = computed(() =>
  store.employees.map((e) => ({
    value: e.id,
    label: `${e.nombre} ${e.apellidoPaterno} - ${e.numeroEmpleado ?? ''}`.trim(),
  })),
)

/** Id del empleado seleccionado en el picker (null = captura manual). */
const selectedEmployeeId = ref<number | null>(null)

/** Datos del empleado (autocompletados del picker, EDITABLES después). */
const form = ref({
  nombre: '',
  rfc: '',
  curp: '',
  nss: '',
  puesto: '',
  salarioDiario: '',
  salarioBase: '',
  periodoInicio: daysAgoIso(15),
  periodoFin: todayIso(),
  diasTrabajados: '15',
})

/**
 * Al elegir empleado del picker: autocompleta nombre/rfc/curp/nss/puesto/
 * salarios (réplica _selectEmployee L173-189). El nombre del record es el
 * nombre completo (nombre + apellidos, L352).
 */
function onSelectEmployee(employeeId: string | number | null): void {
  if (employeeId == null) {
    selectedEmployeeId.value = null
    return
  }
  const employee = store.employees.find((e) => e.id === Number(employeeId))
  if (employee == null) return
  selectedEmployeeId.value = employee.id
  form.value = {
    ...form.value,
    nombre: `${employee.nombre} ${employee.apellidoPaterno} ${employee.apellidoMaterno ?? ''}`.trim(),
    rfc: employee.rfc,
    curp: employee.curp,
    nss: employee.numeroSeguroSocial ?? '',
    puesto: employee.puesto ?? '',
    salarioDiario: String(employee.salarioDiario),
    salarioBase: String(employee.salarioBase),
  }
}

// --- Alta de empleados (modal) — backend f9ad45f POST/DELETE employees ---------
// El flujo de nómina SIEMPRE viaja con empleadoId real: el usuario primero da
// de alta o selecciona un empleado (captura manual con empleadoId=0 removida —
// el backend la rechaza con 400 'El empleado es requerido.').

const showEmployeeModal = ref(false)

const employeeForm = ref({
  nombre: '',
  apellidoPaterno: '',
  apellidoMaterno: '',
  numeroEmpleado: '',
  puesto: '',
  salarioDiario: '',
  salarioBase: '',
  rfc: '',
  curp: '',
  numeroSeguroSocial: '',
})

const savingEmployee = ref(false)

function openEmployeeModal(): void {
  employeeForm.value = {
    nombre: '',
    apellidoPaterno: '',
    apellidoMaterno: '',
    numeroEmpleado: '',
    puesto: '',
    salarioDiario: '',
    salarioBase: '',
    rfc: '',
    curp: '',
    numeroSeguroSocial: '',
  }
  showEmployeeModal.value = true
}

function closeEmployeeModal(): void {
  if (savingEmployee.value) return
  showEmployeeModal.value = false
}

/** Sanitize decimal para los salarios del form de alta (mismo patrón). */
function sanitizeEmployeeAmount(key: 'salarioDiario' | 'salarioBase'): void {
  const cleaned = employeeForm.value[key].replace(/[^\d.]/g, '')
  const dot = cleaned.indexOf('.')
  employeeForm.value[key] =
    dot === -1
      ? cleaned
      : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)
}

/** Autoselecciona en el picker + autocompleta el form de nómina (L173-189). */
function selectNewEmployee(employeeId: number): void {
  selectedEmployeeId.value = employeeId
  onSelectEmployee(employeeId)
}

/**
 * POST employees → toast 'Empleado dado de alta' → recarga (hecha por el
 * store) → autoselecciona el nuevo para continuar la nómina con
 * empleadoId real. Validaciones 400 del backend replicadas en toasts.
 */
async function submitEmployee(): Promise<void> {
  if (savingEmployee.value) return
  const f = employeeForm.value
  if (f.nombre.trim().length === 0) {
    toast.warning('El nombre del empleado es requerido.') // backend exacto
    return
  }
  if (f.apellidoPaterno.trim().length === 0) {
    toast.warning('El apellido paterno es requerido.') // backend exacto
    return
  }
  if (f.rfc.trim().length === 0) {
    toast.warning('El RFC es requerido.') // backend exacto
    return
  }
  if (f.curp.trim().length === 0) {
    toast.warning('La CURP es requerida.') // backend exacto
    return
  }
  const salarioDiario = parseAmount(f.salarioDiario)
  const salarioBase = parseAmount(f.salarioBase)
  if (salarioDiario < 0 || salarioBase < 0) {
    toast.warning('Los salarios no pueden ser negativos.') // backend exacto
    return
  }
  const body: SavePayrollEmployeePayload = {
    nombre: f.nombre.trim(),
    apellidoPaterno: f.apellidoPaterno.trim(),
    apellidoMaterno: f.apellidoMaterno.trim().length > 0 ? f.apellidoMaterno.trim() : null,
    numeroEmpleado: f.numeroEmpleado.trim().length > 0 ? f.numeroEmpleado.trim() : null,
    puesto: f.puesto.trim().length > 0 ? f.puesto.trim() : null,
    salarioDiario,
    salarioBase,
    rfc: f.rfc.trim(),
    curp: f.curp.trim(),
    numeroSeguroSocial:
      f.numeroSeguroSocial.trim().length > 0 ? f.numeroSeguroSocial.trim() : null,
    email: null,
  }
  savingEmployee.value = true
  try {
    const newId = await store.createEmployee(body)
    toast.success('Empleado dado de alta')
    showEmployeeModal.value = false
    selectNewEmployee(newId)
  } catch (err) {
    // 400 backend (duplicado numeroEmpleado, etc.) sube con su message exacto.
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error: ${err.message}`
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    savingEmployee.value = false
  }
}

// --- Desactivar empleado (DELETE employees/{id} — SOFT) ------------------------

const confirmingEmployee = ref<RestPayrollEmployeeLite | null>(null)
const deletingEmployee = ref(false)

interface RestPayrollEmployeeLite {
  id: number
  nombre: string
  apellidoPaterno: string
}

function askDeactivateEmployee(): void {
  if (selectedEmployeeId.value == null) return
  const employee = store.employees.find((e) => e.id === selectedEmployeeId.value)
  if (employee == null) return
  confirmingEmployee.value = {
    id: employee.id,
    nombre: employee.nombre,
    apellidoPaterno: employee.apellidoPaterno,
  }
}

function cancelDeactivateEmployee(): void {
  if (deletingEmployee.value) return
  confirmingEmployee.value = null
}

/** DELETE soft → recarga + limpia el form si el activo era el desactivado. */
async function confirmDeactivateEmployee(): Promise<void> {
  if (confirmingEmployee.value == null || deletingEmployee.value) return
  deletingEmployee.value = true
  try {
    const deactivatedId = confirmingEmployee.value.id
    await store.deleteEmployee(deactivatedId)
    toast.success('Empleado desactivado')
    confirmingEmployee.value = null
    if (selectedEmployeeId.value === deactivatedId) {
      selectedEmployeeId.value = null
      form.value = {
        ...form.value,
        nombre: '',
        rfc: '',
        curp: '',
        nss: '',
        puesto: '',
        salarioDiario: '',
        salarioBase: '',
      }
    }
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error: ${err.message}`
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    deletingEmployee.value = false
  }
}

// --- Percepciones / Deducciones (listas dinámicas L1022-1137 + L1271-1344) -----

interface ConceptoDraft {
  concepto: string
  cantidad: string
}

const percepciones = ref<ConceptoDraft[]>([{ concepto: 'Sueldo', cantidad: '' }])
const deducciones = ref<ConceptoDraft[]>([
  { concepto: 'IMSS', cantidad: '' },
])

/** Sanitize decimal (solo dígitos + un punto, 2 decimales). */
function sanitizeDecimal(draft: ConceptoDraft): void {
  const cleaned = draft.cantidad.replace(/[^\d.]/g, '')
  const dot = cleaned.indexOf('.')
  draft.cantidad =
    dot === -1
      ? cleaned
      : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)
}

/** Total de una lista EN VIVO (display; SERVER recalcula al guardar). */
function totalOf(list: ConceptoDraft[]): number {
  return list.reduce((sum, item) => sum + parseAmount(item.cantidad), 0)
}

const totalPercepciones = computed(() => totalOf(percepciones.value))
const totalDeducciones = computed(() => totalOf(deducciones.value))
const netoPagar = computed(() => totalPercepciones.value - totalDeducciones.value)

function addPercepcion(): void {
  percepciones.value = [...percepciones.value, { concepto: '', cantidad: '' }]
}

function addDeduccion(): void {
  deducciones.value = [...deducciones.value, { concepto: '', cantidad: '' }]
}

function removePercepcion(index: number): void {
  percepciones.value = percepciones.value.filter((_, i) => i !== index)
}

function removeDeduccion(index: number): void {
  deducciones.value = deducciones.value.filter((_, i) => i !== index)
}

// --- Guardar (réplica _saveToDatabase L234-393 + validaciones backend) ---------

const saving = ref(false)

function toConceptos(list: ConceptoDraft[]): PayrollConceptoPayload[] {
  return list
    .filter((item) => item.concepto.trim().length > 0)
    .map((item) => ({ concepto: item.concepto.trim(), cantidad: parseAmount(item.cantidad) }))
}

/** Reset réplica L1176-1206 (con defaults legibles). */
function resetForm(): void {
  selectedEmployeeId.value = null
  form.value = {
    nombre: '',
    rfc: '',
    curp: '',
    nss: '',
    puesto: '',
    salarioDiario: '',
    salarioBase: '',
    periodoInicio: daysAgoIso(15),
    periodoFin: todayIso(),
    diasTrabajados: '15',
  }
  percepciones.value = [{ concepto: 'Sueldo', cantidad: '' }]
  deducciones.value = [{ concepto: 'IMSS', cantidad: '' }]
}

async function submitSave(): Promise<void> {
  if (saving.value) return
  // Validaciones (réplica L243-266 + contratos backend 400):
  // empleadoId SIEMPRE real: alta/selección obligatoria (captura manual con
  // empleadoId=0 removida — el backend la rechaza con 400).
  if (selectedEmployeeId.value == null) {
    toast.warning('Selecciona un empleado o dálo de alta primero')
    return
  }
  if (form.value.nombre.trim().length === 0) {
    toast.warning('Completa al menos Nombre y RFC')
    return
  }
  if (form.value.rfc.trim().length === 0) {
    toast.warning('El RFC es requerido') // backend Validate()
    return
  }
  if (form.value.curp.trim().length === 0) {
    toast.warning('La CURP es requerida') // backend Validate()
    return
  }
  if (form.value.periodoInicio.trim().length === 0 || form.value.periodoFin.trim().length === 0) {
    toast.warning('Selecciona el período de pago')
    return
  }
  const dias = Number.parseInt(form.value.diasTrabajados, 10)
  if (!Number.isFinite(dias) || dias < 1 || dias > 31) {
    toast.warning('Los días trabajados deben estar entre 1 y 31') // backend Validate()
    return
  }
  const salarioDiario = parseAmount(form.value.salarioDiario)
  const salarioBase = parseAmount(form.value.salarioBase)
  if (salarioDiario < 0 || salarioBase < 0) {
    toast.warning('Los salarios no pueden ser negativos') // backend Validate()
    return
  }
  const percepcionesPayload = toConceptos(percepciones.value)
  const deduccionesPayload = toConceptos(deducciones.value)

  saving.value = true
  try {
    // empleadoId SIEMPRE real del picker (rest.employees) — el flujo manual
    // con 0 fue removido junto con el banner de captura libre.
    const { netoPagar: netoServer } = await store.createRecord({
      empleadoId: selectedEmployeeId.value,
      nombreEmpleado: form.value.nombre.trim(),
      rfc: form.value.rfc.trim(),
      curp: form.value.curp.trim(),
      numeroSeguroSocial: form.value.nss.trim().length > 0 ? form.value.nss.trim() : null,
      puesto: form.value.puesto.trim().length > 0 ? form.value.puesto.trim() : null,
      salarioDiario,
      salarioBase,
      periodoInicio: form.value.periodoInicio.trim(),
      periodoFin: form.value.periodoFin.trim(),
      diasTrabajados: dias,
      percepciones: percepcionesPayload,
      deducciones: deduccionesPayload,
    })
    toast.success(`Nómina guardada - Neto: ${formatMoney(netoServer)}`) // brief
    resetForm()
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error guardando nómina: ${err.message}` // réplica L387
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    saving.value = false
  }
}

// --- Historial (GET records + expandible + eliminar hard) -----------------------

const expandedId = ref<number | null>(null)

function toggleExpanded(recordId: number): void {
  expandedId.value = expandedId.value === recordId ? null : recordId
}

const confirmingRecord = ref<RestPayrollRecord | null>(null)
const deleting = ref(false)

function openConfirm(record: RestPayrollRecord): void {
  confirmingRecord.value = record
}

function closeConfirm(): void {
  if (deleting.value) return
  confirmingRecord.value = null
}

/** Eliminar tras confirm — HARD delete (texto 'permanentemente'). */
async function confirmDelete(): Promise<void> {
  if (confirmingRecord.value == null || deleting.value) return
  deleting.value = true
  try {
    await store.deleteRecord(confirmingRecord.value.id)
    toast.success('Registro de nómina eliminado')
    confirmingRecord.value = null
  } catch (err) {
    toast.error(
      err instanceof ApiError && err.status !== 0
        ? `Error: ${err.message}`
        : 'Error: No se pudo conectar con el servidor. Verifica tu conexión.',
    )
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="py-page">
    <!-- ===== AppBar réplica L675-678: back + título + refresh ===== -->
    <header class="py-appbar">
      <button
        type="button"
        class="py-icon-btn"
        title="Regresar a Administración"
        aria-label="Regresar a Administración"
        data-testid="py-back"
        @click="goBack"
      >
        <svg
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m12 19-7-7 7-7" />
          <path d="M19 12H5" />
        </svg>
      </button>
      <h1 class="py-appbar-title">Crear Nómina</h1>
      <div class="py-appbar-actions">
        <button
          type="button"
          class="py-icon-btn"
          title="Recargar"
          aria-label="Recargar"
          data-testid="py-refresh"
          @click="store.loadEmployees(true); store.loadRecords(true)"
        >
          <RefreshCw :size="20" aria-hidden="true" />
        </button>
      </div>
    </header>

    <main class="py-body">
      <!-- ===== Banner error carga empleados (réplica L162-167) ===== -->
      <AppBanner v-if="store.employeesError != null" type="error" data-testid="py-employees-error">
        {{ store.employeesError }}
      </AppBanner>

      <!-- ===== Sin empleados: banner + CTA alta (backend f9ad45f) ===== -->
      <div
        v-if="!store.employeesLoading && store.employeesError == null && !hasEmployees"
        class="py-empty-employees"
        data-testid="py-no-employees"
      >
        <AppBanner type="warning">
          No hay empleados dados de alta — da de alta uno para crear la nómina
        </AppBanner>
        <button
          type="button"
          class="py-btn py-btn--primary py-add-employee-btn"
          data-testid="py-open-employee-modal"
          @click="openEmployeeModal"
        >
          <UserPlus :size="18" aria-hidden="true" />
          Dar de alta empleado
        </button>
      </div>

      <!-- ===== Sección empleado: picker + gestión ligera ===== -->
      <section class="py-card" data-testid="py-picker-card">
        <div class="py-card-head">
          <h2 class="py-card-title">Seleccionar Empleado</h2>
          <button
            type="button"
            class="py-add-btn py-add-btn--percepcion"
            data-testid="py-picker-add-employee"
            @click="openEmployeeModal"
          >
            <UserPlus :size="16" aria-hidden="true" />
            Dar de alta otro
          </button>
        </div>
        <div class="py-field">
          <span class="py-label">Empleado Existente</span>
          <AppSelect
            v-model="selectedEmployeeId"
            :options="employeeOptions"
            :disabled="!hasEmployees"
            placeholder="Sin empleado seleccionado"
            testid="py-employee-picker"
            aria-label="Empleado Existente"
            @update:model-value="onSelectEmployee"
          />
        </div>
        <div v-if="hasEmployees" class="py-picker-actions">
          <button
            type="button"
            class="py-picker-action py-picker-action--danger"
            data-testid="py-deactivate-employee"
            :disabled="selectedEmployeeId == null"
            @click="askDeactivateEmployee"
          >
            <Trash2 :size="14" aria-hidden="true" />
            Desactivar empleado
          </button>
          <button
            type="button"
            class="py-picker-action"
            data-testid="py-reload-employees"
            @click="store.loadEmployees(true)"
          >
            <RefreshCw :size="14" aria-hidden="true" />
            Recargar lista
          </button>
        </div>
      </section>

      <!-- ===== Información del empleado (L811-933, editable siempre) ===== -->
      <section class="py-card" data-testid="py-employee-form">
        <h2 class="py-card-title">Información del Empleado</h2>
        <div class="py-field">
          <label class="py-label" for="py-nombre">Nombre (completo)</label>
          <input
            id="py-nombre"
            v-model="form.nombre"
            type="text"
            class="py-input"
            data-testid="py-nombre"
            autocomplete="off"
            maxlength="200"
          />
        </div>
        <div class="py-row">
          <div class="py-field">
            <label class="py-label" for="py-rfc">RFC</label>
            <input
              id="py-rfc"
              v-model="form.rfc"
              type="text"
              class="py-input"
              data-testid="py-rfc"
              autocomplete="off"
              maxlength="40"
            />
          </div>
          <div class="py-field">
            <label class="py-label" for="py-curp">CURP</label>
            <input
              id="py-curp"
              v-model="form.curp"
              type="text"
              class="py-input"
              data-testid="py-curp"
              autocomplete="off"
              maxlength="40"
            />
          </div>
        </div>
        <div class="py-row">
          <div class="py-field">
            <label class="py-label" for="py-nss">NSS</label>
            <input
              id="py-nss"
              v-model="form.nss"
              type="text"
              class="py-input"
              data-testid="py-nss"
              autocomplete="off"
              maxlength="40"
            />
          </div>
          <div class="py-field">
            <label class="py-label" for="py-puesto">Puesto</label>
            <input
              id="py-puesto"
              v-model="form.puesto"
              type="text"
              class="py-input"
              data-testid="py-puesto"
              autocomplete="off"
              maxlength="200"
            />
          </div>
        </div>
        <div class="py-row">
          <div class="py-field">
            <label class="py-label" for="py-salario-diario">Salario Diario</label>
            <input
              id="py-salario-diario"
              v-model="form.salarioDiario"
              type="text"
              class="py-input"
              data-testid="py-salario-diario"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0.00"
            />
          </div>
          <div class="py-field">
            <label class="py-label" for="py-salario-base">Salario Base</label>
            <input
              id="py-salario-base"
              v-model="form.salarioBase"
              type="text"
              class="py-input"
              data-testid="py-salario-base"
              inputmode="decimal"
              autocomplete="off"
              placeholder="0.00"
            />
          </div>
        </div>
      </section>

      <!-- ===== Período de pago (L937-1019) ===== -->
      <section class="py-card" data-testid="py-periodo">
        <h2 class="py-card-title">Período de Pago</h2>
        <div class="py-row">
          <div class="py-field">
            <label class="py-label" for="py-inicio">Inicio</label>
            <input
              id="py-inicio"
              v-model="form.periodoInicio"
              type="date"
              class="py-input py-input--date"
              data-testid="py-inicio"
            />
          </div>
          <div class="py-field">
            <label class="py-label" for="py-fin">Fin</label>
            <input
              id="py-fin"
              v-model="form.periodoFin"
              type="date"
              class="py-input py-input--date"
              data-testid="py-fin"
            />
          </div>
        </div>
        <div class="py-field py-field--narrow">
          <label class="py-label" for="py-dias">Días trabajados (1-31)</label>
          <input
            id="py-dias"
            v-model="form.diasTrabajados"
            type="text"
            class="py-input"
            data-testid="py-dias"
            inputmode="numeric"
            autocomplete="off"
            @input="form.diasTrabajados = form.diasTrabajados.replace(/\D/g, '')"
          />
        </div>
      </section>

      <!-- ===== Percepciones (L1022-1078) ===== -->
      <section class="py-card" data-testid="py-percepciones">
        <div class="py-card-head">
          <h2 class="py-card-title">Percepciones</h2>
          <button
            type="button"
            class="py-add-btn py-add-btn--percepcion"
            data-testid="py-add-percepcion"
            @click="addPercepcion"
          >
            <Plus :size="18" aria-hidden="true" />
            Agregar percepción
          </button>
        </div>

        <div
          v-for="(item, index) in percepciones"
          :key="`perc-${index}`"
          class="py-concepto"
          :data-testid="`py-percepcion-${index}`"
        >
          <input
            v-model="item.concepto"
            type="text"
            class="py-input py-concepto-nombre"
            placeholder="Concepto"
            aria-label="Concepto de la percepción"
            autocomplete="off"
            maxlength="200"
          />
          <input
            v-model="item.cantidad"
            type="text"
            class="py-input py-concepto-cantidad"
            placeholder="0.00"
            aria-label="Cantidad de la percepción"
            inputmode="decimal"
            autocomplete="off"
            @input="sanitizeDecimal(item)"
          />
          <button
            type="button"
            class="py-item-btn py-item-btn--delete"
            :aria-label="`Quitar percepción ${index + 1}`"
            :data-testid="`py-remove-percepcion-${index}`"
            @click="removePercepcion(index)"
          >
            <Trash2 :size="18" aria-hidden="true" />
          </button>
        </div>

        <div class="py-total py-total--percepcion" data-testid="py-total-percepciones">
          <span>Total Percepciones:</span>
          <span>{{ formatMoney(totalPercepciones) }}</span>
        </div>
      </section>

      <!-- ===== Deducciones (L1081-1137) ===== -->
      <section class="py-card" data-testid="py-deducciones">
        <div class="py-card-head">
          <h2 class="py-card-title">Deducciones</h2>
          <button
            type="button"
            class="py-add-btn py-add-btn--deduccion"
            data-testid="py-add-deduccion"
            @click="addDeduccion"
          >
            <Plus :size="18" aria-hidden="true" />
            Agregar deducción
          </button>
        </div>

        <div
          v-for="(item, index) in deducciones"
          :key="`ded-${index}`"
          class="py-concepto"
          :data-testid="`py-deduccion-${index}`"
        >
          <input
            v-model="item.concepto"
            type="text"
            class="py-input py-concepto-nombre"
            placeholder="Concepto"
            aria-label="Concepto de la deducción"
            autocomplete="off"
            maxlength="200"
          />
          <input
            v-model="item.cantidad"
            type="text"
            class="py-input py-concepto-cantidad"
            placeholder="0.00"
            aria-label="Cantidad de la deducción"
            inputmode="decimal"
            autocomplete="off"
            @input="sanitizeDecimal(item)"
          />
          <button
            type="button"
            class="py-item-btn py-item-btn--delete"
            :aria-label="`Quitar deducción ${index + 1}`"
            :data-testid="`py-remove-deduccion-${index}`"
            @click="removeDeduccion(index)"
          >
            <Trash2 :size="18" aria-hidden="true" />
          </button>
        </div>

        <div class="py-total py-total--deduccion" data-testid="py-total-deducciones">
          <span>Total Deducciones:</span>
          <span>{{ formatMoney(totalDeducciones) }}</span>
        </div>
      </section>

      <!-- ===== Neto a pagar (L1140-1166): display grande en vivo ===== -->
      <section class="py-neto" :class="{ 'py-neto--negative': netoPagar < 0 }" data-testid="py-neto">
        <span class="py-neto-label">NETO A PAGAR</span>
        <span class="py-neto-value" data-testid="py-neto-value">
          {{ formatMoney(netoPagar) }}
        </span>
        <span v-if="netoPagar < 0" class="py-neto-badge">NEGATIVO</span>
      </section>

      <!-- ===== Botón Guardar (L1211-1241 'Guardar en BD' → brief) ===== -->
      <button
        type="button"
        class="py-btn py-btn--primary py-btn--block"
        data-testid="py-save"
        :disabled="saving"
        @click="submitSave"
      >
        <AppSpinner v-if="saving" :size="16" tone="light" />
        Guardar Nómina
      </button>

      <!-- ===== Historial (GET records) ===== -->
      <h2 class="py-section-title" data-testid="py-historial-title">Historial de nóminas</h2>

      <div v-if="store.recordsLoading" class="py-state" data-testid="py-records-loading">
        <AppSpinner :size="36" tone="primary" />
      </div>

      <div v-else-if="store.recordsError != null" class="py-state" data-testid="py-records-error">
        <CircleAlert :size="64" class="py-state-error-icon" aria-hidden="true" />
        <p class="py-state-text">{{ store.recordsError }}</p>
        <button
          type="button"
          class="py-retry"
          data-testid="py-records-retry"
          @click="store.loadRecords(true)"
        >
          Reintentar
        </button>
      </div>

      <p
        v-else-if="store.records.length === 0"
        class="py-state py-empty"
        data-testid="py-records-empty"
      >
        No hay registros de nómina
      </p>

      <ul v-else class="py-records" data-testid="py-records">
        <li
          v-for="record in store.records"
          :key="record.id"
          class="py-record"
          :data-testid="`py-record-${record.id}`"
        >
          <button
            type="button"
            class="py-record-head"
            :aria-expanded="expandedId === record.id"
            :data-testid="`py-record-toggle-${record.id}`"
            @click="toggleExpanded(record.id)"
          >
            <span class="py-record-info">
              <span class="py-record-name">{{ record.nombreEmpleado }}</span>
              <span class="py-record-meta">
                {{ record.periodoInicio }} → {{ record.periodoFin }} · {{ record.diasTrabajados }} días
              </span>
            </span>
            <span
              class="py-record-neto"
              :class="{ 'py-record-neto--negative': record.netoPagar < 0 }"
            >
              {{ formatMoney(record.netoPagar) }}
            </span>
            <ChevronDown
              :size="20"
              class="py-record-chevron"
              :class="{ 'py-record-chevron--open': expandedId === record.id }"
              aria-hidden="true"
            />
          </button>

          <div v-if="expandedId === record.id" class="py-record-detail" data-testid="py-record-detail">
            <div class="py-detail-row">
              <span class="py-detail-label">RFC / CURP</span>
              <span class="py-detail-value">{{ record.rfc }} / {{ record.curp }}</span>
            </div>
            <div class="py-detail-row">
              <span class="py-detail-label">Salario diario / base</span>
              <span class="py-detail-value">
                {{ formatMoney(record.salarioDiario) }} / {{ formatMoney(record.salarioBase) }}
              </span>
            </div>
            <div class="py-detail-row">
              <span class="py-detail-label">Percepciones ({{ formatMoney(record.totalPercepciones) }})</span>
              <span class="py-detail-value">
                <template v-if="parseConceptos(record.percepcionesJson).length > 0">
                  <span
                    v-for="(c, i) in parseConceptos(record.percepcionesJson)"
                    :key="`p-${record.id}-${i}`"
                    class="py-concepto-chip"
                  >
                    {{ c.concepto }}: {{ formatMoney(c.cantidad) }}
                  </span>
                </template>
                <template v-else>—</template>
              </span>
            </div>
            <div class="py-detail-row">
              <span class="py-detail-label">Deducciones ({{ formatMoney(record.totalDeducciones) }})</span>
              <span class="py-detail-value">
                <template v-if="parseConceptos(record.deduccionesJson).length > 0">
                  <span
                    v-for="(c, i) in parseConceptos(record.deduccionesJson)"
                    :key="`d-${record.id}-${i}`"
                    class="py-concepto-chip"
                  >
                    {{ c.concepto }}: {{ formatMoney(c.cantidad) }}
                  </span>
                </template>
                <template v-else>—</template>
              </span>
            </div>
            <button
              type="button"
              class="py-btn py-btn--danger py-btn--small"
              :data-testid="`py-record-delete-${record.id}`"
              @click="openConfirm(record)"
            >
              <Trash2 :size="16" aria-hidden="true" />
              Eliminar
            </button>
          </div>
        </li>
      </ul>
    </main>

    <!-- ===== Confirm eliminar: HARD delete (texto 'permanentemente') ===== -->
    <AppModal
      v-if="confirmingRecord != null"
      title="Eliminar registro de nómina"
      :width="420"
      @close="closeConfirm"
    >
      <p class="py-confirm-text" data-testid="py-confirm-text">
        ¿Eliminar registro de nómina de {{ confirmingRecord.nombreEmpleado }}? Se eliminará
        permanentemente y no se podrá recuperar.
      </p>
      <template #footer>
        <button
          type="button"
          class="py-btn py-btn--ghost"
          data-testid="py-confirm-cancel"
          :disabled="deleting"
          @click="closeConfirm"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="py-btn py-btn--danger"
          data-testid="py-confirm-ok"
          :disabled="deleting"
          @click="confirmDelete"
        >
          Eliminar
        </button>
      </template>
    </AppModal>

    <!-- ===== Modal alta de empleado (POST employees, backend f9ad45f) ===== -->
    <AppModal
      v-if="showEmployeeModal"
      title="Dar de alta empleado"
      :width="480"
      @close="closeEmployeeModal"
    >
      <div class="py-field">
        <label class="py-label" for="py-emp-nombre">Nombre *</label>
        <input
          id="py-emp-nombre"
          v-model="employeeForm.nombre"
          type="text"
          class="py-input"
          data-testid="py-emp-nombre"
          autocomplete="off"
          maxlength="200"
        />
      </div>
      <div class="py-row">
        <div class="py-field">
          <label class="py-label" for="py-emp-apellido-paterno">Apellido paterno *</label>
          <input
            id="py-emp-apellido-paterno"
            v-model="employeeForm.apellidoPaterno"
            type="text"
            class="py-input"
            data-testid="py-emp-apellido-paterno"
            autocomplete="off"
            maxlength="200"
          />
        </div>
        <div class="py-field">
          <label class="py-label" for="py-emp-apellido-materno">Apellido materno</label>
          <input
            id="py-emp-apellido-materno"
            v-model="employeeForm.apellidoMaterno"
            type="text"
            class="py-input"
            data-testid="py-emp-apellido-materno"
            autocomplete="off"
            maxlength="200"
          />
        </div>
      </div>
      <div class="py-row">
        <div class="py-field">
          <label class="py-label" for="py-emp-numero">Número de empleado</label>
          <input
            id="py-emp-numero"
            v-model="employeeForm.numeroEmpleado"
            type="text"
            class="py-input"
            data-testid="py-emp-numero"
            autocomplete="off"
            maxlength="100"
          />
        </div>
        <div class="py-field">
          <label class="py-label" for="py-emp-puesto">Puesto</label>
          <input
            id="py-emp-puesto"
            v-model="employeeForm.puesto"
            type="text"
            class="py-input"
            data-testid="py-emp-puesto"
            autocomplete="off"
            maxlength="200"
          />
        </div>
      </div>
      <div class="py-row">
        <div class="py-field">
          <label class="py-label" for="py-emp-salario-diario">Salario diario</label>
          <input
            id="py-emp-salario-diario"
            v-model="employeeForm.salarioDiario"
            type="text"
            class="py-input"
            data-testid="py-emp-salario-diario"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0.00"
            @input="sanitizeEmployeeAmount('salarioDiario')"
          />
        </div>
        <div class="py-field">
          <label class="py-label" for="py-emp-salario-base">Salario base</label>
          <input
            id="py-emp-salario-base"
            v-model="employeeForm.salarioBase"
            type="text"
            class="py-input"
            data-testid="py-emp-salario-base"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0.00"
            @input="sanitizeEmployeeAmount('salarioBase')"
          />
        </div>
      </div>
      <div class="py-row">
        <div class="py-field">
          <label class="py-label" for="py-emp-rfc">RFC *</label>
          <input
            id="py-emp-rfc"
            v-model="employeeForm.rfc"
            type="text"
            class="py-input"
            data-testid="py-emp-rfc"
            autocomplete="off"
            maxlength="40"
          />
        </div>
        <div class="py-field">
          <label class="py-label" for="py-emp-curp">CURP *</label>
          <input
            id="py-emp-curp"
            v-model="employeeForm.curp"
            type="text"
            class="py-input"
            data-testid="py-emp-curp"
            autocomplete="off"
            maxlength="40"
          />
        </div>
      </div>
      <div class="py-field">
        <label class="py-label" for="py-emp-nss">Número de seguro social</label>
        <input
          id="py-emp-nss"
          v-model="employeeForm.numeroSeguroSocial"
          type="text"
          class="py-input"
          data-testid="py-emp-nss"
          autocomplete="off"
          maxlength="40"
        />
      </div>
      <p class="py-modal-note">* Campos requeridos. El empleado nace activo.</p>
      <template #footer>
        <button
          type="button"
          class="py-btn py-btn--ghost"
          data-testid="py-emp-cancel"
          :disabled="savingEmployee"
          @click="closeEmployeeModal"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="py-btn py-btn--primary"
          data-testid="py-emp-save"
          :disabled="savingEmployee"
          @click="submitEmployee"
        >
          <AppSpinner v-if="savingEmployee" :size="16" tone="light" />
          Dar de alta
        </button>
      </template>
    </AppModal>

    <!-- ===== Confirm desactivar empleado (DELETE employees — SOFT) ===== -->
    <AppModal
      v-if="confirmingEmployee != null"
      title="Desactivar empleado"
      :width="420"
      @close="cancelDeactivateEmployee"
    >
      <p class="py-confirm-text" data-testid="py-emp-confirm-text">
        ¿Desactivar a {{ confirmingEmployee.nombre }} {{ confirmingEmployee.apellidoPaterno }}? El
        empleado dejará de aparecer en la lista y no podrá seleccionarse para nuevas nóminas.
      </p>
      <template #footer>
        <button
          type="button"
          class="py-btn py-btn--ghost"
          data-testid="py-emp-confirm-cancel"
          :disabled="deletingEmployee"
          @click="cancelDeactivateEmployee"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="py-btn py-btn--danger"
          data-testid="py-emp-confirm-ok"
          :disabled="deletingEmployee"
          @click="confirmDeactivateEmployee"
        >
          Desactivar
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* Scaffold grey[900] full-screen standalone (mismo layout que
   ManageUsersView: var(--bg), sin rail). */
.py-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  font-family: var(--font);
}

/* ===== AppBar ===== */
.py-appbar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  padding: max(16px, env(safe-area-inset-top)) 24px 6px;
  background: var(--bg);
}

.py-appbar-title {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.025em;
  line-height: 1.25;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.py-appbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* IconButton circular 44px con borde sutil */
.py-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: none;
  padding: 0;
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  color: var(--text-2);
  cursor: pointer;
  transition:
    color var(--dur) var(--ease),
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease);
}

.py-icon-btn:hover {
  color: var(--text-1);
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--border);
}

.py-icon-btn:active {
  background: rgba(255, 255, 255, 0.1);
}

/* ===== Cuerpo centrado ===== */
.py-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  padding: 14px 0 32px;
  gap: 12px;
}

/* ===== Cards de sección ===== */
.py-card {
  margin: 0 16px;
  padding: 16px;
  background: var(--card);
  border-radius: 16px;
  border: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.py-card-title {
  margin: 0;
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: -0.015em;
  color: var(--text-1);
}

.py-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.py-row {
  display: flex;
  gap: 12px;
}

.py-row .py-field {
  flex: 1;
  min-width: 0;
}

.py-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.py-field--narrow {
  max-width: 220px;
}

.py-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
}

/* InputDecoration: fill elevado, outline sutil, foco naranja */
.py-input {
  width: 100%;
  height: 44px;
  padding: 0 12px;
  background: var(--elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-1);
  font-family: var(--font);
  font-size: 15px;
  outline: none;
  transition:
    border-color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease);
}

.py-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(255, 100, 45, 0.16);
}

.py-input--date {
  color-scheme: dark;
}

/* ===== 'Agregar percepción/deducción' ===== */
.py-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  font-family: var(--font);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
  cursor: pointer;
  transition: background var(--dur) var(--ease);
}

.py-add-btn--percepcion {
  color: var(--primary);
}

.py-add-btn--deduccion {
  color: var(--error);
}

.py-add-btn:hover {
  background: rgba(255, 255, 255, 0.07);
}

/* ===== Renglón concepto {concepto, cantidad} + quitar (L1280-1341) ===== */
.py-concepto {
  display: flex;
  align-items: center;
  gap: 8px;
}

.py-concepto-nombre {
  flex: 2;
}

.py-concepto-cantidad {
  flex: 1;
}

.py-item-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--text-2);
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    color var(--dur) var(--ease);
  flex: none;
}

.py-item-btn:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text-1);
}

.py-item-btn--delete {
  color: var(--error);
}

/* ===== Totales en vivo: pastilla sobria, sin borde grueso ===== */
.py-total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 13px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}

/* El acento aquí es el importe, no el contenedor: se evita el marco grueso. */
.py-total--percepcion {
  background: var(--primary-soft);
  color: var(--text-2);
}

.py-total--percepcion span:last-child {
  color: var(--primary);
  font-weight: 600;
  font-size: 14px;
}

.py-total--deduccion {
  background: var(--error-soft);
  color: var(--text-2);
}

.py-total--deduccion span:last-child {
  color: var(--error);
  font-weight: 600;
  font-size: 14px;
}

/* ===== NETO A PAGAR: hero de la vista ===== */
.py-neto {
  margin: 0 16px;
  padding: 16px 17px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: 18px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* Etiqueta con punto naranja: el acento va al marcador, no al número. */
.py-neto-label {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-2);
}

.py-neto-label::before {
  content: '';
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 999px;
  background: var(--primary);
}

.py-neto-value {
  font-size: clamp(26px, 8vw, 32px);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.05;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}

.py-neto--negative {
  background: var(--card);
}

.py-neto--negative .py-neto-value {
  color: var(--error);
}

.py-neto--negative .py-neto-label::before {
  background: var(--error);
}

.py-neto-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--error-soft);
  color: var(--error);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

/* ===== Botones ===== */
.py-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 20px;
  border-radius: var(--radius-md);
  font-family: var(--font);
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease);
}

.py-btn--primary {
  background: var(--primary);
  color: var(--on-primary);
  margin: 0 16px;
}

.py-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

/* CTA de guardado: ancho completo, es el único sólido naranja de la vista. */
.py-btn--block {
  align-self: stretch;
  min-height: 48px;
  font-size: 15px;
}

.py-btn--danger {
  background: var(--error-soft);
  border-color: color-mix(in srgb, var(--error) 40%, transparent);
  color: var(--error);
}

.py-btn--danger:hover:not(:disabled) {
  filter: brightness(1.1);
}

.py-btn--ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--text-2);
}

.py-btn--ghost:hover:not(:disabled) {
  color: var(--text-1);
  border-color: var(--border-strong);
}

.py-btn--small {
  min-height: 44px;
  padding: 0 14px;
  font-size: 13px;
  align-self: flex-start;
  margin: 0;
}

.py-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ===== Historial ===== */
.py-section-title {
  margin: 8px 16px 0;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.055em;
  text-transform: uppercase;
  color: var(--text-2);
}

.py-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 44px 24px;
  text-align: center;
}

.py-empty {
  margin: 0;
  padding: 40px 20px;
  color: var(--text-2);
  font-size: 14px;
  line-height: 1.55;
}

.py-state-error-icon {
  color: var(--error);
}

.py-state-text {
  margin: 0;
  max-width: 34ch;
  color: var(--text-2);
  font-size: 14px;
  line-height: 1.55;
}

/* Reintentar: secundario (el CTA principal es 'Guardar nómina'). */
.py-retry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 20px;
  background: var(--elevated);
  color: var(--text-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-family: var(--font);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease);
}

.py-retry:hover {
  background: var(--surface-hover);
  border-color: var(--border-strong);
}

.py-records {
  margin: 0 16px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.py-record {
  background: var(--card);
  border-radius: 16px;
  border: 1px solid var(--border-soft);
  overflow: hidden;
  transition: border-color var(--dur) var(--ease);
}

.py-record:hover {
  border-color: var(--border);
}

.py-record-head {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 64px;
  padding: 12px 14px;
  background: transparent;
  border: none;
  font-family: var(--font);
  text-align: left;
  cursor: pointer;
  color: var(--text-1);
  transition: background var(--dur) var(--ease);
}

.py-record-head:hover {
  background: rgba(255, 255, 255, 0.04);
}

.py-record-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.py-record-name {
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: -0.015em;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.py-record-meta {
  font-size: 12px;
  color: var(--text-2);
}

/* El neto del historial NO va naranja: el acento vive en el hero. */
.py-record-neto {
  flex: none;
  font-size: 14.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-1);
}

.py-record-neto--negative {
  color: var(--error);
}

.py-record-chevron {
  flex: none;
  color: var(--text-3);
  transition: transform var(--dur) var(--ease);
}

.py-record-chevron--open {
  transform: rotate(180deg);
}

.py-record-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 13px 14px;
  border-top: 1px solid var(--border-soft);
  background: rgba(255, 255, 255, 0.02);
}

.py-detail-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.py-detail-label {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-3);
}

.py-detail-value {
  font-size: 13.5px;
  color: var(--text-1);
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.py-concepto-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-soft);
  font-size: 11.5px;
  color: var(--text-2);
}

/* ===== Confirm texto ===== */
.py-confirm-text {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.55;
  color: var(--text-2);
}

/* ===== Responsive: móvil ===== */
@media (max-width: 560px) {
  .py-appbar {
    padding: max(12px, env(safe-area-inset-top)) 16px 4px;
  }

  .py-appbar-title {
    font-size: 18px;
  }

  .py-card,
  .py-neto,
  .py-btn--primary,
  .py-section-title,
  .py-records {
    margin-left: 14px;
    margin-right: 14px;
  }

  .py-row {
    flex-direction: column;
    gap: 12px;
  }

  .py-field--narrow {
    max-width: none;
  }

  .py-neto {
    padding: 15px;
    gap: 8px;
  }
}

/* ===== Alta/gestión de empleados (backend f9ad45f) ============================ */

.py-empty-employees {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.py-add-employee-btn {
  margin: 0; /* override del margin lateral del --primary */
}

.py-picker-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.py-picker-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-2);
  font-family: var(--font);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition:
    color var(--dur) var(--ease),
    border-color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

.py-picker-action:hover:not(:disabled) {
  color: var(--text-1);
  border-color: var(--border-strong);
  background: rgba(255, 255, 255, 0.05);
}

.py-picker-action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.py-picker-action--danger {
  color: var(--error);
  border-color: color-mix(in srgb, var(--error) 35%, transparent);
}

.py-picker-action--danger:hover:not(:disabled) {
  color: var(--error);
  border-color: var(--error);
  background: var(--error-soft);
}

.py-modal-note {
  margin: 12px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-3);
}
</style>
