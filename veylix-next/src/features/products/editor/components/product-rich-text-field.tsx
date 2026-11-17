// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import {
  htmlToPlainText,
  sanitizeProductRichText,
} from "@/features/products/editor/lib/rich-text";

export function ProductRichTextField({ value, onChange }) {
  const n = useRef(null);
  const [r, i] = useState(false);
  const [a, o] = useState(value);
  useEffect(() => {
    if (
      !r &&
      n.current &&
      document.activeElement !== n.current &&
      n.current.innerHTML !== value
    ) {
      n.current.innerHTML = value;
    }
    if (!r) {
      o(value);
    }
  }, [value, r]);
  const s = () => {
    const e = sanitizeProductRichText(n.current?.innerHTML || "");
    onChange(e);
    o(e);
  };
  const c = (e, t) => {
    n.current?.focus();
    document.execCommand(e, false, t);
    s();
  };
  return (
    <div className="product-rich-field span-full">
      <div className="product-rich-label">
        <span>Description</span>
        <small>
          Rich storefront content with formatting and HTML source access.
        </small>
      </div>
      <input type="hidden" name="descriptionHtml" value={value} readOnly />
      <div className="product-rich-editor" data-rich-editor>
        <div
          className="product-rich-toolbar"
          role="toolbar"
          aria-label="Description formatting"
        >
          <select
            aria-label="Text style"
            defaultValue="p"
            onChange={(e) => c("formatBlock", e.target.value)}
          >
            <option value="p">Paragraph</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
            <option value="blockquote">Quote</option>
          </select>
          <button type="button" onClick={() => c("bold")} aria-label="Bold">
            <strong>B</strong>
          </button>
          <button type="button" onClick={() => c("italic")} aria-label="Italic">
            <em>I</em>
          </button>
          <button
            type="button"
            onClick={() => c("underline")}
            aria-label="Underline"
          >
            <u>U</u>
          </button>
          <button
            type="button"
            onClick={() => c("insertUnorderedList")}
            aria-label="Bulleted list"
          >
            • List
          </button>
          <button
            type="button"
            onClick={() => c("insertOrderedList")}
            aria-label="Numbered list"
          >
            1. List
          </button>
          <button
            type="button"
            onClick={() => c("justifyLeft")}
            aria-label="Align left"
          >
            Left
          </button>
          <button
            type="button"
            onClick={() => c("justifyCenter")}
            aria-label="Align center"
          >
            Center
          </button>
          <button
            type="button"
            onClick={() => {
              const e = window.prompt("Enter a link URL");
              if (e) {
                c("createLink", e);
              }
            }}
            aria-label="Add link"
          >
            Link
          </button>
          <button
            type="button"
            onClick={() => c("removeFormat")}
            aria-label="Clear formatting"
          >
            Clear
          </button>
          <button
            type="button"
            className="product-rich-source-toggle"
            onClick={() => {
              if (!r) {
                s();
                i(true);
                return;
              }
              const e = sanitizeProductRichText(a);
              onChange(e);
              o(e);
              i(false);
              requestAnimationFrame(() => {
                if (n.current) {
                  n.current.innerHTML = e;
                }
              });
            }}
          >
            {r ? "Visual Editor" : "HTML Source"}
          </button>
        </div>
        <div
          ref={n}
          className="product-rich-canvas"
          contentEditable={!r}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Product description"
          hidden={r}
          onInput={s}
          onBlur={s}
        />
        <textarea
          className="product-rich-source"
          rows={12}
          hidden={!r}
          aria-label="Product description HTML source"
          value={a}
          onChange={(e) => o(e.target.value)}
        />
        <div className="product-rich-footer">
          <span>
            Use headings, lists and links to structure detailed product content.
          </span>
          <strong>
            {htmlToPlainText(value).length}
            {" characters"}
          </strong>
        </div>
      </div>
    </div>
  );
}
