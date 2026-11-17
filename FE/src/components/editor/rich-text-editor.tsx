"use client";

import "@tiptap/extension-text-style";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { useEffect, useRef } from "react";
import { Icon, type IconName } from "@/components/icons/icon";
import { editorExtensions, FONT_FAMILIES, FONT_SIZES } from "@/components/editor/extensions";
import { copyText } from "@/lib/download";
import { toast } from "@/lib/events";

interface RichTextEditorProps {
  /** HTML string (same contract as TrackVid's ReactQuill `value`). */
  value: string;
  onChange: (html: string) => void;
  /** Incrementing this copies the editor's plain text to the clipboard (TrackVid `copyTrigger`). */
  copyTrigger?: number;
  readOnly?: boolean;
  label?: string;
}

function ToolButton({ icon, label, active, onClick, disabled }: { icon: IconName; label: string; active?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={active ? "is-active" : undefined} aria-label={label} title={label} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const chain = () => editor.chain().focus();
  const heading = [1, 2, 3, 4, 5, 6].find((l) => editor.isActive("heading", { level: l }));
  const size = (editor.getAttributes("textStyle").fontSize as string | undefined) ?? "";
  const font = (editor.getAttributes("textStyle").fontFamily as string | undefined) ?? "";
  return (
    <div className="tv-editor-toolbar" role="toolbar" aria-label="Formatting">
      <select
        aria-label="Heading"
        value={heading ? String(heading) : ""}
        onChange={(e) => {
          const v = Number(e.currentTarget.value);
          if (v) chain().toggleHeading({ level: v as 1 | 2 | 3 | 4 | 5 | 6 }).run();
          else chain().setParagraph().run();
        }}
      >
        <option value="">Normal</option>
        {[1, 2, 3, 4, 5, 6].map((l) => (
          <option key={l} value={l}>
            Heading {l}
          </option>
        ))}
      </select>
      <select aria-label="Font" value={font} onChange={(e) => (e.currentTarget.value ? chain().setFontFamily(e.currentTarget.value).run() : chain().unsetFontFamily().run())}>
        {FONT_FAMILIES.map((f) => (
          <option key={f.label} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <select aria-label="Size" value={size} onChange={(e) => chain().setMark("textStyle", { fontSize: e.currentTarget.value || null }).removeEmptyTextStyle().run()}>
        {FONT_SIZES.map((s) => (
          <option key={s.label} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <span className="tv-editor-sep" />
      <ToolButton icon="text-bold" label="Bold" active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()} />
      <ToolButton icon="text-italic" label="Italic" active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()} />
      <ToolButton icon="text-underline" label="Underline" active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()} />
      <ToolButton icon="text-strike" label="Strikethrough" active={editor.isActive("strike")} onClick={() => chain().toggleStrike().run()} />
      <ToolButton icon="quote" label="Blockquote" active={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()} />
      <span className="tv-editor-sep" />
      <label title="Text colour" style={{ display: "inline-flex" }}>
        <span className="sr-only">Text colour</span>
        <input type="color" value={(editor.getAttributes("textStyle").color as string | undefined) ?? "#25251f"} onChange={(e) => chain().setColor(e.currentTarget.value).run()} />
      </label>
      <label title="Background colour" style={{ display: "inline-flex" }}>
        <span className="sr-only">Background colour</span>
        <input type="color" value={(editor.getAttributes("highlight").color as string | undefined) ?? "#fff0c6"} onChange={(e) => chain().setHighlight({ color: e.currentTarget.value }).run()} />
      </label>
      <span className="tv-editor-sep" />
      <ToolButton icon="align-left" label="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => chain().setTextAlign("left").run()} />
      <ToolButton icon="align-center" label="Align centre" active={editor.isActive({ textAlign: "center" })} onClick={() => chain().setTextAlign("center").run()} />
      <ToolButton icon="align-right" label="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => chain().setTextAlign("right").run()} />
      <ToolButton icon="align-justify" label="Justify" active={editor.isActive({ textAlign: "justify" })} onClick={() => chain().setTextAlign("justify").run()} />
      <span className="tv-editor-sep" />
      <ToolButton icon="list-numbers" label="Numbered list" active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()} />
      <ToolButton icon="list-bullets" label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()} />
      <ToolButton icon="outdent" label="Decrease indent" onClick={() => chain().liftListItem("listItem").run()} disabled={!editor.can().liftListItem("listItem")} />
      <ToolButton icon="indent" label="Increase indent" onClick={() => chain().sinkListItem("listItem").run()} disabled={!editor.can().sinkListItem("listItem")} />
      <span className="tv-editor-sep" />
      <ToolButton
        icon="link"
        label="Link"
        active={editor.isActive("link")}
        onClick={() => {
          const prev = (editor.getAttributes("link").href as string | undefined) ?? "";
          const href = window.prompt("Link URL (https://… or mailto:…)", prev);
          if (href === null) return;
          if (!href) chain().extendMarkRange("link").unsetLink().run();
          else if (/^(https?:|mailto:)/i.test(href)) chain().extendMarkRange("link").setLink({ href }).run();
          else toast.error("Only http, https and mailto links are allowed.");
        }}
      />
      <ToolButton icon="text-clear" label="Clear formatting" onClick={() => chain().unsetAllMarks().clearNodes().run()} />
      <span className="tv-editor-sep" />
      <ToolButton icon="undo" label="Undo" onClick={() => chain().undo().run()} disabled={!editor.can().undo()} />
      <ToolButton icon="redo" label="Redo" onClick={() => chain().redo().run()} disabled={!editor.can().redo()} />
    </div>
  );
}

/**
 * Tiptap editor replacing react-quill. Takes and returns an HTML string; reads Quill classes
 * (`ql-align-*`, `ql-size-*`, `ql-font-*`, `ql-indent-*`). Its schema drops scripts, event handlers
 * and `javascript:` links, the same protection ReactQuill gave the CMS claim email.
 */
export function RichTextEditor({ value, onChange, copyTrigger, readOnly = false, label = "Rich text editor" }: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const editor = useEditor({
    extensions: editorExtensions(),
    content: value,
    editable: !readOnly,
    immediatelyRender: false,
    editorProps: { attributes: { "aria-label": label, role: "textbox", "aria-multiline": "true" } },
    onUpdate: ({ editor: e }) => onChangeRef.current(e.getHTML()),
  });

  // Outside value changes (e.g. a template reset) replace the content without adding history noise.
  useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value, false);
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  const lastCopy = useRef(copyTrigger);
  useEffect(() => {
    if (!editor || copyTrigger === undefined || copyTrigger === lastCopy.current) return;
    lastCopy.current = copyTrigger;
    void copyText(editor.getText()).then((ok) => (ok ? toast.success("Copied to clipboard") : toast.error("Could not copy to clipboard")));
  }, [editor, copyTrigger]);

  return (
    <div className={`tv-editor ${readOnly ? "is-readonly" : ""}`.trim()}>
      {editor && !readOnly ? <Toolbar editor={editor} /> : null}
      <div className="tv-editor-content">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
