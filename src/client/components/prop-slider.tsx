import { useEffect, useRef, useState } from "preact/hooks";

export type PropSliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  /** Show value * scale in the editor (e.g. 100 for 0–1 → percent). */
  displayScale?: number;
  onChange: (value: number) => void;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function decimalsFor(step: number) {
  if (step >= 1) return 0;
  const s = step.toString();
  const i = s.indexOf(".");
  return i < 0 ? 2 : Math.min(4, s.length - i - 1);
}

function formatShown(value: number, step: number, scale: number) {
  const shown = value * scale;
  const d = decimalsFor(step * scale);
  return d === 0 ? String(Math.round(shown)) : shown.toFixed(d);
}

function parseShown(raw: string, scale: number) {
  const n = Number(String(raw).trim().replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return n / scale;
}

function tickSize(min: number, max: number, step: number) {
  const span = Math.abs(max - min);
  const fromMax = Math.abs(max) / 100;
  return Math.max(step, fromMax > 0 ? fromMax : span / 100);
}

export function PropSlider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  disabled,
  displayScale = 1,
  onChange,
}: PropSliderProps) {
  const focused = useRef(false);
  const [draft, setDraft] = useState(() => formatShown(value, step, displayScale));
  const pct = max === min ? 0 : ((clamp(value, min, max) - min) / (max - min)) * 100;

  useEffect(() => {
    if (!focused.current) setDraft(formatShown(value, step, displayScale));
  }, [value, step, displayScale]);

  const commitDraft = () => {
    const parsed = parseShown(draft, displayScale);
    if (parsed == null) {
      setDraft(formatShown(value, step, displayScale));
      return;
    }
    const next = clamp(parsed, min, max);
    setDraft(formatShown(next, step, displayScale));
    if (Math.abs(next - value) > 1e-6) onChange(next);
  };

  const nudge = (dir: number) => {
    const unit = tickSize(min, max, step);
    const next = clamp(value + dir * unit, min, max);
    onChange(next);
    setDraft(formatShown(next, step, displayScale));
  };

  return (
    <div
      class={`prop-slider ${disabled ? "opacity-40 pointer-events-none" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div class="flex items-center gap-2">
        <label class="text-[11px] text-fg-muted shrink-0 min-w-[4.5rem]">{label}</label>
        <div class="relative flex-1 h-6">
          <div class="absolute left-[7px] right-[7px] top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-surface-hover overflow-hidden pointer-events-none">
            <div class="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            class="prop-slider-range"
            value={clamp(value, min, max)}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onInput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))}
          />
        </div>
        <input
          type="text"
          inputMode="decimal"
          disabled={disabled}
          class="w-12 shrink-0 bg-surface-card border border-border-dim rounded px-1 py-0.5 text-[11px] leading-4 text-fg-secondary font-mono text-right outline-none focus:border-accent"
          value={draft}
          aria-label={label}
          onFocus={() => {
            focused.current = true;
          }}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          onBlur={() => {
            focused.current = false;
            commitDraft();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(formatShown(value, step, displayScale));
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              nudge(e.key === "ArrowUp" ? (e.shiftKey ? 10 : 1) : e.shiftKey ? -10 : -1);
            }
          }}
        />
        {suffix ? <span class="text-[10px] text-fg-muted -ml-1">{suffix}</span> : null}
      </div>
    </div>
  );
}
