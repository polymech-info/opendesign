import { ChevronRight, Wrench } from "lucide-preact";
import type { ToolRunRecord } from "../types";

function formatJson(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function turnSummary(runs: ToolRunRecord[]): string {
  const names = [...new Set(runs.map((r) => r.name))];
  if (runs.length === 1) return runs[0].name;
  if (names.length === 1) return `${runs.length}× ${names[0]}`;
  return `${runs.length} tools`;
}

function resultOk(result: unknown): boolean {
  if (!result || typeof result !== "object") return true;
  return (result as Record<string, unknown>).ok !== false;
}

export function ToolCallsPanel({ runs }: { runs: ToolRunRecord[] }) {
  if (!runs.length) return null;

  return (
    <details class="mt-2 rounded-lg border border-amber-200/80 bg-amber-50/50 group">
      <summary
        class="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer list-none text-[10px] font-medium text-amber-900/90 select-none hover:bg-amber-100/40 rounded-lg [&::-webkit-details-marker]:hidden"
      >
        <ChevronRight
          size={11}
          class="shrink-0 text-amber-700/70 transition-transform group-open:rotate-90"
        />
        <Wrench size={10} class="shrink-0 text-amber-700/80" />
        <span>{turnSummary(runs)}</span>
      </summary>
      <div class="px-2 pb-2 pt-0.5 space-y-1.5 border-t border-amber-200/50">
        {runs.map((run, i) => (
          <div
            key={`${run.name}-${i}`}
            class="rounded-md border border-amber-200/60 bg-white/70 overflow-hidden"
          >
            <div
              class={`px-2 py-1 text-[10px] font-semibold font-mono border-b border-amber-100 ${
                resultOk(run.result) ? "text-amber-900" : "text-red-700"
              }`}
            >
              {run.name}
            </div>
            <div class="px-2 pb-2 space-y-1.5">
              <div>
                <div class="text-[9px] uppercase tracking-wide text-zinc-400 mt-1 mb-0.5">arguments</div>
                <pre class="m-0 p-1.5 rounded bg-zinc-50 border border-zinc-100 text-[9px] leading-snug text-zinc-700 overflow-x-auto max-h-28 overflow-y-auto whitespace-pre-wrap break-all">
                  {formatJson(run.arguments)}
                </pre>
              </div>
              <div>
                <div class="text-[9px] uppercase tracking-wide text-zinc-400 mb-0.5">result</div>
                <pre
                  class={`m-0 p-1.5 rounded border text-[9px] leading-snug overflow-x-auto max-h-36 overflow-y-auto whitespace-pre-wrap break-all ${
                    resultOk(run.result)
                      ? "bg-zinc-50 border-zinc-100 text-zinc-700"
                      : "bg-red-50 border-red-100 text-red-800"
                  }`}
                >
                  {formatJson(run.result)}
                </pre>
                {Array.isArray((run.result as { warnings?: unknown[] })?.warnings) &&
                (run.result as { warnings: Array<{ warning?: string }> }).warnings.length ? (
                  <ul class="m-1.5 p-0 list-none space-y-0.5 text-[9px] text-amber-800">
                    {(run.result as { warnings: Array<{ warning?: string }> }).warnings.map((w, wi) => (
                      <li key={wi}>{w.warning}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
