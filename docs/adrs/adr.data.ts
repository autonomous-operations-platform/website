import { createContentLoader } from "vitepress";

export interface ADREntry {
  id: string;
  title: string;
  status: string;
  date: string;
  url: string;
}

declare const data: ADREntry[];
export { data };

export default createContentLoader("docs/adrs/[0-9]*.md", {
  transform(rawData): ADREntry[] {
    return rawData
      .sort((a, b) => a.url.localeCompare(b.url))
      .map((page) => {
        const filename = page.url.split("/").pop() ?? "";
        const match = filename.match(/^(\d+)/);
        const id = match ? `ADR-${match[1]}` : filename;
        return {
          id,
          title: page.frontmatter.title ?? "",
          status: page.frontmatter.status ?? "",
          date: page.frontmatter.date instanceof Date
            ? page.frontmatter.date.toISOString().slice(0, 10)
            : String(page.frontmatter.date ?? ""),
          url: page.url,
        };
      });
  },
});
