import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import Color from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import { FontSize as TiptapFontSize, TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import type { PostgresCanvasShape } from "../lib/postgres";
import { normalizeCanvasTextHtml } from "../lib/canvasTextHtml";

export type CanvasRichTextTool = "select" | "hand" | "connect" | "pen" | "shape" | "text" | "eraser";

export function stripCanvasRichText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<li>/gi, "* ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

export function CanvasRichTextEditor(props: {
  shape: Extract<PostgresCanvasShape, { kind: "text" }>;
  canvasScale: number;
  isReadOnly: boolean;
  canvasTool: CanvasRichTextTool;
  normalizeColor: (value: string) => string;
  onBeginMove: (event: ReactPointerEvent<Element>, shape: PostgresCanvasShape) => void;
  onBeginEditing: (shapeId: string) => void;
  onDelete: (shapeId: string) => void;
  onSelect: () => void;
  onUpdate: (
    updater: (
      shape: Extract<PostgresCanvasShape, { kind: "text" }>,
    ) => Extract<PostgresCanvasShape, { kind: "text" }>,
  ) => void;
}) {
  const {
    shape,
    canvasScale,
    isReadOnly,
    canvasTool,
    normalizeColor,
    onBeginMove,
    onBeginEditing,
    onDelete,
    onSelect,
    onUpdate,
  } = props;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      TiptapFontSize,
      Color.configure({ types: ["textStyle"] }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: normalizeCanvasTextHtml(shape.html),
    editable: !isReadOnly,
    editorProps: {
      attributes: {
        class: "canvas-rich-text-editor",
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      const html = normalizeCanvasTextHtml(activeEditor.getHTML());
      onUpdate((current) => ({ ...current, html }));
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!isReadOnly);
  }, [editor, isReadOnly]);

  useEffect(() => {
    if (!editor) return;
    editor.commands.focus("end");
  }, [editor, shape.id]);

  const editorSurfaceStyle: CSSProperties = {
    minHeight: shape.height,
    padding: "6px 8px",
    outline: "none",
    borderRadius: 8,
    border: "1px solid rgba(53, 80, 112, 0.28)",
    background: "rgba(255, 255, 255, 0.86)",
    color: shape.color,
    fontSize: shape.fontSize,
    lineHeight: 1.35,
    textAlign: shape.textAlign,
    whiteSpace: "normal",
    cursor: "text",
    boxSizing: "border-box",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };

  const menuButtonStyle = (active?: boolean): CSSProperties => ({
    minWidth: 32,
    height: 32,
    padding: "0 8px",
    justifyContent: "center",
    background: active ? "rgba(53, 80, 112, 0.10)" : undefined,
  });
  const activeFontSize = String(editor?.getAttributes("textStyle").fontSize ?? `${shape.fontSize}px`);

  return (
    <>
      {editor ? (
        <BubbleMenu
          editor={editor}
          shouldShow={(menuProps: { editor: { isFocused: boolean } }) => menuProps.editor.isFocused}
          options={{
            placement: "top-start",
            offset: 10,
          }}
        >
          <div
            data-text-editor-toolbar="true"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              padding: 6,
              borderRadius: 12,
              border: "1px solid rgba(53, 80, 112, 0.14)",
              background: "rgba(255, 255, 255, 0.98)",
              boxShadow: "0 12px 24px rgba(15, 23, 42, 0.12)",
              transform: `scale(${1 / canvasScale})`,
              transformOrigin: "left bottom",
              pointerEvents: "auto",
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "auto auto",
                gap: 10,
                alignItems: "stretch",
              }}
            >
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {[
                    { label: "B", isActive: editor.isActive("bold"), onClick: () => editor.chain().focus().toggleBold().run(), style: { fontWeight: 800 } },
                    { label: "I", isActive: editor.isActive("italic"), onClick: () => editor.chain().focus().toggleItalic().run(), style: { fontStyle: "italic" } },
                    { label: "U", isActive: editor.isActive("underline"), onClick: () => editor.chain().focus().toggleUnderline().run(), style: { textDecoration: "underline" } },
                    { label: "S", isActive: editor.isActive("strike"), onClick: () => editor.chain().focus().toggleStrike().run(), style: { textDecoration: "line-through" } },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className="btn btn--ghost"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        item.onClick();
                      }}
                      style={{ ...menuButtonStyle(item.isActive), ...(item.style ?? {}) }}
                    >
                      {item.label}
                    </button>
                  ))}
                  <select
                    value={activeFontSize}
                    onMouseDown={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      const nextFontSize = event.target.value;
                      const parsedFontSize = Number(nextFontSize.replace("px", ""));
                      if (Number.isFinite(parsedFontSize)) {
                        onUpdate((current) => ({ ...current, fontSize: parsedFontSize }));
                      }
                      editor.chain().focus().setFontSize(nextFontSize).run();
                    }}
                    style={{
                      height: 32,
                      borderRadius: 10,
                      border: "1px solid rgba(53, 80, 112, 0.16)",
                      background: "#ffffff",
                      color: "#1f2933",
                      padding: "0 8px",
                    }}
                  >
                    {[14, 16, 18, 20, 24, 28, 32].map((fontSize) => (
                      <option key={fontSize} value={`${fontSize}px`}>{fontSize}px</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {[
                    { label: "\u2022", isActive: editor.isActive("bulletList"), onClick: () => editor.chain().focus().toggleBulletList().run() },
                    { label: "1.", isActive: editor.isActive("orderedList"), onClick: () => editor.chain().focus().toggleOrderedList().run() },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className="btn btn--ghost"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        item.onClick();
                      }}
                      style={menuButtonStyle(item.isActive)}
                    >
                      {item.label}
                    </button>
                  ))}
                  <div style={{ width: 1, height: 24, background: "rgba(53, 80, 112, 0.12)" }} />
                  {([
                    { value: "left", title: "Align left", x1: 4, x2: 12 },
                    { value: "center", title: "Align center", x1: 6, x2: 14 },
                    { value: "right", title: "Align right", x1: 8, x2: 16 },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="btn btn--ghost"
                      aria-label={option.title}
                      title={option.title}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        onUpdate((current) => ({ ...current, textAlign: option.value }));
                        editor.chain().focus().setTextAlign(option.value).run();
                      }}
                      style={menuButtonStyle(editor.isActive({ textAlign: option.value }))}
                    >
                      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ display: "block" }}>
                        <line x1="4" y1="5" x2="16" y2="5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                        <line x1={option.x1} y1="10" x2={option.x2} y2="10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                        <line x1="4" y1="15" x2="16" y2="15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateRows: "1fr 1fr",
                  gap: 8,
                  alignItems: "stretch",
                  minWidth: 104,
                }}
              >
                <input
                  className="form-input form-input--color"
                  type="color"
                  value={shape.color}
                  aria-label="Text color"
                  onMouseDown={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    const nextColor = event.target.value;
                    onUpdate((current) => ({ ...current, color: nextColor }));
                    editor.chain().focus().setColor(nextColor).run();
                  }}
                  style={{ width: "100%", minWidth: 0, height: 32, padding: 3 }}
                />
                <input
                  className="form-input"
                  value={shape.color}
                  aria-label="Text color hex value"
                  onMouseDown={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    const nextColor = normalizeColor(event.target.value);
                    onUpdate((current) => ({ ...current, color: nextColor }));
                    editor.chain().focus().setColor(nextColor).run();
                  }}
                  style={{
                    width: 104,
                    height: 32,
                    borderRadius: 10,
                    fontFamily: "monospace",
                  }}
                />
              </div>
            </div>
          </div>
        </BubbleMenu>
      ) : null}
      <div
        data-canvas-text-editor-id={shape.id}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (canvasTool === "eraser") {
            onDelete(shape.id);
            return;
          }
          if (canvasTool === "select") {
            onBeginMove(event, shape);
            return;
          }
          if (canvasTool === "text") {
            onBeginEditing(shape.id);
            return;
          }
          onSelect();
        }}
        style={editorSurfaceStyle}
      >
        <EditorContent editor={editor} />
      </div>
    </>
  );
}
