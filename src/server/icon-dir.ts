import fs from "node:fs";
import path from "node:path";

export function resolveIconDir(here: string, pkgRoot: string) {
  const candidates = [
    path.join(here, "tabler-icons"),
    path.join(pkgRoot, "dist/tabler-icons"),
    path.resolve(pkgRoot, "../../packages/tabler-icons/icons/filled"),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0];
}
