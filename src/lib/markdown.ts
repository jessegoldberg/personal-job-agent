import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: false,
});

export async function markdownToHtml(markdown: string): Promise<string> {
  return marked.parse(markdown) as Promise<string>;
}