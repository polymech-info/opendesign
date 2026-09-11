import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

export function devPortFile(pkgRoot: string) {
  const id = createHash("sha1").update(pkgRoot).digest("hex").slice(0, 8);
  return path.join(os.tmpdir(), `opend-dev-${id}.json`);
}
