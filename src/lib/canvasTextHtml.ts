export function normalizeCanvasTextHtml(html: string): string {
  const trimmed = html.trim();
  return trimmed ? html : "<div>Text</div>";
}
