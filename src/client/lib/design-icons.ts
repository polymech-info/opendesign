import * as fabric from "fabric";
import type { DesignDocument, DesignNode } from "../../design/types";
import { walkCanvasObjects } from "./object-identity";
import { createTablerIconObject, type IconObject } from "./tabler-icons";

function readId(obj: fabric.FabricObject): string {
  return String((obj as { _id?: string })._id ?? "");
}

function iconFill(node: DesignNode): string | null {
  const raw = node.props.fill || node.props.color;
  return raw && raw.startsWith("#") ? raw : null;
}

function iconName(node: DesignNode, obj: fabric.FabricObject): string {
  return node.props.icon || (obj as IconObject)._iconName || "circle";
}

function replaceCanvasObject(
  canvas: fabric.StaticCanvas | fabric.Canvas,
  remove: fabric.FabricObject,
  created: fabric.FabricObject,
) {
  const parent = remove.group;
  if (parent && !(parent instanceof fabric.ActiveSelection)) {
    const idx = parent.getObjects().indexOf(remove);
    parent.remove(remove);
    if (typeof parent.insertAt === "function" && idx >= 0) parent.insertAt(idx, created);
    else parent.add(created);
    parent.dirty = true;
    parent.setCoords();
    return;
  }
  const index = canvas.getObjects().indexOf(remove);
  canvas.remove(remove);
  if (index >= 0 && typeof canvas.insertAt === "function") canvas.insertAt(index, created);
  else canvas.add(created);
}

/** Replace projected icon images with tinted SVG groups when IR has fill or a new glyph. */
export async function hydrateDesignIconFills(
  canvas: fabric.StaticCanvas | fabric.Canvas,
  doc: DesignDocument,
): Promise<void> {
  const byId = new Map(doc.nodes.filter((n) => n.type === "icon").map((n) => [n.id, n]));
  if (!byId.size) return;

  const jobs: Array<{ remove: fabric.FabricObject; node: DesignNode; fill: string; name: string }> = [];
  walkCanvasObjects(canvas, (obj) => {
    const node = byId.get(readId(obj));
    if (!node) return;
    const fill = iconFill(node);
    const name = iconName(node, obj);
    const current = (obj as IconObject)._iconName;
    if (!fill && (!name || name === current)) return;
    jobs.push({ remove: obj, node, fill: fill ?? "#6366f1", name });
  });

  for (const job of jobs) {
    const created = await createTablerIconObject(job.name, job.fill);
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

    replaceCanvasObject(canvas, job.remove, created);
  }
}
