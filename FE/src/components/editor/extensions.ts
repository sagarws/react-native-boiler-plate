import { Extension, type Extensions } from "@tiptap/core";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";

/** Quill size classes → font sizes (Quill "snow" theme values). */
const QL_SIZES: Record<string, string> = { small: "0.75em", large: "1.5em", huge: "2.5em" };
/** Quill font classes → CSS font stacks. */
const QL_FONTS: Record<string, string> = { serif: "Georgia, Times New Roman, serif", monospace: "Monaco, Courier New, monospace" };

function qlClass(el: HTMLElement, prefix: string): string | null {
  const cls = Array.from(el.classList).find((c) => c.startsWith(prefix));
  return cls ? cls.slice(prefix.length) : null;
}

/** Font size on `textStyle` marks; reads inline `font-size` and Quill `ql-size-*` classes. */
export const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.fontSize || QL_SIZES[qlClass(el, "ql-size-") ?? ""] || null,
            renderHTML: (attrs: { fontSize?: string | null }) => (attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {}),
          },
        },
      },
    ];
  },
});

/** Reads Quill `ql-font-*` classes into the FontFamily attribute. */
export const QuillFontClass = Extension.create({
  name: "quillFontClass",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.fontFamily?.replace(/['"]+/g, "") || QL_FONTS[qlClass(el, "ql-font-") ?? ""] || null,
            renderHTML: (attrs: { fontFamily?: string | null }) => (attrs.fontFamily ? { style: `font-family: ${attrs.fontFamily}` } : {}),
          },
        },
      },
    ];
  },
});

/** Paragraph / heading indent; reads Quill `ql-indent-N` and writes `margin-left` (email-client safe). */
export const Indent = Extension.create({
  name: "indent",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el: HTMLElement) => {
              const q = Number(qlClass(el, "ql-indent-") ?? 0);
              if (q) return q;
              const m = /^(\d+(?:\.\d+)?)em$/.exec(el.style.marginLeft || "");
              return m ? Math.round(Number(m[1]) / 3) : 0;
            },
            renderHTML: (attrs: { indent?: number }) => (attrs.indent ? { style: `margin-left: ${attrs.indent * 3}em` } : {}),
          },
        },
      },
    ];
  },
});

/** Reads Quill `ql-align-*` classes into TextAlign. */
export const QuillAlignClass = Extension.create({
  name: "quillAlignClass",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.textAlign || qlClass(el, "ql-align-") || null,
            renderHTML: (attrs: { textAlign?: string | null }) => (attrs.textAlign && attrs.textAlign !== "left" ? { style: `text-align: ${attrs.textAlign}` } : {}),
          },
        },
      },
    ];
  },
});

const SAFE_LINK = /^(https?:|mailto:)/i;

/** TextStyle that also reads Quill class-only spans; spans that carry no supported style are skipped. */
const QuillTextStyle = TextStyle.extend({
  parseHTML() {
    return [
      {
        tag: "span",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false;
          const st = node.style;
          const hasStyle = Boolean(st.color || st.fontSize || st.fontFamily);
          const hasClass = Array.from(node.classList).some((c) => c.startsWith("ql-size-") || c.startsWith("ql-font-"));
          return hasStyle || hasClass ? {} : false;
        },
      },
    ];
  },
});

/** Highlight that also reads Quill's `<span style="background-color">`. */
const QuillHighlight = Highlight.extend({
  parseHTML() {
    return [
      { tag: "mark" },
      {
        tag: "span",
        getAttrs: (node) => (node instanceof HTMLElement && node.style.backgroundColor ? { color: node.style.backgroundColor } : false),
      },
    ];
  },
}).configure({ multicolor: true });

/** The editor schema: the same features as TrackVid's Quill toolbar. */
export function editorExtensions(): Extensions {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, history: { depth: 100 } }),
    Underline,
    QuillTextStyle,
    Color,
    QuillHighlight,
    FontFamily,
    QuillFontClass,
    FontSize,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    QuillAlignClass,
    Indent,
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: ["http", "https", "mailto"],
      validate: (href) => SAFE_LINK.test(href),
      HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
    }),
  ];
}

export const FONT_SIZES = [
  { label: "Small", value: "0.75em" },
  { label: "Normal", value: "" },
  { label: "Large", value: "1.5em" },
  { label: "Huge", value: "2.5em" },
] as const;

export const FONT_FAMILIES = [
  { label: "Sans Serif", value: "" },
  { label: "Serif", value: QL_FONTS.serif },
  { label: "Monospace", value: QL_FONTS.monospace },
] as const;
