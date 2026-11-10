<script setup lang="ts">
/**
 * ScopeSelector · réplica EXACTA de lib/widgets/admin/scope_selector.dart
 * (CrazyWings) — widget compartido para elegir el alcance de items de
 * catálogo admin: 'GLOBAL' | 'SUCURSAL' | 'PLANT' (doc L6-11).
 *
 * Estructura replicada:
 * - Dropdown 'Alcance' (L88-112): opciones 'Global' / 'Sucursal actual' /
 *   'Piso específico'; filled grey[900] (fillColor del scope_selector.dart
 *   L93, #212121 = var(--bg) — distinto del fill negro-alpha del resto de
 *   inputs; desviación 0: es fiel al original).
 * - 'Sucursal actual: N' (L114): constante POS_SUCURSAL_ID de
 *   stores/catalog.ts (el Flutter lee auth.selectedSucursalId).
 * - Dropdown 'Piso' (L117-138) SOLO cuando scopeType === 'PLANT'
 *   (L115): label '{name} (#{id})', pisos de getFloors() (aquí el store
 *   floors, réplica de FloorProvider). Carga perezosa una vez: réplica del
 *   addPostFrameCallback L49-56 (si el provider ya tiene pisos no re-pide).
 * - Hint bajo el dropdown de piso (L139-150): 'Cargando pisos...' /
 *   'No hay pisos disponibles para esta sucursal' / 'Selecciona un piso'
 *   en rojo 12px.
 * - Al cambiar de alcance se limpia plantId si != PLANT (L107) y se notifica
 *   con plantId null salvo PLANT (_notify L71-76).
 *
 * v-model: { scopeType, plantId } (update:modelValue en cada cambio).
 */
import { computed, onMounted, ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { useFloorsStore } from '../../stores/floors'
import { POS_SUCURSAL_ID } from '../../stores/catalog'
import type { CatalogScopeType } from '../../api/rest'

export interface ScopeValue {
  scopeType: CatalogScopeType
  plantId: number | null
}

const model = defineModel<ScopeValue>({ required: true })

const emit = defineEmits<{ change: [scopeType: CatalogScopeType, plantId: number | null] }>()

const floorsStore = useFloorsStore()

const SCOPE_OPTIONS: Array<{ value: CatalogScopeType; label: string }> = [
  { value: 'GLOBAL', label: 'Global' },
  { value: 'SUCURSAL', label: 'Sucursal actual' },
  { value: 'PLANT', label: 'Piso específico' },
]

/** Carga perezosa de pisos (réplica addPostFrameCallback L49-56): una vez. */
const floorsRequested = ref(false)

onMounted(() => {
  if (floorsRequested.value) return
  floorsRequested.value = true
  if (floorsStore.floors.length > 0) return
  void floorsStore.fetchFloors()
})

const showPlantDropdown = computed(() => model.value.scopeType === 'PLANT')

const hasNoFloors = computed(
  () => floorsStore.floors.length === 0 && !floorsStore.loading,
)

/**
 * Réplica _notify (L71-76): plantId solo cuenta con scopeType PLANT.
 * Emite update:modelValue + change (el original llama onChanged).
 */
function notify(): void {
  const plantId = model.value.scopeType === 'PLANT' ? model.value.plantId : null
  model.value = { scopeType: model.value.scopeType, plantId }
  emit('change', model.value.scopeType, plantId)
}

function onScopeChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as CatalogScopeType
  // Réplica L105-108: al cambiar de alcance se limpia plantId si != PLANT.
  model.value = {
    scopeType: value,
    plantId: value === 'PLANT' ? model.value.plantId : null,
  }
  notify()
}

function onPlantChange(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  model.value = { ...model.value, plantId: raw === '' ? null : Number(raw) }
  notify()
}
</script>

<template>
  <div class="scope" :data-testid="`scope-${model.scopeType.toLowerCase()}`">
    <!-- Dropdown Alcance (L88-112): filled grey[900], label 'Alcance' -->
    <div class="scope-field">
      <label class="scope-label" for="scope-type">Alcance</label>
      <div class="scope-select-wrap">
        <select
          id="scope-type"
          class="scope-select"
          :value="model.scopeType"
          aria-label="Alcance"
          data-testid="scope-type"
          @change="onScopeChange"
        >
          <option v-for="opt in SCOPE_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
        <ChevronDown :size="18" class="scope-caret" aria-hidden="true" />
      </div>
    </div>

    <!-- 'Sucursal actual: N' (L114) — constante POS_SUCURSAL_ID -->
    <p class="scope-sucursal" data-testid="scope-sucursal">
      Sucursal actual: {{ POS_SUCURSAL_ID }}
    </p>

    <!-- Dropdown Piso SOLO en PLANT (L115-151) -->
    <template v-if="showPlantDropdown">
      <div class="scope-field">
        <label class="scope-label" for="scope-plant">Piso</label>
        <div class="scope-select-wrap">
          <select
            id="scope-plant"
            class="scope-select"
            :value="model.plantId ?? ''"
            aria-label="Piso"
            data-testid="scope-plant"
            @change="onPlantChange"
          >
            <option :value="''" disabled>Selecciona un piso</option>
            <option v-for="f in floorsStore.floors" :key="f.floorId" :value="f.floorId">
              {{ f.name }} (#{{ f.floorId }})
            </option>
          </select>
          <ChevronDown :size="18" class="scope-caret" aria-hidden="true" />
        </div>
        <!-- Hint rojo 12px (L139-150) -->
        <p v-if="model.plantId == null" class="scope-plant-hint" data-testid="scope-plant-hint">
          {{
            floorsStore.loading
              ? 'Cargando pisos...'
              : hasNoFloors
                ? 'No hay pisos disponibles para esta sucursal'
                : 'Selecciona un piso'
          }}
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.scope {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px; /* SizedBox(height: 8) entre campos (L113/L116) */
}

.scope-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* labelText del InputDecoration Flutter: labelStyle grey[400] (main L114) */
.scope-label {
  font-size: 12px;
  color: var(--text-faint);
}

.scope-select-wrap {
  position: relative;
}

/* DropdownButtonFormField: filled grey[900] (#212121 → var(--bg)), outline
   grey[700] radius 12 (main.dart L117-119), texto blanco 15px */
.scope-select {
  width: 100%;
  height: 44px;
  padding: 0 36px 0 12px;
  appearance: none;
  background: var(--bg); /* fillColor Colors.grey[900] (L94) */
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  outline: none;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.scope-select:focus {
  border-color: var(--primary); /* focusedBorder deepOrange (main L121-125) */
}

.scope-select option {
  background: var(--bg-surface); /* dropdownColor del tema oscuro */
  color: var(--text);
}

/* Caret custom (el original dibuja la flecha del DropdownButton) */
.scope-caret {
  position: absolute;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  color: var(--text-faint);
  pointer-events: none;
}

/* 'Sucursal actual: N' (L114): texto del cuerpo, blanco normal */
.scope-sucursal {
  margin: 0;
  font-size: 14px;
  color: var(--text);
}

/* Hint rojo 12px bajo el dropdown de piso (L139-150) */
.scope-plant-hint {
  margin: 0;
  font-size: 12px;
  color: var(--error);
}
</style>
