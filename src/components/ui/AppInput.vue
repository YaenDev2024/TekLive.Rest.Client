<script setup lang="ts">
/**
 * AppInput · campo de texto del design system CrazyWings.
 * Equivalente a InputDecorationTheme (main.dart): filled rgba(0,0,0,0.3),
 * label grey[400], radius 12, enabledBorder grey[700], focusedBorder
 * deepOrange, errorBorder redAccent 2px. prefixIcon vía slot (lucide).
 */
import { computed, useId } from 'vue'

interface Props {
  modelValue: string
  label?: string
  type?: 'text' | 'password' | 'number'
  placeholder?: string
  error?: string | null
  helperText?: string
  disabled?: boolean
  autocomplete?: string
  inputmode?: 'text' | 'numeric' | 'decimal'
  spellcheck?: boolean
  autofocus?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  label: undefined,
  type: 'text',
  placeholder: undefined,
  error: null,
  helperText: undefined,
  disabled: false,
  autocomplete: 'off',
  inputmode: undefined,
  spellcheck: undefined,
  autofocus: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const inputId = useId()
const errorId = useId()

const ariaInvalid = computed(() => (props.error != null ? 'true' : undefined))
const describedBy = computed(() => (props.error != null ? errorId : undefined))
</script>

<template>
  <div class="app-input" :class="{ 'app-input--error': error != null }">
    <label v-if="label" :for="inputId" class="app-input__label">{{ label }}</label>
    <div class="app-input__control">
      <span v-if="$slots.prefix" class="app-input__prefix" aria-hidden="true">
        <slot name="prefix" />
      </span>
      <input
        :id="inputId"
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :autocomplete="autocomplete"
        :inputmode="inputmode"
        :spellcheck="spellcheck"
        :autofocus="autofocus"
        :aria-invalid="ariaInvalid"
        :aria-describedby="describedBy"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <span v-if="$slots.suffix" class="app-input__suffix">
        <slot name="suffix" />
      </span>
    </div>
    <p v-if="error" :id="errorId" class="app-input__error" role="alert">{{ error }}</p>
    <p v-else-if="helperText" class="app-input__helper">{{ helperText }}</p>
  </div>
</template>

<style scoped>
.app-input {
  display: block;
}

.app-input__label {
  display: block;
  font-size: 0.9rem;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.app-input__control {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.app-input__control:focus-within {
  border-color: var(--primary);
}

.app-input--error .app-input__control {
  border-color: var(--error);
  border-width: 2px;
}

.app-input__control input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 13px 0;
  color: var(--text);
  font-family: var(--font);
  font-size: 1rem;
}

.app-input__control input:focus {
  outline: none;
}

.app-input__control input::placeholder {
  color: var(--text-faint);
}

.app-input__control input:disabled {
  opacity: 0.6;
}

.app-input__prefix,
.app-input__suffix {
  display: inline-flex;
  align-items: center;
  color: var(--text-muted);
}

.app-input__suffix button {
  display: inline-flex;
  align-items: center;
  background: none;
  border: 0;
  padding: 4px;
  color: var(--text-muted);
  cursor: pointer;
}

.app-input__suffix button:hover {
  color: var(--text);
}

.app-input__helper {
  margin: 5px 0 0;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.7);
}

.app-input__error {
  margin: 5px 0 0;
  font-size: 0.8rem;
  color: var(--error);
}
</style>
