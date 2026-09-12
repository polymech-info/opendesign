import * as fabric from "fabric";

import { findNode, type DesignDocument } from "../../design/types";
import { readObjectId, walkCanvasObjects } from "./object-identity";
import { isIconObject } from "./tabler-icons";

/**
 * Translate an editor selection to IDs the Design DSL understands.
 * Fabric wrapper groups use generated IDs such as `group_1`; their children
 * point back to the stable `use` instance (for example `feature.chat`).
 */
export function designSelectionIds(
  selected: fabric.FabricObject | null | undefined,
  doc: DesignDocument,
): string[] {
  if (!selected) return [];
  const direct = readObjectId(selected);
  if (direct && findNode(doc, direct)) return [direct];
  if (!(selected instanceof fabric.Group) || isIconObject(selected)) return [];

  const childIds: string[] = [];
  walkCanvasObjects(selected, (obj) => {
    if (obj === selected) return;
    const id = readObjectId(obj);
    if (id && findNode(doc, id)) childIds.push(id);
  });
  const nodes = [...new Set(childIds)].map((id) => findNode(doc, id)).filter(Boolean);
  const parents = [...new Set(nodes.map((node) => node?.parentId).filter((id): id is string => !!id))];
  if (parents.length === 1 && findNode(doc, parents[0])?.type === "use") return parents;
  return [...new Set(childIds)];
}
