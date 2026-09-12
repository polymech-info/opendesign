import * as fabric from "fabric";
import type { DesignDocument, DesignNode } from "../../design/types";
import { createTablerIconObject, type IconObject } from "./tabler-icons";

function readId(obj: fabric.FabricObject): string {
  return String((obj as { _id?: string })._id ?? "");
}

function iconFill(node: DesignNode): string | null {
  const raw = node.props.fill || node.props.color;
  return raw && raw.startsWith("#") ? raw : null;
}

/** Replace projected icon images with tinted SVG groups when IR has fill. */
export async function hydrateDesignIconFills(canvas: fabric.Canvas, doc: DesignDocument): Promise<void> {
  const byId = new Map(doc.nodes.filter((n) => n.type === "icon").map((n) => [n.id, n]));
  if (!byId.size) return;

  const jobs: Array<{ index: number; remove: fabric.FabricObject; node: DesignNode; fill: string }> = [];
  canvas.getObjects().forEach((obj, index) => {
    const node = byId.get(readId(obj));
    if (!node) return;
    const fill = iconFill(node);
    if (!fill) return;
    jobs.push({ index, remove: obj, node, fill });
  });

  for (const job of jobs) {
    const name = job.node.props.icon || (job.remove as IconObject)._iconName || "circle";
    const created = await createTablerIconObject(name, job.fill);
    if (!created) continue;

    const targetW = (job.remove.width ?? 24) * (job.remove.scaleX ?? 1);
    const targetH = (job.remove.height ?? 24) * (job.remove.scaleY ?? 1);
    const scale = Math.max(targetW, targetH) / Math.max(created.width ?? 24, created.height ?? 24, 1);

    created.set({
      left: job.remove.left ?? 0,
      top: job.remove.top ?? 0,
      scaleX: scale,
      scaleY: scale,
      angle: job.remove.angle ?? 0,
      opacity: job.remove.opacity ?? 1,
      originX: "left",
      originY: "top",
      ...(job.remove.shadow ? { shadow: job.remove.shadow } : {}),
    });
    if (job.remove.shadow) {
      created.objectCaching = false;
      created.dirty = true;
    }
    (created as fabric.FabricObject & { _id?: string })._id = job.node.id;

    canvas.remove(job.remove);
    canvas.insertAt(job.index, created);
  }
}
