import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import {
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  BringToFront,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  Group as GroupIcon,
  Library,
  Lock,
  Maximize2,
  Redo2,
  RotateCcw,
  Scissors,
  SendToBack,
  Trash2,
  Undo2,
  Ungroup as UngroupIcon,
  UnfoldHorizontal,
  UnfoldVertical,
} from "lucide-preact";
import * as fabric from "fabric";
import { useEditor } from "../context";
import { selectedCanvasObjects } from "../lib/object-style";
import { isElementGroup } from "../lib/element-group";
import { isCroppableImage } from "../lib/image-crop";
import { isBgImage } from "../lib/background-image";
import { stackTargetsFromSelection } from "../lib/layer-stack";
import { alignableSelection } from "../lib/align-objects";

type MenuPos = { x: number; y: number };

const MENU_PAD = 8;

function clampMenuPos(x: number, y: number, width: number, height: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxW = Math.max(160, vw - MENU_PAD * 2);
  const maxH = Math.max(120, vh - MENU_PAD * 2);
  const w = Math.min(width, maxW);
  const h = Math.min(height, maxH);
  let left = x;
  let top = y;
  if (left + w > vw - MENU_PAD) left = x - w;
  if (top + h > vh - MENU_PAD) top = y - h;
  left = Math.min(Math.max(MENU_PAD, left), vw - w - MENU_PAD);
  top = Math.min(Math.max(MENU_PAD, top), vh - h - MENU_PAD);
  return { left, top, maxH };
}

function Section({ label, children }: { label?: string; children: ComponentChildren }) {
  return (
    <div class="py-0.5">
      {label && (
        <div class="px-2 pt-1 pb-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-400">{label}</div>
      )}
      {children}
    </div>
  );
}

function Item({
  icon,
  label,
  shortcut,
  disabled,
  danger,
  onClick,
}: {
  icon: ComponentChildren;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      class={`w-full flex items-center gap-1.5 px-2 py-0.5 text-[11px] leading-4 border-none cursor-pointer bg-transparent ${
        disabled
          ? "text-zinc-300 cursor-not-allowed"
          : danger
            ? "text-red-600 hover:bg-red-50"
            : "text-zinc-700 hover:bg-zinc-100"
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      <span class="w-3 h-3 shrink-0 flex items-center justify-center">{icon}</span>
      <span class="flex-1 text-left">{label}</span>
      {shortcut && <span class="text-[9px] text-zinc-400 font-mono">{shortcut}</span>}
    </button>
  );
}

function Divider() {
  return <div class="h-px bg-zinc-200 my-0.5" />;
}

export function CanvasContextMenu({ pos, onClose }: { pos: MenuPos; onClose: () => void }) {
  const {
    canvas,
    selectedObject,
    undo,
    redo,
    canUndo,
    canRedo,
    copySelectedObjects,
    pasteCopiedCanvasObjects,
    duplicateSelected,
    deleteSelected,
    groupSelected,
    ungroupSelected,
    saveSelectionAsElement,
    bringSelectionToFront,
    sendSelectionToBack,
    alignSelected,
    matchSelectedSize,
    maximizeSelected,
    resetSelectedImage,
    updateSelectedObject,
    copySelectedStyle,
    pasteSelectedStyle,
    hasCopiedStyle,
    lockSelectedAsBackground,
    addImageFromClipboard,
  } = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(() => clampMenuPos(pos.x, pos.y, 200, 320));

  const objects = selectedCanvasObjects(canvas, selectedObject);
  const count = objects.length;
  const hasSelection = count > 0;
  const canGroup = count >= 2;
  const canUngroup = isElementGroup(canvas?.getActiveObject() ?? null);
  const canRestack = !!stackTargetsFromSelection(canvas, selectedObject);
  const canAlign = alignableSelection(canvas, selectedObject).length >= 2;
  const hidden = hasSelection && objects.every((obj) => obj.visible === false);
  const imageOnly =
    count === 1 && objects[0] instanceof fabric.FabricImage && !isBgImage(objects[0]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const rect = el.getBoundingClientRect();
      const next = clampMenuPos(pos.x, pos.y, rect.width, el.scrollHeight || rect.height);
      setBox((prev) =>
        prev.left === next.left && prev.top === next.top && prev.maxH === next.maxH ? prev : next
      );
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [pos.x, pos.y, canAlign, hasSelection, imageOnly]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const run = (fn: () => void | Promise<unknown>) => {
    void fn();
    onClose();
  };

  return (
    <div
      ref={ref}
      class="fixed z-50 min-w-[168px] max-w-[200px] py-0.5 bg-white border border-zinc-200 rounded-md shadow-xl overflow-y-auto"
      style={{ left: box.left, top: box.top, maxHeight: box.maxH }}
    >
      <Section>
        <Item icon={<Undo2 size={12} />} label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={() => run(undo)} />
        <Item icon={<Redo2 size={12} />} label="Redo" shortcut="⇧Z" disabled={!canRedo} onClick={() => run(redo)} />
      </Section>
      <Divider />
      <Section label="Edit">
        <Item
          icon={<Scissors size={12} />}
          label="Cut"
          shortcut="Ctrl+X"
          disabled={!hasSelection}
          onClick={() =>
            run(() => {
              if (copySelectedObjects()) deleteSelected();
            })
          }
        />
        <Item
          icon={<Copy size={12} />}
          label="Copy"
          shortcut="Ctrl+C"
          disabled={!hasSelection}
          onClick={() => run(() => void copySelectedObjects())}
        />
        <Item
          icon={<ClipboardPaste size={12} />}
          label="Paste"
          shortcut="Ctrl+V"
          onClick={() => run(() => void pasteCopiedCanvasObjects())}
        />
        <Item
          icon={<Copy size={12} />}
          label="Duplicate"
          shortcut="Ctrl+D"
          disabled={!hasSelection}
          onClick={() => run(() => void duplicateSelected())}
        />
        <Item
          icon={<Trash2 size={12} />}
          label="Delete"
          shortcut="Del"
          disabled={!hasSelection}
          danger
          onClick={() => run(deleteSelected)}
        />
      </Section>
      <Divider />
      <Section label="Arrange">
        <Item
          icon={<BringToFront size={12} />}
          label="Bring to front"
          shortcut="Ctrl+]"
          disabled={!canRestack}
          onClick={() => run(bringSelectionToFront)}
        />
        <Item
          icon={<SendToBack size={12} />}
          label="Send to back"
          shortcut="Ctrl+["
          disabled={!canRestack}
          onClick={() => run(sendSelectionToBack)}
        />
        <Item
          icon={<GroupIcon size={12} />}
          label="Group"
          shortcut="Ctrl+G"
          disabled={!canGroup}
          onClick={() => run(groupSelected)}
        />
        <Item
          icon={<UngroupIcon size={12} />}
          label="Ungroup"
          shortcut="⇧G"
          disabled={!canUngroup}
          onClick={() => run(ungroupSelected)}
        />
        <Item
          icon={<Library size={12} />}
          label="Save as element"
          disabled={!hasSelection}
          onClick={() => run(() => void saveSelectionAsElement())}
        />
      </Section>
      {canAlign && (
        <>
          <Divider />
          <Section label="Align">
            <Item icon={<AlignStartVertical size={12} />} label="Align left" onClick={() => run(() => alignSelected("left"))} />
            <Item icon={<AlignEndVertical size={12} />} label="Align right" onClick={() => run(() => alignSelected("right"))} />
            <Item icon={<AlignStartHorizontal size={12} />} label="Align top" onClick={() => run(() => alignSelected("top"))} />
            <Item icon={<AlignEndHorizontal size={12} />} label="Align bottom" onClick={() => run(() => alignSelected("bottom"))} />
            <Item icon={<UnfoldHorizontal size={12} />} label="Same width" onClick={() => run(() => matchSelectedSize("width"))} />
            <Item icon={<UnfoldVertical size={12} />} label="Same height" onClick={() => run(() => matchSelectedSize("height"))} />
          </Section>
        </>
      )}
      <Divider />
      <Section label="Object">
        <Item
          icon={<Maximize2 size={12} />}
          label="Maximize"
          disabled={!hasSelection}
          onClick={() => run(maximizeSelected)}
        />
        <Item
          icon={hidden ? <Eye size={12} /> : <EyeOff size={12} />}
          label={hidden ? "Show" : "Hide"}
          disabled={!hasSelection}
          onClick={() => run(() => updateSelectedObject({ visible: hidden }))}
        />
        <Item
          icon={<ClipboardCopy size={12} />}
          label="Copy style"
          disabled={!hasSelection}
          onClick={() => run(copySelectedStyle)}
        />
        <Item
          icon={<ClipboardPaste size={12} />}
          label="Paste style"
          disabled={!hasCopiedStyle || !hasSelection}
          onClick={() => run(pasteSelectedStyle)}
        />
        {imageOnly && isCroppableImage(objects[0]) && (
          <Item
            icon={<RotateCcw size={12} />}
            label="Reset image"
            onClick={() => run(resetSelectedImage)}
          />
        )}
        {imageOnly && (
          <Item icon={<Lock size={12} />} label="Lock as background" onClick={() => run(lockSelectedAsBackground)} />
        )}
        {!hasSelection && (
          <Item
            icon={<ClipboardPaste size={12} />}
            label="Paste image"
            onClick={() => run(() => void addImageFromClipboard())}
          />
        )}
      </Section>
    </div>
  );
}
