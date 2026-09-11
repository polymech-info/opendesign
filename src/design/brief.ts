import { serializeDsl } from "./serialize";
import type { DesignDocument } from "./types";

/** One-line tool card. Schemas stay on the host — --serve ignores client tools[]. */
export function designToolHints(): string {
  return [
    "design_query query=\"type=txt role=title\"",
    "design_get ids=[\"feature.search\"] include_children=true",
    "design_update where=id=feature.search.title set={\"text\":\"Audio Player\"}",
    "design_update patches=[{id,set}] or layout={type:\"column\",gap,area}",
    "design_create objects=[{type,id,x,y,w,h,text}]",
    "design_use_widget widget id x y bindings={icon,title,caption,body}",
    "design_search_icons query=\"audio\" source=local|iconify|all — then set icon to a hit id",
    "design_delete where=id=feature.search — deletes widget instance + children (use ids)",
    "design_export format=dsl|json",
  ].join("\n");
}

export type DesignBriefOpts = {
  selectionIds?: string[];
};

/**
 * Single chat context block: tools + live DSL + selection.
 * Not a second inject stack — this *is* the scene the agent should edit.
 */
export function designChatBrief(doc: DesignDocument, opts?: DesignBriefOpts): string {
  const selection = (opts?.selectionIds ?? []).map((id) => id.trim()).filter(Boolean);
  return [
    "You are editing a live OpenDesign canvas. The source is the Design DSL below — not workspace files, screenshots, or JPEGs.",
    "Do not use file/image/MCP editors. Emit JSON tool calls; the host runs them and redraws the canvas.",
    '{"name":"design_update","arguments":{"where":"id=feature.search.title","set":{"text":"Audio Player"}}}',
    'Several: {"tool_calls":[{"name":"...","arguments":{...}}]}',
    "TOOLS:",
    designToolHints(),
    selection.length ? `SELECTION: ${selection.join(", ")}` : "SELECTION: none",
    "SCENE:",
    serializeDsl(doc).trimEnd(),
  ].join("\n");
}
