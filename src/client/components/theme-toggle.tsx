import { Moon, Sun } from "lucide-preact";
import { useTheme } from "../lib/theme";

export function ThemeToggle({ class: className }: { class?: string }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      class={
        className ??
        "p-1.5 rounded-md text-fg-muted bg-transparent border-none cursor-pointer transition-all hover:bg-surface-hover hover:text-fg"
      }
      onClick={toggleTheme}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
