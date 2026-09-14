import { render } from "preact";
import { AppRouter } from "./router";
import { applyTheme, readTheme } from "./lib/theme";
import "./styles.css";

applyTheme(readTheme());

// Sidebar width animation + canvas fit-scale can notify ResizeObserver in the
// same frame. Browsers report that as an error; Rspack's overlay treats it as fatal.
window.addEventListener(
  "error",
  (e) => {
    if (String(e.message || "").includes("ResizeObserver loop")) {
      e.stopImmediatePropagation();
    }
  },
  true,
);

render(<AppRouter />, document.getElementById("app")!);
