<script setup lang="ts">
/**
 * SettingsView · pantalla AJUSTES del rail (Fase 3 ronda 2; ajustada
 * 2026-11-14 por decisión del dueño).
 *
 * Réplica de lib/screens/admin/settings.dart (SettingsAdming):
 * - Scaffold bg #212121, AppBar "Ajustes" con bg del scaffold.
 * - ListView con dos tiles:
 *   Icons.print_outlined → "Impresora de Tickets"
 *   subtitle "Busca y configura tu impresora de red"
 *   → /ajustes/impresoras (ronda Piso 1: PrintersView réplica
 *     printer_settings_screen.dart).
 *   RefreshCw → "Buscar actualizaciones" (solo desktop y APK): muestra la
 *   versión instalada y fuerza un chequeo del updater. No es parte del .dart:
 *   se añadió porque el auto-update es silencioso y sin esto no hay forma de
 *   saber si el equipo ya está al día o si el chequeo está roto.
 *   ("Precio del dólar", "Crear Nuevo Producto" y "Configuración del ticket"
 *   se retiraron de esta pantalla por decisión del dueño; el ticket-config
 *   sigue disponible vía API y sus flags aplican a los tickets.)
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ImagePlus, Printer, RefreshCw, Smartphone } from 'lucide-vue-next'
import { checkUpdatesNow, readInstalledVersionLabel } from '../../services/update-ui'
import { getPlatform } from '../../services/device'
import { session } from '../../services/auth'
import { bustLogoCache, logoPath } from '../../services/company-logo'
import {
  isIconCustomizationAvailable,
  listIconPresets,
  pinCompanyShortcut,
  setIconPreset,
} from '../../services/app-icon'
import type { IconPreset } from '../../services/app-icon'
import { ApiError, apiGet, apiUpload } from '../../api/client'
import { useToastStore } from '../../stores/toast'

const router = useRouter()
const toast = useToastStore()

function openPrinters(): void {
  void router.push('/ajustes/impresoras')
}

/**
 * Diagnóstico del auto-update.
 *
 * Existe porque cuando el aviso de actualización no aparece no hay forma de
 * distinguir "ya estás al día" de "el chequeo está roto": todo el flujo es
 * silencioso a propósito. Aquí se ve la versión instalada (la MISMA que compara
 * el updater) y se puede forzar un chequeo sin esperar el throttle de 15 min.
 * En web no hay updater: la sección no se pinta.
 */
const platform = ref(getPlatform())
const installedVersion = ref<string | null>(null)
const checking = ref(false)
const checkResult = ref('')

onMounted(async () => {
  platform.value = getPlatform()
  if (platform.value !== 'Web') {
    installedVersion.value = await readInstalledVersionLabel()
  }
  // Estado de revisión del logo (best-effort: sin red queda el texto genérico).
  if (companyId.value != null) {
    try {
      const { data } = await apiGet<{ status?: string }>('/api/rest/company/logo/status')
      logoStatus.value = (data as { status?: string })?.status ?? ''
    } catch {
      // 404 mientras no haya logo subido: no es un error para el usuario.
    }
  }
  // Personalización del ícono: sólo existe en el APK (RestIconPlugin).
  if (await isIconCustomizationAvailable()) {
    const result = await listIconPresets()
    if (result) {
      iconPresets.value = result.presets
      iconPreset.value = result.current
      iconAvailable.value = true
    }
  }
})

async function onCheckUpdates(): Promise<void> {
  if (checking.value) return
  checking.value = true
  checkResult.value = ''
  try {
    checkResult.value = await checkUpdatesNow()
    installedVersion.value = await readInstalledVersionLabel()
  } catch {
    checkResult.value = 'No se pudo comprobar. Revisa la conexión.'
  } finally {
    checking.value = false
  }
}

/** 4 MB es el límite del backend (RequestSizeLimit de RestCompanyController). */
const LOGO_MAX_BYTES = 4 * 1024 * 1024

const companyId = computed(() => session.companyId)
/** Solo el admin de la empresa puede cambiar el logo (afecta a todos los equipos). */
const canEditLogo = computed(() => {
  const role = (session.role ?? '').toUpperCase()
  return role === 'RESTADMIN' || role === 'ADMINISTRADOR' || role === 'SUPERADMIN'
})

const existingLogoSrc = computed(() => logoPath(companyId.value))
const existingLogoFailed = ref(false)
const logoFile = ref<File | null>(null)
const logoPreviewUrl = ref('')
const uploadError = ref('')
const uploading = ref(false)
const logoFileInput = ref<HTMLInputElement | null>(null)
/** Estado de revisión que reporta el servidor ('none' | 'pending' | 'approved' | ...). */
const logoStatus = ref('')

const logoStatusLabel = computed(() => {
  switch (logoStatus.value) {
    case 'approved':
      return 'Aprobado y visible en todos los dispositivos.'
    case 'pending':
      return 'En revisión. Se verá en todos los dispositivos al aprobarse.'
    case 'rejected':
      return 'Rechazado. Sube otra imagen.'
    default:
      return existingLogoFailed.value
        ? 'Sin logo: se usa el de TekLive.'
        : 'Logo actual de la empresa.'
  }
})

function onLogoPick(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  uploadError.value = ''
  if (logoPreviewUrl.value) URL.revokeObjectURL(logoPreviewUrl.value)
  logoPreviewUrl.value = ''
  logoFile.value = null
  if (!file) return
  if (!file.type.startsWith('image/')) {
    uploadError.value = 'El archivo debe ser una imagen.'
    input.value = ''
    return
  }
  if (file.size > LOGO_MAX_BYTES) {
    uploadError.value = 'La imagen debe pesar menos de 4 MB.'
    input.value = ''
    return
  }
  logoFile.value = file
  logoPreviewUrl.value = URL.createObjectURL(file)
}

function clearLogoPick(): void {
  if (logoPreviewUrl.value) URL.revokeObjectURL(logoPreviewUrl.value)
  logoPreviewUrl.value = ''
  logoFile.value = null
  uploadError.value = ''
  if (logoFileInput.value) logoFileInput.value.value = ''
}

async function onUploadLogo(): Promise<void> {
  if (logoFile.value == null || uploading.value) return
  uploading.value = true
  uploadError.value = ''
  try {
    const form = new FormData()
    form.append('file', logoFile.value)
    await apiUpload<{ message?: string }>('/api/rest/company/logo', form)
    // El logo cambia para todos: se refresca el ícono de esta máquina al
    // instante y las demás lo toman en su siguiente arranque/refresco.
    logoStatus.value = 'pending'
    existingLogoFailed.value = false
    bustLogoCache()
    clearLogoPick()
    toast.success('Logo enviado. Quedará pendiente de revisión.')
  } catch (err) {
    uploadError.value =
      err instanceof ApiError && err.message
        ? err.message
        : 'No se pudo subir el logo. Revisa la conexión.'
    toast.error(uploadError.value)
  } finally {
    uploading.value = false
  }
}

/**
 * Personalización del ícono de la app (sólo APK).
 *
 * `iconAvailable` se activa cuando RestIconPlugin responde. En web y desktop
 * queda false y la sección no se pinta: no tiene sentido mostrar un control que
 * no puede hacer nada.
 */
const iconAvailable = ref(false)
const iconPresets = ref<IconPreset[]>([])
const iconPreset = ref('')
const changingIcon = ref(false)
const pinningShortcut = ref(false)

async function onPickPreset(preset: string): Promise<void> {
  if (changingIcon.value || preset === iconPreset.value) return
  changingIcon.value = true
  try {
    const ok = await setIconPreset(preset)
    if (ok) {
      iconPreset.value = preset
      toast.success('Ícono actualizado. El lanzador puede tardar unos segundos.')
    } else {
      toast.error('No se pudo cambiar el ícono de la app.')
    }
  } finally {
    changingIcon.value = false
  }
}

/**
 * Fija un acceso directo con el logo de la empresa.
 *
 * Android muestra su propio diálogo de confirmación y no garantiza avisar si el
 * usuario aceptó, así que el mensaje no afirma que ya quedó: sólo que la
 * petición se envió.
 */
async function onPinShortcut(): Promise<void> {
  if (pinningShortcut.value) return
  pinningShortcut.value = true
  try {
    const result = await pinCompanyShortcut(companyId.value, 'TekLive Rest')
    if (result === 'pinned') {
      toast.success('Confirma el acceso directo en el aviso de Android.')
    } else if (result === 'no-logo') {
      toast.error('La empresa aún no tiene un logo aprobado.')
    } else if (result === 'unavailable') {
      toast.error('Esta opción sólo está disponible en la app Android.')
    } else {
      toast.error('No se pudo crear el acceso directo.')
    }
  } finally {
    pinningShortcut.value = false
  }
}

</script>

<template>
  <div class="set">
    <!-- AppBar "Ajustes" (bg del scaffold, réplica settings.dart L11-14) -->
    <header class="set-appbar" data-testid="settings-appbar">
      <h1 class="set-appbar-title">Ajustes</h1>
    </header>

    <!-- ListView con ListTiles (L15-42 del original; solo impresora) -->
    <ul class="set-list" data-testid="settings-list">
      <li>
        <button type="button" class="set-tile" data-testid="settings-printer" @click="openPrinters">
          <Printer :size="24" class="set-tile-icon" aria-hidden="true" />
          <span class="set-tile-text">
            <span class="set-tile-title">Impresora de Tickets</span>
            <span class="set-tile-subtitle">Busca y configura tu impresora de red</span>
          </span>
        </button>
      </li>

      <!-- Diagnóstico del updater: versión instalada + chequeo manual. -->
      <li v-if="platform !== 'Web'">
        <button
          type="button"
          class="set-tile"
          data-testid="settings-updates"
          :disabled="checking"
          @click="onCheckUpdates"
        >
          <RefreshCw
            :size="24"
            class="set-tile-icon"
            :class="{ 'set-tile-icon--spin': checking }"
            aria-hidden="true"
          />
          <span class="set-tile-text">
            <span class="set-tile-title">Buscar actualizaciones</span>
            <span class="set-tile-subtitle">
              <template v-if="installedVersion">
                Versión instalada {{ installedVersion }}
              </template>
              <template v-else>Comprueba si hay una versión nueva</template>
            </span>
            <span v-if="checkResult" class="set-tile-note" data-testid="settings-updates-result">
              {{ checkResult }}
            </span>
          </span>
        </button>
      </li>

      <!-- Logo de empresa: se sube aquí y se refleja en web (favicon), desktop
           (ventana + accesos directos) y APK. Solo el admin de la empresa. -->
      <li v-if="canEditLogo">
        <div class="set-card" data-testid="settings-logo">
          <div class="set-card-head">
            <ImagePlus :size="24" class="set-tile-icon" aria-hidden="true" />
            <span class="set-tile-text">
              <span class="set-tile-title">Logo de la empresa</span>
              <span class="set-tile-subtitle">{{ logoStatusLabel }}</span>
            </span>
          </div>

          <div class="logo-row">
            <div class="logo-frame">
              <img
                v-if="logoPreviewUrl || (existingLogoSrc && !existingLogoFailed)"
                :src="logoPreviewUrl || existingLogoSrc"
                alt="Logo de la empresa"
                class="logo-thumb"
                @error="existingLogoFailed = true"
              />
              <span v-else class="logo-empty">Sin logo</span>
            </div>

            <div class="logo-actions">
              <input
                ref="logoFileInput"
                type="file"
                accept="image/*"
                class="logo-input"
                data-testid="settings-logo-input"
                @change="onLogoPick"
              />
              <button
                type="button"
                class="logo-btn logo-btn--ghost"
                @click="logoFileInput?.click()"
              >
                Elegir imagen
              </button>
              <button
                type="button"
                class="logo-btn logo-btn--primary"
                data-testid="settings-logo-upload"
                :disabled="logoFile == null || uploading"
                @click="onUploadLogo"
              >
                {{ uploading ? 'Subiendo…' : 'Subir logo' }}
              </button>
              <button
                v-if="logoFile"
                type="button"
                class="logo-btn logo-btn--ghost"
                @click="clearLogoPick"
              >
                Quitar
              </button>
            </div>
          </div>

          <p v-if="uploadError" class="logo-error" role="alert">{{ uploadError }}</p>
          <p class="logo-hint">
            PNG o JPG, hasta 4 MB. Se aplica al favicon de la web, al ícono de la
            ventana y a los accesos directos del escritorio.
          </p>
        </div>
      </li>

      <!-- Ícono de la app Android: sólo en el APK (RestIconPlugin). -->
      <li v-if="iconAvailable">
        <div class="set-card" data-testid="settings-icon">
          <div class="set-card-head">
            <Smartphone :size="24" class="set-tile-icon" aria-hidden="true" />
            <span class="set-tile-text">
              <span class="set-tile-title">Ícono de la app</span>
              <span class="set-tile-subtitle">
                Elige cómo se ve TekLive Rest en tu teléfono.
              </span>
            </span>
          </div>

          <div class="icon-grid" role="radiogroup" aria-label="Ícono de la app">
            <button
              v-for="preset in iconPresets"
              :key="preset.id"
              type="button"
              class="icon-option"
              :class="{ 'icon-option--active': preset.id === iconPreset }"
              role="radio"
              :aria-checked="preset.id === iconPreset"
              :disabled="changingIcon"
              :data-testid="`settings-icon-${preset.id}`"
              @click="onPickPreset(preset.id)"
            >
              <span class="icon-dot" :class="`icon-dot--${preset.id}`" aria-hidden="true">R</span>
              <span class="icon-option-label">{{ preset.label }}</span>
            </button>
          </div>

          <p class="logo-hint">
            Algunos lanzadores tardan unos segundos en reflejar el cambio.
          </p>

          <div class="icon-shortcut">
            <p class="icon-shortcut-text">
              También puedes poner el logo de tu empresa como acceso directo en
              la pantalla de inicio.
            </p>
            <button
              type="button"
              class="logo-btn logo-btn--ghost"
              data-testid="settings-icon-pin"
              :disabled="pinningShortcut"
              @click="onPinShortcut"
            >
              {{ pinningShortcut ? 'Creando…' : 'Añadir a inicio con mi logo' }}
            </button>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.set {
  display: flex;
  flex-direction: column;
  /* 100% (NO 100vh): vista hija del shell del POS; en movil el shell ya
     reserva padding-bottom del bottom-nav. Con 100vh los ultimos 64px
     (final del scroll) quedaban detras del nav fijo. */
  min-height: 100%;
  background: var(--bg); /* var(--bg) */
}

/* AppBar con bg del scaffold (Theme.of(context).scaffoldBackgroundColor).
   Ancho completo como las vistas hermanas del POS (Vender/Ordenes): centrar
   una columna de 800px deja el titulo flotando con vacios enormes a los
   lados en desktop. El padding controla el ancho real del contenido. */
.set-appbar {
  padding: 22px 24px 12px;
  background: var(--bg);
}

.set-appbar-title {
  margin: 0;
  font-size: var(--text-h1);
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text-1);
}

/* Lista a ancho completo (mismo eje que el appbar; el tile interno limita
   su propio ancho de lectura con max-width, patron .cash-state p) */
.set-list {
  width: 100%;
  padding: 0 24px 32px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Fila-card: superficie propia, icono-tile neutro, chevron de affordance.
   max-width de lectura: a ancho completo un tile de una linea se estira
   demasiado en desktop; 720px mantiene la proporcion del diseno. */
.set-tile {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  max-width: 720px;
  min-height: 64px;
  padding: 14px 16px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  font-family: var(--font);
  transition:
    border-color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

@media (hover: hover) {
  .set-tile:hover {
    border-color: var(--border);
    background: var(--surface-hover);
  }
}

.set-tile:active {
  transform: scale(0.995);
}

.set-tile-icon {
  flex: none;
  color: var(--text-2);
}

.set-tile-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.set-tile-title {
  color: var(--text-1);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.set-tile-subtitle {
  color: var(--text-3);
  font-size: var(--text-sm);
}

/* Nota del chequeo manual del updater (resultado legible bajo el subtítulo). */
.set-tile-note {
  color: var(--text-2);
  font-size: var(--text-sm);
  margin-top: 2px;
}

/* ===== Logo de empresa =================================================== */
.set-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 720px;
  padding: 14px 16px;
  background: var(--card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}

.set-card-head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.logo-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

/* Marco fijo: el logo no debe mover el layout cuando cambia de tamaño. */
.logo-frame {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  flex: none;
  background: var(--bg);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  overflow: hidden;
}

.logo-thumb {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.logo-empty {
  font-size: 10px;
  color: var(--text-3);
  text-align: center;
}

.logo-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* El input se dispara por botón: oculto pero accesible (no display:none). */
.logo-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.logo-btn {
  font-family: var(--font);
  font-size: var(--text-sm);
  font-weight: 600;
  padding: 8px 12px;
  border-radius: var(--radius);
  cursor: pointer;
  transition:
    background var(--dur) var(--ease),
    border-color var(--dur) var(--ease),
    opacity var(--dur) var(--ease);
}

.logo-btn--ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-1);
}

.logo-btn--ghost:hover {
  background: var(--surface-hover);
}

.logo-btn--primary {
  background: var(--primary);
  border: 1px solid var(--primary);
  color: var(--on-primary);
}

.logo-btn--primary:hover:not(:disabled) {
  background: var(--primary-hover);
}

.logo-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.logo-error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--error);
}

.logo-hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-3);
  line-height: 1.45;
}

/* --- Ícono de la app (sólo APK) ---------------------------------------- */

.icon-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.icon-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 6px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  font-family: var(--font);
  transition:
    border-color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

.icon-option:hover:not(:disabled) {
  background: var(--surface-hover);
}

.icon-option--active {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.icon-option:disabled {
  opacity: 0.6;
  cursor: default;
}

/* Miniatura del preset: replica el par fondo/letra del adaptive icon. */
.icon-dot {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 11px;
  font-size: 19px;
  font-weight: 800;
  line-height: 1;
}

.icon-dot--default {
  background: #2fbf71;
  color: #ffffff;
}

.icon-dot--dark {
  background: #111814;
  color: #2fbf71;
}

.icon-dot--light {
  background: #ffffff;
  color: #2fbf71;
  box-shadow: inset 0 0 0 1px var(--border);
}

.icon-dot--mono {
  background: #2fbf71;
  color: #111814;
}

.icon-option-label {
  font-size: var(--text-xs);
  color: var(--text-2);
  text-align: center;
  line-height: 1.2;
}

.icon-shortcut {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border-soft);
}

.icon-shortcut-text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-2);
  line-height: 1.45;
}

.set-tile:disabled {
  opacity: 0.7;
  cursor: progress;
}

.set-tile-icon--spin {
  animation: set-spin 1.1s linear infinite;
}

@keyframes set-spin {
  to {
    transform: rotate(360deg);
  }
}

.set-tile::after {
  content: '';
  flex: none;
  width: 7px;
  height: 7px;
  margin-left: 4px;
  border-right: 1.5px solid var(--text-3);
  border-bottom: 1.5px solid var(--text-3);
  transform: rotate(-45deg);
}

@media (max-width: 640px) {
  .set-appbar {
    padding: 18px 16px 10px;
  }

  .set-list {
    padding: 0 16px 24px;
  }
}
</style>
