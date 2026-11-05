<script setup lang="ts">
/**
 * SettingsView · pantalla AJUSTES del rail (Fase 3 ronda 2).
 *
 * Réplica exacta de lib/screens/admin/settings.dart (SettingsAdming):
 * - Scaffold bg #212121, AppBar "Ajustes" con bg del scaffold.
 * - ListView con 2 ListTiles:
 *   1. Icons.add_box_outlined  → "Crear Nuevo Producto"
 *      subtitle "Añade productos con opciones dinámicas"
 *   2. Icons.print_outlined    → "Impresora de Tickets"
 *      subtitle "Busca y configura tu impresora de red"
 * - Las pantallas destino (CreateProductTemplateScreen / PrinterSettingsScreen)
 *   no existen en Rest aún (Fase 3c/3d) → toast informativo.
 */
import { PackagePlus, Printer } from 'lucide-vue-next'
import { useToastStore } from '../../stores/toast'

const toast = useToastStore()

function notAvailable(): void {
  toast.info('Disponible en Fase 3c/3d')
}
</script>

<template>
  <div class="set">
    <!-- AppBar "Ajustes" (bg del scaffold, réplica settings.dart L11-14) -->
    <header class="set-appbar" data-testid="settings-appbar">
      <h1 class="set-appbar-title">Ajustes</h1>
    </header>

    <!-- ListView con 2 ListTiles (L15-42) -->
    <ul class="set-list" data-testid="settings-list">
      <li>
        <button type="button" class="set-tile" data-testid="settings-new-product" @click="notAvailable">
          <PackagePlus :size="24" class="set-tile-icon" aria-hidden="true" />
          <span class="set-tile-text">
            <span class="set-tile-title">Crear Nuevo Producto</span>
            <span class="set-tile-subtitle">Añade productos con opciones dinámicas</span>
          </span>
        </button>
      </li>
      <li>
        <button type="button" class="set-tile" data-testid="settings-printer" @click="notAvailable">
          <Printer :size="24" class="set-tile-icon" aria-hidden="true" />
          <span class="set-tile-text">
            <span class="set-tile-title">Impresora de Tickets</span>
            <span class="set-tile-subtitle">Busca y configura tu impresora de red</span>
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.set {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg); /* #212121 */
}

/* AppBar con bg del scaffold (Theme.of(context).scaffoldBackgroundColor) */
.set-appbar {
  padding: 14px 16px;
  background: var(--bg);
}

.set-appbar-title {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
  color: var(--text);
}

/* ListTile M3: leading 24 + title/subtitle, tap completo */
.set-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.set-tile {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 16px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: var(--font);
  transition: background 0.15s ease;
}

.set-tile:hover {
  background: var(--card-overlay);
}

.set-tile-icon {
  color: var(--text);
  flex: none;
}

.set-tile-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.set-tile-title {
  color: var(--text);
  font-size: 16px;
}

.set-tile-subtitle {
  color: var(--text-muted);
  font-size: 14px;
}
</style>
