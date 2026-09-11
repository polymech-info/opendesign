import fs from "node:fs";
import path from "node:path";

function exists(file: string) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

/** Chrome or Edge on the machine — used to run Fabric in a real browser. */
export function findHeadlessBrowser(): string | null {
  const extra = process.env.OPEND_BROWSER;
  if (extra && exists(extra)) return extra;

  const winRoots = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA,
  ].filter((v): v is string => !!v);

  const candidates =
    process.platform === "win32"
      ? winRoots.flatMap((root) => [
          path.join(root, "Microsoft/Edge/Application/msedge.exe"),
          path.join(root, "Google/Chrome/Application/chrome.exe"),
        ])
      : process.platform === "darwin"
        ? [
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : [
            "/usr/bin/microsoft-edge",
            "/usr/bin/microsoft-edge-stable",
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
          ];

  return candidates.find(exists) ?? null;
}
