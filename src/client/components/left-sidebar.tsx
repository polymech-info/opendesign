import { useRouteDesignId, useRoutePanel } from "../hooks/use-app-navigate";
import { editorHref, type EditorPanel } from "../lib/editor-path";
import {
  Type,
  Square,
  Circle,
  Triangle,
  Minus,
  Upload,
  Palette,
  LayoutGrid,
  Sparkles,
  Layers,
  MessageCircle,
  History,
  ClipboardPaste,
  Shapes,
  Diamond,
  Hexagon,
  Star,
  ArrowRight,
  RectangleHorizontal,
  CornerDownRight,
  Spline,
  MessageSquare,
  Cloud,
} from "lucide-preact";
import { useEditor } from "../context";
import { features } from "../mode";
import { TemplateCard } from "./template-card";
import { DesignList } from "./design-list";
import { VersionsPanel } from "./versions-panel";
import { MediaLibrary } from "./media-library";
import { pagePhotoSrc } from "../lib/background-image";
import { LayersPanel } from "./layers-panel";
import { IconsPanel } from "./icons-panel";
import { ElementsLibrary } from "./elements-library";
import { ChatPanel } from "../modules/ai/ChatPanel";
import { BackgroundFillPanel } from "./background-fill";
import type { ShapeKind } from "../lib/shapes";

type Section = EditorPanel;

const SECTIONS: { key: Section; icon: typeof LayoutGrid; label: string }[] = [
  { key: "chat", icon: MessageCircle, label: "Chat" },
  { key: "templates", icon: Sparkles, label: "Templates" },
  { key: "shapes", icon: Square, label: "Elements" },
  { key: "icons", icon: Shapes, label: "Icons" },
  { key: "layers", icon: Layers, label: "Layers" },
  { key: "text", icon: Type, label: "Text" },
  { key: "images", icon: Upload, label: "Uploads" },
  { key: "background", icon: Palette, label: "Background" },
  { key: "designs", icon: LayoutGrid, label: "Designs" },
  { key: "versions", icon: History, label: "Versions" },
];

const SECTION_TITLES: Record<Section, string> = {
  chat: "Chat",
  templates: "Templates",
  shapes: "Elements",
  icons: "Icons",
  layers: "Layers",
  text: "Text",
  images: "Uploads",
  background: "Background",
  designs: "Designs",
  versions: "Versions",
};

const SHAPE_BUTTONS: { type: ShapeKind; icon: typeof Square; label: string }[] = [
  { type: "rect", icon: Square, label: "Rectangle" },
  { type: "round", icon: RectangleHorizontal, label: "Round" },
  { type: "circle", icon: Circle, label: "Circle" },
  { type: "ellipse", icon: Circle, label: "Ellipse" },
  { type: "triangle", icon: Triangle, label: "Triangle" },
  { type: "diamond", icon: Diamond, label: "Diamond" },
  { type: "hexagon", icon: Hexagon, label: "Hexagon" },
  { type: "star", icon: Star, label: "Star" },
  { type: "arrow", icon: ArrowRight, label: "Chevron" },
];

const LINE_BUTTONS: { type: ShapeKind; icon: typeof Square; label: string }[] = [
  { type: "connector", icon: Minus, label: "Line" },
  { type: "connector-arrow", icon: ArrowRight, label: "Arrow" },
  { type: "connector-elbow", icon: CornerDownRight, label: "Elbow" },
  { type: "connector-curve", icon: Spline, label: "Curve" },
];

const sections = SECTIONS.filter(
  (section) => (features.chat || section.key !== "chat") && (features.icons || section.key !== "icons"),
);

const BALLOON_BUTTONS: { type: ShapeKind; icon: typeof Square; label: string }[] = [
  { type: "balloon", icon: MessageSquare, label: "Speech" },
  { type: "balloon-thought", icon: Cloud, label: "Thought" },
];

export function LeftSidebar() {
  const { addText, addShape, addIcon, addImage, addImageFromClipboard, addLibraryElement, setBackground, templates, createFromTemplate, navigate, canvas } = useEditor();
  const designId = useRouteDesignId();
  const routed = useRoutePanel();
  const activeSection = sections.some((section) => section.key === routed) ? routed : null;

  const handleSectionClick = (key: Section) => {
    if (!designId) return;
    navigate(editorHref(designId, activeSection === key ? null : key));
  };

  const isOpen = activeSection !== null;
  const isChat = activeSection === "chat";
  const panelWidth = isChat ? 360 : 240;

  return (
    <aside class="flex flex-row shrink-0">
      {/* Icon Rail */}
      <div class="w-[70px] bg-surface-card border-r border-border-dim flex flex-col items-center pt-2 gap-0.5 shrink-0 overflow-y-auto">
        {sections.map((s) => (
          <button
            key={s.key}
            class={`flex flex-col items-center justify-center gap-0.5 w-[56px] h-[56px] rounded-lg bg-transparent border-none cursor-pointer transition-all ${
              activeSection === s.key
                ? "text-accent bg-accent/10"
                : "text-fg-muted hover:text-fg hover:bg-surface-hover"
            }`}
            onClick={() => handleSectionClick(s.key)}
          >
            <s.icon size={20} />
            <span class="text-[9px] leading-tight text-center px-0.5">{s.label}</span>
          </button>
        ))}
      </div>

      {/* Content Panel */}
      <div
        class="bg-surface-card border-r border-border-dim overflow-hidden transition-all duration-200 ease-in-out"
        style={{ width: isOpen ? `${panelWidth}px` : "0px" }}
      >
        <div class="h-full" style={{ width: `${panelWidth}px` }}>
          {features.chat && (
            <div class={`h-full min-h-0 ${isChat ? "flex flex-col" : "hidden"}`} style={{ width: "360px" }}>
              <ChatPanel />
            </div>
          )}
          {activeSection && activeSection !== "chat" && (
            <div class="h-full flex flex-col" style={{ width: "240px" }}>
              <div class="px-3 pt-3 pb-2 shrink-0">
                <h2 class="text-xs font-semibold text-fg uppercase tracking-wide m-0">
                  {SECTION_TITLES[activeSection]}
                </h2>
              </div>
              <div class="flex-1 overflow-y-auto px-3 pb-3">
                {activeSection === "templates" && (
                  <div>
                    {templates.length === 0 ? (
                      <p class="text-fg-muted text-[11px]">No templates yet.</p>
                    ) : (
                      <>
                        <p class="text-[11px] mb-3 m-0 text-fg-muted">Creates a new design — does not overwrite this one</p>
                        <div class="grid grid-cols-2 gap-2">
                          {templates.map((t) => (
                            <TemplateCard
                              key={t.id}
                              template={t}
                              onClick={async () => {
                                const id = await createFromTemplate(t);
                                if (id) navigate(editorHref(id, "templates"));
                              }}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {activeSection === "text" && (
                  <div class="flex flex-col gap-2">
                    <p class="text-fg-muted text-[11px] mb-1">Click to add text</p>
                    <button
                      class="w-full text-left p-3 rounded-lg bg-surface-card border border-border-dim cursor-pointer transition-all hover:border-accent hover:bg-accent/5 group"
                      onClick={() => addText("heading")}
                    >
                      <span class="text-lg font-bold text-fg group-hover:text-accent transition-colors">
                        Add a heading
                      </span>
                      <span class="block text-[10px] text-fg-muted mt-0.5">
                        Montserrat Bold, 48px
                      </span>
                    </button>
                    <button
                      class="w-full text-left p-3 rounded-lg bg-surface-card border border-border-dim cursor-pointer transition-all hover:border-accent hover:bg-accent/5 group"
                      onClick={() => addText("subheading")}
                    >
                      <span class="text-sm font-medium text-fg group-hover:text-accent transition-colors">
                        Add a subheading
                      </span>
                      <span class="block text-[10px] text-fg-muted mt-0.5">
                        Inter Medium, 32px
                      </span>
                    </button>
                    <button
                      class="w-full text-left p-3 rounded-lg bg-surface-card border border-border-dim cursor-pointer transition-all hover:border-accent hover:bg-accent/5 group"
                      onClick={() => addText("body")}
                    >
                      <span class="text-xs text-fg group-hover:text-accent transition-colors">
                        Add body text
                      </span>
                      <span class="block text-[10px] text-fg-muted mt-0.5">
                        Inter Regular, 18px
                      </span>
                    </button>
                  </div>
                )}

                {activeSection === "shapes" && (
                  <div>
                    <p class="text-fg-muted text-[11px] mb-2">Click to add a shape</p>
                    <div class="grid grid-cols-2 gap-2">
                      {SHAPE_BUTTONS.map((s) => (
                        <button
                          key={s.type}
                          class="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-surface-card border border-border-dim cursor-pointer transition-all hover:border-accent hover:bg-accent/5"
                          onClick={() => addShape(s.type)}
                        >
                          <s.icon size={24} class="text-fg-muted" />
                          <span class="text-[11px] text-fg-muted">{s.label}</span>
                        </button>
                      ))}
                    </div>
                    <p class="text-fg-muted text-[11px] mb-2 mt-4">Lines & arrows</p>
                    <p class="text-[10px] text-fg-muted mb-2 m-0">Drag the handles. Endpoints snap to nearby corners and edges.</p>
                    <div class="grid grid-cols-2 gap-2">
                      {LINE_BUTTONS.map((s) => (
                        <button
                          key={s.type}
                          class="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-surface-card border border-border-dim cursor-pointer transition-all hover:border-accent hover:bg-accent/5"
                          onClick={() => addShape(s.type)}
                        >
                          <s.icon size={24} class="text-fg-muted" />
                          <span class="text-[11px] text-fg-muted">{s.label}</span>
                        </button>
                      ))}
                    </div>
                    <p class="text-fg-muted text-[11px] mb-2 mt-4">Balloons</p>
                    <div class="grid grid-cols-2 gap-2">
                      {BALLOON_BUTTONS.map((s) => (
                        <button
                          key={s.type}
                          class="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-surface-card border border-border-dim cursor-pointer transition-all hover:border-accent hover:bg-accent/5"
                          onClick={() => addShape(s.type)}
                        >
                          <s.icon size={24} class="text-fg-muted" />
                          <span class="text-[11px] text-fg-muted">{s.label}</span>
                        </button>
                      ))}
                    </div>
                    <button
                      class="mt-3 w-full flex items-center justify-center gap-2 p-2.5 rounded-lg bg-surface-card border border-border-dim cursor-pointer transition-all hover:border-accent hover:bg-accent/5"
                      onClick={() => void addImageFromClipboard()}
                      title="Paste image from clipboard (Ctrl+V)"
                    >
                      <ClipboardPaste size={16} class="text-fg-muted" />
                      <span class="text-[11px] text-fg-secondary">Paste image</span>
                    </button>
                    <p class="text-[10px] text-fg-muted mt-1.5 m-0">Fits the canvas, then saves to uploads/</p>
                    <p class="text-fg-muted text-[11px] mb-2 mt-4">Library</p>
                    <ElementsLibrary onPick={(json, name, sourceId) => void addLibraryElement(json, name, sourceId)} />
                  </div>
                )}

                {features.icons && activeSection === "icons" && (
                  <div>
                    <p class="text-fg-muted text-[11px] mb-2">Local: click to place. Iconify: double-click to download to uploads/icons/ and place.</p>
                    <IconsPanel onPick={(pick) => void addIcon(pick)} />
                  </div>
                )}

                {activeSection === "layers" && <LayersPanel />}

                {activeSection === "images" && (
                  <div>
                    <p class="text-fg-muted text-[11px] mb-2">Stored in uploads/ — click a thumbnail to place, or drop files here</p>
                    <MediaLibrary kind="images" onPick={addImage} />
                  </div>
                )}

                {activeSection === "background" && (
                  <div>
                    <BackgroundFillPanel />
                    <p class="text-fg-muted text-[11px] mb-2 mt-4">Background images</p>
                    <p class="text-fg-muted text-[10px] mb-2">Stored in uploads/backgrounds/ — click a thumbnail to apply, or drop files here</p>
                    <MediaLibrary kind="backgrounds" currentUrl={pagePhotoSrc(canvas)} onPick={(url) => setBackground("image", url)} />
                  </div>
                )}

                {activeSection === "designs" && <DesignList />}
                {activeSection === "versions" && <VersionsPanel />}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
