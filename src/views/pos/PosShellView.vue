<script setup lang="ts">
/**
 * PosShellView · shell del POS desktop (Fase 3 ronda 2 — réplica Flutter).
 *
 * Layout raíz de CrazyWings desktop (desktop_home_layout.dart):
 *   Row [ DesktopNavRail(80px fijo), Expanded(vista activa) ]
 *
 * DEMO multiplataforma (beta): en PHONE (<700px) el rail desaparece y se
 * replica el MobileHomeLayout (mobile_home_layout.dart L16-47):
 * BottomNavigationBar fixed de 4 items — Vender/Órdenes/Caja/Ajustes,
 * BottomNavigationBarType.fixed, bg cardTheme (#303030), item activo
 * deepOrange (theme.colorScheme.primary), inactivo onSurface 70%.
 * Los .dart usan point_of_sale(_outlined)/receipt_long(_outlined)/
 * account_balance_wallet(_outlined)/settings(_outlined) — aquí sus
 * equivalentes lucide (Store/ReceiptText/Wallet/Settings).
 * Los índices del original difieren del rail desktop (el mobile usa
 * 0=Vender,1=Ordenes,2=Caja,3=Ajustes) — se respeta el orden del .dart.
 * - Roles (L24-29): Administrador/RestAdmin → {0,1,2,3}; CAJERO → {0,1,3}.
 *   Click sin permiso → toast "Acceso denegado para tu rol" (SnackBar).
 * - Trailing: logout (L74-87): clearSession → /login.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { LogOut, ReceiptText, Settings, Store, Wallet } from 'lucide-vue-next'
import { clearSession, session } from '../../services/auth'
import { useToastStore } from '../../stores/toast'

const router = useRouter()
const toast = useToastStore()

/** Umbral phone: coincide con el CSS <700px del bottom nav. */
const PHONE_MAX = 700
const isPhone = ref(false)
let mq: MediaQueryList | null = null
function onMqChange(e: MediaQueryListEvent | MediaQueryList): void {
  isPhone.value = e.matches
}

onMounted(() => {
  mq = matchMedia(`(max-width: ${PHONE_MAX - 1}px)`)
  isPhone.value = mq.matches
  mq.addEventListener('change', onMqChange)
})

onBeforeUnmount(() => {
  mq?.removeEventListener('change', onMqChange)
  mq = null
})

/** Índice activo según la ruta (0 Vender · 1 Órdenes · 2 Ajustes · 3 Caja). */
const selectedIndex = computed<number>(() => {
  switch (router.currentRoute.value.name) {
    case 'pos-piso1':
      return 0
    case 'pos-ordenes':
      return 1
    case 'pos-ajustes':
      return 2
    case 'pos-caja':
      return 3
    default:
      return 0
  }
})

/** Índice MOBILE según el BottomNavigationBar del original: 0=Vender,
 * 1=Ordenes, 2=Caja, 3=Ajustes (orden del .dart, distinto del rail). */
const mobileIndex = computed<number>(() => {
  switch (router.currentRoute.value.name) {
    case 'pos-piso1':
      return 0
    case 'pos-ordenes':
      return 1
    case 'pos-caja':
      return 2
    case 'pos-ajustes':
      return 3
    default:
      return 0
  }
})

/** Réplica L24-29: destinos permitidos por rol (RestAdmin = Administrador). */
const allowed = computed<Set<number>>(() => {
  const role = (session.role ?? '').toUpperCase()
  if (role === 'ADMINISTRADOR' || role === 'RESTADMIN') {
    return new Set([0, 1, 2, 3])
  }
  if (role === 'CAJERO' || role === 'RESTCASHIER') {
    return new Set([0, 1, 3])
  }
  return new Set<number>()
})

interface RailDestination {
  index: number
  label: string
  icon: typeof Store
  to: { name: string }
  testid: string
}

const destinations: RailDestination[] = [
  { index: 0, label: 'Vender', icon: Store, to: { name: 'pos-piso1' }, testid: 'rail-vender' },
  { index: 1, label: 'Órdenes', icon: ReceiptText, to: { name: 'pos-ordenes' }, testid: 'rail-ordenes' },
  { index: 2, label: 'Ajustes', icon: Settings, to: { name: 'pos-ajustes' }, testid: 'rail-ajustes' },
  { index: 3, label: 'Caja', icon: Wallet, to: { name: 'pos-caja' }, testid: 'rail-caja' },
]

/** Ítems del BottomNavigationBar móvil (orden EXACTO del .dart L25-46). */
const mobileDestinations: RailDestination[] = [
  { index: 0, label: 'Vender', icon: Store, to: { name: 'pos-piso1' }, testid: 'bottom-vender' },
  { index: 1, label: 'Órdenes', icon: ReceiptText, to: { name: 'pos-ordenes' }, testid: 'bottom-ordenes' },
  { index: 2, label: 'Caja', icon: Wallet, to: { name: 'pos-caja' }, testid: 'bottom-caja' },
  { index: 3, label: 'Ajustes', icon: Settings, to: { name: 'pos-ajustes' }, testid: 'bottom-ajustes' },
]

function onDestination(dest: RailDestination): void {
  if (!allowed.value.has(dest.index)) {
    // Réplica SnackBar L52-56.
    toast.error('Acceso denegado para tu rol')
    return
  }
  void router.push(dest.to)
}

/** Réplica trailing L74-87: cierra sesión → login. */
async function logout(): Promise<void> {
  clearSession()
  await router.push({ name: 'login' })
}
</script>

<template>
  <div class="pos-shell" :class="{ 'pos-shell--phone': isPhone }">
    <!-- ================= DESKTOP NAV RAIL (80px, oculto <700px) ================= -->
    <nav class="rail" data-testid="nav-rail" aria-label="Navegación del POS">
      <!-- Leading: logo (desktop_nav_rail.dart L63-66, height 40, vpadding 20) -->
      <RouterLink to="/home" class="rail-leading" aria-label="Ir al inicio">
        <img src="/logoWText.png" alt="Crazy Wings" class="rail-logo" />
      </RouterLink>

      <!-- Destinos (labelType.all: icono 24 + label 12 siempre) -->
      <div class="rail-destinations">
        <button
          v-for="dest in destinations"
          :key="dest.index"
          type="button"
          class="rail-dest"
          :class="{ 'rail-dest--active': selectedIndex === dest.index }"
          :data-testid="dest.testid"
          :aria-current="selectedIndex === dest.index ? 'page' : undefined"
          @click="onDestination(dest)"
        >
          <span class="rail-pill">
            <component :is="dest.icon" :size="24" class="rail-icon" aria-hidden="true" />
          </span>
          <span class="rail-label">{{ dest.label }}</span>
        </button>
      </div>

      <!-- Trailing: logout (L68-91, margin-top auto, padding-bottom 20) -->
      <div class="rail-trailing">
        <button
          type="button"
          class="rail-logout"
          data-testid="rail-logout"
          title="Cerrar Sesión"
          aria-label="Cerrar Sesión"
          @click="logout"
        >
          <LogOut :size="22" aria-hidden="true" />
        </button>
      </div>
    </nav>

    <!-- Vista activa: piso1 / ordenes / ajustes / caja (estado persistente) -->
    <div class="pos-shell-view">
      <RouterView />
    </div>

    <!-- ============ BOTTOM NAV PHONE (mobile_home_layout.dart L16-47) ============ -->
    <nav
      v-if="isPhone"
      class="bottom-nav"
      data-testid="bottom-nav"
      aria-label="Navegación móvil del POS"
    >
      <button
        v-for="dest in mobileDestinations"
        :key="dest.index"
        type="button"
        class="bottom-nav__item"
        :class="{ 'bottom-nav__item--active': mobileIndex === dest.index }"
        :data-testid="dest.testid"
        :aria-current="mobileIndex === dest.index ? 'page' : undefined"
        @click="onDestination(dest)"
      >
        <component :is="dest.icon" :size="24" class="bottom-nav__icon" aria-hidden="true" />
        <span class="bottom-nav__label">{{ dest.label }}</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.pos-shell {
  display: flex;
  flex-direction: row;
  height: 100vh;
  background: var(--bg);
  overflow: hidden;
}

/* Vista activa: llena todo el ancho restante junto al rail (Expanded en Flutter) */
.pos-shell-view {
  flex: 1 1 0%;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* PHONE: deja espacio para el bottom nav fijo (SafeArea réplica) */
@media (max-width: 699px) {
  .pos-shell-view {
    height: auto;
    padding-bottom: calc(64px + env(safe-area-inset-bottom, 0px));
  }
}

/* ================= BOTTOM NAV PHONE (mobile_home_layout.dart L16-47) ======
   BottomNavigationBar type.fixed: bg cardTheme (#303030), item activo
   deepOrange, inactivo onSurface 70%. Fijado abajo, safe-area iOS/notch. */
.bottom-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  display: flex;
  align-items: stretch;
  background: #303030; /* theme.cardTheme.color */
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  height: calc(64px + env(safe-area-inset-bottom, 0px));
}

.bottom-nav__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: var(--font);
  -webkit-tap-highlight-color: transparent;
}

.bottom-nav__icon {
  color: rgba(255, 255, 255, 0.7); /* onSurface .7 */
  transition: color 0.15s ease;
}

.bottom-nav__label {
  font-size: 12px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.7);
  transition: color 0.15s ease;
}

.bottom-nav__item--active .bottom-nav__icon,
.bottom-nav__item--active .bottom-nav__label {
  color: var(--primary); /* selectedItemColor deepOrange */
}

/* Leading: logo 40px con padding vertical 20 */
.rail-leading {
  padding: 20px 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rail-logo {
  height: 40px;
  width: auto;
  object-fit: contain;
}

.rail-destinations {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

/* Destino: pill 56×32 radius 16 + label 12 debajo (labelType.all) */
.rail-dest {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 0;
  margin: 0 auto;
  width: 80px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: var(--font);
}

/* Pill M3: 56×32 detrás del icono, transparente si no está seleccionado */
.rail-pill {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 32px;
  border-radius: 16px;
  background: transparent;
  transition: background 0.15s ease;
}

.rail-dest:hover .rail-pill {
  background: rgba(255, 255, 255, 0.08);
}

.rail-dest--active .rail-pill {
  background: var(--primary); /* deepOrange #FF5722 */
}

.rail-icon {
  color: var(--text-faint); /* unselected: gris onSurfaceVariant */
  transition: color 0.15s ease;
}

.rail-dest:hover .rail-icon {
  color: var(--text);
}

.rail-dest--active .rail-icon {
  color: var(--on-primary); /* selected: blanco sobre pill */
}

.rail-label {
  font-size: 12px;
  line-height: 1;
  color: var(--text-faint);
  transition: color 0.15s ease;
}

.rail-dest--active .rail-label {
  color: var(--text);
}

/* Trailing: logout al fondo */
.rail-trailing {
  margin-top: auto;
  padding-bottom: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* PHONE: el rail entero se oculta (solo queda el bottom nav) */
@media (max-width: 699px) {
  .rail {
    display: none;
  }
}

.rail-logout {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}

.rail-logout:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.08);
}
</style>
