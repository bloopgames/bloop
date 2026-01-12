import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";

const config: Config = {
  title: "Bloop",
  tagline: "Rewind game sessions and edit code live",
  favicon: "img/favicon.svg",

  future: {
    v4: true,
  },

  url: "https://trybloop.gg",
  baseUrl: "/docs/",

  organizationName: "bloopgames",
  projectName: "bloop",

  onBrokenLinks: "throw",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          routeBasePath: "/", // Docs at root of /docs/
          editUrl: "https://github.com/bloopgames/bloop/tree/main/docs/",
        },
        blog: false, // Disable blog for v0
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "Bloop",
      items: [
        {
          type: "docSidebar",
          sidebarId: "tutorialSidebar",
          position: "left",
          label: "Docs",
        },
        {
          href: "https://trybloop.gg/nu11/mario",
          label: "Demo",
          position: "left",
        },
        {
          href: "https://github.com/bloopgames/bloop",
          label: "GitHub",
          position: "right",
        },
        {
          href: "https://discord.gg/qQHZQeFYXF",
          label: "Discord",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            {
              label: "Getting Started",
              to: "/",
            },
          ],
        },
        {
          title: "Community",
          items: [
            {
              label: "Discord",
              href: "https://discord.gg/qQHZQeFYXF",
            },
            {
              label: "GitHub",
              href: "https://github.com/bloopgames/bloop",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Bloop. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
