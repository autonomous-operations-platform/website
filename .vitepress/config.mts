import { defineConfig } from "vitepress";
import { readdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getADRSidebarItems() {
  const adrDir = resolve(__dirname, "../docs/adrs");
  return readdirSync(adrDir)
    .filter((f: string) => /^\d/.test(f) && f.endsWith(".md"))
    .sort()
    .map((f: string) => {
      const slug = f.replace(/\.md$/, "");
      const match = slug.match(/^(\d+)/);
      const id = match ? `ADR-${match[1]}` : slug;
      const content = readFileSync(resolve(adrDir, f), "utf-8");
      const titleMatch = content.match(/^title:\s*(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : slug;
      return {
        text: `${id}: ${title}`,
        link: `/docs/adrs/${slug}`,
      };
    });
}

// https://vitepress.dev/reference/site-config
export default defineConfig({
  ignoreDeadLinks: [
    /^\.\/LICENSE$/,
    /^\.\/REUSE\.toml$/,
    /^\.\/AGENTS(\.md)?$/,
  ],
  title: "Autonomous Operations",
  head: [
    [
      "link",
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/assets/img/logo/autonomous-operations-icon-color.svg",
      },
    ],
  ],
  description: "Run your infrastructure autonomously.",
  lastUpdated: true,
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "Home", link: "/" },
      { text: "Documentation", link: "/docs/", activeMatch: "/docs/" },
    ],

    logo: {
      src: "/assets/img/logo/autonomous-operations-icon-color.svg",
      width: 24,
      height: 24,
    },

    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/autonomous-operations-platform",
      },
    ],

    sidebar: {
      "/docs/": [
        {
          text: "Introduction",
          collapsed: true,
          link: "/docs/introduction/",
          items: [
            { text: "Motivation", link: "/docs/introduction/motivation" },
            {
              text: "Design Principles",
              link: "/docs/introduction/principles",
            },
            { text: "Architecture", link: "/docs/introduction/architecture" },
            { text: "Core Components", link: "/docs/introduction/components" },
          ],
        },
        {
          text: "Adoption Guide",
          collapsed: true,
          link: "/docs/adoption/",
          items: [
            {
              text: "Satellite Instantiation",
              link: "/docs/adoption/satellite-instantiation",
            },
            {
              text: "Satellite Deployment",
              link: "/docs/adoption/satellite-deployment",
            },
          ],
        },
        {
          text: "Autonomous Operations Satellite",
          collapsed: true,
          link: "/docs/aos/",
          items: [
            { text: "Overview", link: "/docs/aos/overview" },
            { text: "Architecture", link: "/docs/aos/architecture" },
          ],
        },
        {
          text: "Analysis and Automation Platform",
          collapsed: true,
          link: "/docs/aap/",
        },
        {
          text: "Architecture Decision Records",
          collapsed: true,
          link: "/docs/adrs/",
          items: getADRSidebarItems(),
        },
      ],
    },
  },
});
