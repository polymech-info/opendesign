import { useEffect, useState } from "preact/hooks";
import { formatDesignLength, parseDesignLength, type MeasureUnit } from "../lib/canvas-rulers";

export function DesignLengthInput({
  value,
  unit,
  span,
  label,
  title,
  className,
  onCommit,
}: {
  value: number;
  unit: MeasureUnit;
  span: number;
  label: string;
  title?: string;
  className: string;
  onCommit: (px: number) => void;
}) {
  const text = formatDesignLength(value, unit, span);
  const [draft, setDraft] = useState(text);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(text);
  }, [text, focused]);
  const commit = (raw: string) => {
    setFocused(false);
    const next = parseDesignLength(raw, unit, span);
    if (next == null) {
      setDraft(text);
      return;
    }
    onCommit(next);
    setDraft(formatDesignLength(next, unit, span));
  };
  return (
    <label class="inline-flex items-center gap-1 min-w-0" title={title}>
      <span class="text-[11px] text-fg-muted shrink-0">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        class={className}
        value={draft}
        onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
        onFocus={(e) => {
          setFocused(true);
          (e.target as HTMLInputElement).select();
        }}
        onBlur={(e) => commit((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          if (e.key === "Escape") {
            const input = e.currentTarget as HTMLInputElement;
            input.value = text;
            setDraft(text);
            input.blur();
          }
        }}
      />
    </label>
  );
}
