import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";
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
const config = withMermaid(
  defineConfig({
    vite: {
      optimizeDeps: {
        include: [
          "fastdom",
          "fastdom/extensions/fastdom-promised.js",
          "cytoscape-fcose",
          "dayjs/plugin/duration",
        ],
      },
    },
    ignoreDeadLinks: [
      /^\.\/LICENSE$/,
      /^\.\/REUSE\.toml$/,
      /^\.\/AGENTS(\.md)?$/,
      /^\.\/outcomes$/,
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
              {
                text: "Core Components",
                link: "/docs/introduction/components",
              },
            ],
          },
          {
            text: "Adoption Guide",
            collapsed: true,
            link: "/docs/adoption/",
            items: [
              {
                text: "Build Your Own Satellite",
                link: "/docs/adoption/build-your-own-satellite",
              },
              {
                text: "How To Deploy",
                link: "/docs/adoption/how-to-deploy",
              },
            ],
          },
          {
            text: "Autonomous Operations Satellite",
            collapsed: true,
            link: "/docs/aos/",
            items: [
              { text: "Overview", link: "/docs/aos/overview" },
              {
                text: "Design Principles",
                link: "/docs/aos/design-principles",
              },
              {
                text: "Architecture",
                collapsed: true,
                link: "/docs/aos/architecture",
                items: [
                  {
                    text: "Collectors",
                    link: "/docs/aos/architecture/collector",
                  },
                  {
                    text: "Observers",
                    link: "/docs/aos/architecture/observer",
                  },
                  {
                    text: "Operators",
                    link: "/docs/aos/architecture/operator",
                  },
                  {
                    text: "Satellite Record Store",
                    link: "/docs/aos/architecture/srs",
                  },
                ],
              },
              {
                text: "OCM Bundle",
                link: "/docs/aos/aos-ocm-bundle",
              },
            ],
          },
          {
            text: "Analysis and Automation Platform",
            collapsed: true,
            link: "/docs/aap/",
          },
        ],
      },
    },
  }),
);

export default config;
