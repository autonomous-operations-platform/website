import { defineConfig } from "vitepress";

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
      { text: "Docs", link: "/docs/", activeMatch: "/docs/" },
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
            { text: "Architecture", link: "/docs/introduction/architecture" },
            { text: "Core Components", link: "/docs/introduction/components" },
            {
              text: "Design Principles",
              link: "/docs/introduction/principles",
            },
            { text: "Expected Outcomes", link: "/docs/introduction/outcomes" },
          ],
        },
      ],
    },
  },
});
