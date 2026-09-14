import type { LlmModel } from "../../../lib/openai";

export function ModelSelector({
  models,
  value,
  onChange,
  disabled,
  onRefresh,
}: {
  models: LlmModel[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  onRefresh?: () => void;
}) {
  const options = models.some((m) => m.id === value) || !value
    ? models
    : [{ id: value }, ...models];

  return (
    <select
      class="w-full min-w-0 text-[11px] px-1.5 py-1 rounded-md border border-border-dim bg-surface-card text-fg-secondary"
      value={value}
      disabled={disabled || options.length === 0}
      title="Model"
      onFocus={() => onRefresh?.()}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
    >
      {options.length === 0 ? <option value={value || ""}>{value || "No models"}</option> : null}
      {options.map((m) => (
        <option key={m.id} value={m.id}>
          {m.id}
          {m.isDefault ? " (default)" : ""}
        </option>
      ))}
    </select>
  );
}
