// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';
import starlightLinksValidator from 'starlight-links-validator';

const REPO = 'https://github.com/denex-io/denex-network-manager';

// Published as a GitHub Pages project site. Both values move together if the
// site ever gets a custom domain: set `site` to the domain and drop `base`.
export default defineConfig({
  site: 'https://denex-io.github.io',
  base: '/denex-network-manager',
  integrations: [
    // Must precede starlight: it claims ```mermaid blocks before Expressive Code
    // turns them into ordinary syntax-highlighted snippets.
    mermaid({ theme: 'default', autoTheme: true }),
    starlight({
      // Fails the build on broken internal links, which is how docs sites rot.
      plugins: [starlightLinksValidator()],
      title: 'denex-network-manager',
      description:
        'Testcontainers-style SDK and CLI for running Canton Network LocalNets from a single YAML file.',
      social: [
        { icon: 'github', label: 'GitHub', href: REPO },
        {
          icon: 'npm',
          label: 'npm',
          href: 'https://www.npmjs.com/package/@denex/network-manager',
        },
      ],
      editLink: { baseUrl: `${REPO}/edit/main/site/` },
      lastUpdated: true,
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { label: 'Introduction', slug: 'index' },
            { label: 'Installation', slug: 'start/installation' },
            { label: 'Quick start', slug: 'start/quick-start' },
            { label: 'Web UIs and credentials', slug: 'start/web-uis' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Using the SDK', slug: 'guides/sdk' },
            { label: 'Building a dev stack', slug: 'guides/dev-stack' },
            { label: 'Discovery server', slug: 'guides/discovery' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI', slug: 'reference/cli' },
            { label: 'Configuration', slug: 'reference/configuration' },
            { label: 'Port allocation', slug: 'reference/ports' },
          ],
        },
        {
          label: 'How it works',
          items: [{ label: 'Architecture', slug: 'how-it-works/architecture' }],
        },
        {
          label: 'Help',
          items: [
            { label: 'Troubleshooting', slug: 'help/troubleshooting' },
            { label: 'Changelog', slug: 'help/changelog' },
          ],
        },
      ],
    }),
  ],
});
