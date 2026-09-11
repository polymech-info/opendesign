import { render } from "preact";
import { App } from "./app";
import "./styles.css";

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

render(<App />, document.getElementById("app")!);
