import { useState } from "preact/hooks";
import {
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize,
  Download,
  FileJson,
  Copy,
  ClipboardCopy,
  Camera,
  Save,
  ChevronDown,
  Home,
  Group as GroupIcon,
  Ungroup as UngroupIcon,
  Library,
  PanelLeft,
  PanelRight,
  BringToFront,
  SendToBack,
} from "lucide-preact";
import { useEditor, CANVAS_SIZES } from "../context";
import { isElementGroup } from "../lib/element-group";
import { selectedCanvasObjects } from "../lib/object-style";
import { stackTargetsFromSelection } from "../lib/layer-stack";
import { saveAppScreenshot } from "../lib/capture-app";

function panelBtnClass(open: boolean) {
  return `p-1.5 rounded-md border-none cursor-pointer transition-all ${
    open
      ? "text-zinc-900 bg-zinc-100 hover:bg-zinc-200"
      : "text-zinc-400 bg-transparent hover:bg-zinc-100 hover:text-zinc-900"
  }`;
}

export function Toolbar({
  leftPanelOpen,
  rightPanelOpen,
  onToggleLeftPanel,
  onToggleRightPanel,
}: {
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
}) {
  const {
    canvasWidth,
    canvasHeight,
    setCanvasSize,
    undo,
    redo,
    canUndo,
    canRedo,
    zoom,
    fitScale,
    zoomToFit,
    zoomIn,
    zoomOut,
    exportPNG,
    copyDesignToClipboard,
    flashNotice,
    getCanvasJSONForPage,
    pages,
    saveDesign,
    duplicateDesign,
    saving,
    diskNotice,
    activeVersionRev,
    activeDesign,
    renameDesign,
    navigate,
    canvas,
    selectedObject,
    selectionEpoch,
    groupSelected,
    ungroupSelected,
    saveSelectionAsElement,
    bringSelectionToFront,
    sendSelectionToBack,
  } = useEditor();
  void selectionEpoch;

  const selectedCount = selectedCanvasObjects(canvas, selectedObject).length;
  const activeIsGroup = isElementGroup(canvas?.getActiveObject() ?? null);
  const canGroup = selectedCount >= 2;
  const canUngroup = activeIsGroup;
  const canSaveElement = selectedCount >= 1 || activeIsGroup || !!selectedObject;
  const canRestack = !!stackTargetsFromSelection(canvas, selectedObject);

  const [showSizeDropdown, setShowSizeDropdown] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [capturingApp, setCapturingApp] = useState(false);

  const currentSize = CANVAS_SIZES.find(
    (s) => s.width === canvasWidth && s.height === canvasHeight
  );
  const sizeLabel = currentSize ? currentSize.label : `${canvasWidth} x ${canvasHeight}`;

  const startRename = () => {
    if (!activeDesign) return;
    setNameValue(activeDesign.name);
    setEditingName(true);
  };

  const finishRename = () => {
    if (activeDesign && nameValue.trim()) {
      renameDesign(activeDesign.id, nameValue.trim());
    }
    setEditingName(false);
  };

  const exportJSON = () => {
    const parse = (raw: string) => {
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    };
    const payload = {
      name: activeDesign?.name ?? "untitled",
      width: canvasWidth,
      height: canvasHeight,
      pages: pages.map((p) => {
        const live = getCanvasJSONForPage(p.id);
        const raw = live && live !== "{}" ? live : p.canvas_json || "{}";
        return {
          id: p.id,
          title: p.title,
          sort_order: p.sort_order,
          canvas_json: parse(raw),
        };
      }),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    const slug = (activeDesign?.name ?? "design")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "design";
    link.download = `${slug}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div class="flex items-center justify-between px-3 py-1.5 bg-white border-b border-zinc-200 shrink-0">
      {/* Left: Home + Design name + Canvas size */}
      <div class="flex items-center gap-3">
        <button
          class="p-1.5 rounded-md text-zinc-400 bg-transparent border-none cursor-pointer transition-all hover:bg-zinc-100 hover:text-zinc-900"
          onClick={() => navigate("/")}
          title="Back to designs"
        >
          <Home size={16} />
        </button>
        <button
          class={panelBtnClass(leftPanelOpen)}
          onClick={onToggleLeftPanel}
          title={leftPanelOpen ? "Hide left panel" : "Show left panel"}
        >
          <PanelLeft size={16} />
        </button>
        {activeDesign && (
          editingName ? (
            <input
              class="bg-zinc-100 border border-accent rounded px-2 py-0.5 text-xs text-zinc-900 outline-none w-40"
              value={nameValue}
              onInput={(e) => setNameValue((e.target as HTMLInputElement).value)}
              onBlur={finishRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") finishRename();
                if (e.key === "Escape") setEditingName(false);
              }}
              autoFocus
            />
          ) : (
            <span
              class="text-xs font-semibold text-zinc-600 cursor-pointer hover:text-zinc-900 transition-colors"
              onDblClick={startRename}
            >
              {activeDesign.name}
            </span>
          )
        )}
        {activeVersionRev != null ? (
          <span class="text-[11px] font-medium text-accent bg-accent/10 rounded-md px-2 py-0.5">
            Version #{activeVersionRev}
          </span>
        ) : diskNotice ? (
          <span class="text-[11px] font-medium text-accent bg-accent/10 rounded-md px-2 py-0.5">
            {diskNotice}
          </span>
        ) : null}

        <div class="relative">
          <button
            class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-zinc-400 bg-zinc-100 border border-zinc-300 cursor-pointer hover:text-zinc-900 hover:border-zinc-500 transition-all"
            onClick={() => setShowSizeDropdown(!showSizeDropdown)}
          >
            {sizeLabel}
            <ChevronDown size={12} />
          </button>
          {showSizeDropdown && (
            <>
              <div class="fixed inset-0 z-10" onClick={() => setShowSizeDropdown(false)} />
              <div class="absolute top-full left-0 mt-1 bg-white border border-zinc-300 rounded-lg shadow-xl z-20 min-w-[200px] py-1">
                {CANVAS_SIZES.map((s) => (
                  <button
                    key={s.label}
                    class={`w-full text-left px-3 py-1.5 text-xs cursor-pointer border-none transition-colors ${
                      s.width === canvasWidth && s.height === canvasHeight
                        ? "bg-accent/20 text-accent"
                        : "text-zinc-600 bg-transparent hover:bg-zinc-100"
                    }`}
                    onClick={() => {
                      setCanvasSize(s.width, s.height);
                      setShowSizeDropdown(false);
                    }}
                  >
                    <span class="font-medium">{s.label}</span>
                    <span class="text-zinc-400 ml-2">
                      {s.width} x {s.height}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Center: Undo / Redo / Group */}
      <div class="flex items-center gap-1">
        <button
          class="p-1.5 rounded-md text-zinc-400 bg-transparent border-none cursor-pointer transition-all hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Cmd+Z)"
        >
          <Undo2 size={16} />
        </button>
        <button
          class="p-1.5 rounded-md text-zinc-400 bg-transparent border-none cursor-pointer transition-all hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Cmd+Shift+Z)"
        >
          <Redo2 size={16} />
        </button>
        <div class="w-px h-5 bg-zinc-300 mx-1" />
        <button
          class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-zinc-300 cursor-pointer transition-all bg-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={sendSelectionToBack}
          disabled={!canRestack}
          title="Send selected to back (Ctrl+[)"
        >
          <SendToBack size={13} />
          Back
        </button>
        <button
          class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-zinc-300 cursor-pointer transition-all bg-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={bringSelectionToFront}
          disabled={!canRestack}
          title="Bring selected to front (Ctrl+])"
        >
          <BringToFront size={13} />
          Front
        </button>
        <div class="w-px h-5 bg-zinc-300 mx-1" />
        <button
          class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-zinc-300 cursor-pointer transition-all bg-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={groupSelected}
          disabled={!canGroup}
          title="Group selected (Ctrl+G)"
        >
          <GroupIcon size={13} />
          Group
        </button>
        <button
          class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-zinc-300 cursor-pointer transition-all bg-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={ungroupSelected}
          disabled={!canUngroup}
          title="Ungroup (Ctrl+Shift+G)"
        >
          <UngroupIcon size={13} />
          Ungroup
        </button>
        <button
          class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border border-zinc-300 cursor-pointer transition-all bg-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 disabled:cursor-not-allowed"
          onClick={() => void saveSelectionAsElement()}
          disabled={!canSaveElement}
          title="Save to Elements library"
        >
          <Library size={13} />
          As Element
        </button>
      </div>

      {/* Right: Zoom + Export + Save */}
      <div class="flex items-center gap-1.5">
        <button
          class="p-1.5 rounded-md text-zinc-400 bg-transparent border-none cursor-pointer transition-all hover:bg-zinc-100 hover:text-zinc-900"
          onClick={zoomOut}
          title="Zoom out"
        >
          <ZoomOut size={15} />
        </button>
        <span class="text-[11px] text-zinc-400 font-mono w-10 text-center">
          {Math.round((zoom / (fitScale || 1)) * 100)}%
        </span>
        <button
          class="p-1.5 rounded-md text-zinc-400 bg-transparent border-none cursor-pointer transition-all hover:bg-zinc-100 hover:text-zinc-900"
          onClick={zoomIn}
          title="Zoom in"
        >
          <ZoomIn size={15} />
        </button>
        <button
          class="p-1.5 rounded-md text-zinc-400 bg-transparent border-none cursor-pointer transition-all hover:bg-zinc-100 hover:text-zinc-900"
          onClick={zoomToFit}
          title="Fit to screen"
        >
          <Maximize size={15} />
        </button>

        <div class="w-px h-5 bg-zinc-300 mx-1" />

        <button
          class="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold border border-zinc-300 cursor-pointer transition-all bg-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={async () => {
            if (!activeDesign) return;
            const id = await duplicateDesign(activeDesign.id);
            if (id) navigate(`/design/${id}`);
          }}
          disabled={saving || !activeDesign}
          title="Duplicate this design"
        >
          <Copy size={13} />
          Duplicate
        </button>
        <button
          class="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold border border-zinc-300 cursor-pointer transition-all bg-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={async () => {
            const ok = await copyDesignToClipboard();
            flashNotice(ok ? "Copied to clipboard" : "Could not copy to clipboard");
          }}
          disabled={!activeDesign}
          title="Copy design to clipboard"
        >
          <ClipboardCopy size={13} />
          Copy
        </button>
        <button
          class="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold border border-zinc-300 cursor-pointer transition-all bg-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
          onClick={(e) => {
            const name = activeDesign?.name;
            if (e.shiftKey) {
              e.preventDefault();
              void exportPNG({ toProject: true, name }).then((written) => {
                if (written?.relative) flashNotice(written.relative);
              });
              return;
            }
            void exportPNG({ name });
          }}
          title="Export as PNG. Shift-click saves to .OpenDesign/designs/title_n.png"
        >
          <Download size={13} />
          PNG
        </button>
        <button
          class="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold border border-zinc-300 cursor-pointer transition-all bg-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
          onClick={exportJSON}
          title="Export as JSON"
        >
          <FileJson size={13} />
          JSON
        </button>
        <button
          class="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-md text-[11px] font-semibold border-none cursor-pointer transition-all bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
          onClick={() => void saveDesign()}
          disabled={saving || !activeDesign}
          title="Save (Ctrl+S)"
        >
          {saving ? <span class="spinner !border-white/30 !border-t-white" /> : <Save size={13} />}
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          class="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold border border-zinc-300 cursor-pointer transition-all bg-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={capturingApp}
          onClick={() => {
            setCapturingApp(true);
            void saveAppScreenshot()
              .then((written) => flashNotice(written.relative))
              .catch((e) => flashNotice(e instanceof Error ? e.message : "Could not save screenshot"))
              .finally(() => setCapturingApp(false));
          }}
          title="Capture the visible Chrome tab via Tanit Inspector → docs/assets/screenshot_n.png"
        >
          <Camera size={13} />
          {capturingApp ? "Capturing..." : "Shot"}
        </button>
        <button
          class={panelBtnClass(rightPanelOpen)}
          onClick={onToggleRightPanel}
          title={rightPanelOpen ? "Hide right panel" : "Show right panel"}
        >
          <PanelRight size={16} />
        </button>
      </div>
    </div>
  );
}
