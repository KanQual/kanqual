import DOMPurify from "dompurify";

const BLOCK_TEXT_SELECTOR = "address,article,aside,blockquote,div,footer,h1,h2,h3,h4,h5,h6,header,li,main,nav,p,section";

export function sanitizeRichTextHtml(value: string): string {
  return DOMPurify.sanitize(value, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style"],
    FORBID_ATTR: ["style"],
  });
}

export function sanitizeSvgMarkup(value: string): string {
  return DOMPurify.sanitize(value, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}

export function richTextHtmlToPlainText(value: string): string {
  if (!value) return "";

  const doc = new DOMParser().parseFromString(sanitizeRichTextHtml(value), "text/html");
  for (const breakNode of Array.from(doc.body.querySelectorAll("br"))) {
    breakNode.replaceWith(doc.createTextNode("\n"));
  }
  for (const blockNode of Array.from(doc.body.querySelectorAll(BLOCK_TEXT_SELECTOR))) {
    blockNode.append(doc.createTextNode("\n"));
  }

  return (doc.body.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
