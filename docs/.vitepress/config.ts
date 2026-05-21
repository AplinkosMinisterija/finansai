import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Finansai — dokumentacija',
  description:
    'Aplinkos ministerijos finansavimo prašymų sistemos architektūra, sprendimai ir diskusijų log',
  lang: 'lt-LT',
  base: '/docs/',
  cleanUrls: true,
  lastUpdated: true,
  outDir: '.vitepress/dist',

  // FVM darbo dokumentai (docs/fvm/) — vidinis CTO/komandos koordinavimo
  // turinys (master plan, iter brief'ai, ADR'ai). Skaitomi filesystem'e ir
  // per GitHub UI, bet ne publikuojami per VitePress dokų svetainę.
  // Skirta išvengti VitePress Vue-kompiliacijos klaidų dėl <placeholder>
  // šabloninių žymeklių brief'uose.
  srcExclude: ['fvm/**'],

  themeConfig: {
    siteTitle: 'Finansai',

    nav: [
      { text: 'Pradžia', link: '/' },
      { text: 'Architektūra', link: '/03-architektura' },
      { text: 'Implementacija', link: '/06-implementacijos-planas' },
      { text: 'Diskusijos', link: '/diskusijos' },
      { text: 'GitHub', link: 'https://github.com/AplinkosMinisterija/finansai' },
    ],

    sidebar: [
      {
        text: 'Pradžia',
        items: [{ text: 'Apžvalga', link: '/' }],
      },
      {
        text: 'Sprendimai (decision log)',
        collapsed: false,
        items: [
          { text: '01 — Kontekstas', link: '/01-kontekstas' },
          { text: '02 — MVP scope', link: '/02-mvp-scope' },
          { text: '03 — Architektūra', link: '/03-architektura' },
          { text: '04 — Vartotojų modelis', link: '/04-vartotoju-modelis' },
          { text: '05 — Prašymo modelis', link: '/05-prasymo-modelis' },
        ],
      },
      {
        text: 'Implementacija',
        collapsed: false,
        items: [
          { text: 'Planas (visos iteracijos)', link: '/06-implementacijos-planas' },
        ],
      },
      {
        text: 'Diskusijos',
        items: [{ text: 'Log', link: '/diskusijos' }],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/AplinkosMinisterija/finansai' },
    ],

    footer: {
      message: 'Finansai — vidinis įrankis',
      copyright: 'Aplinkos ministerija',
    },

    search: { provider: 'local' },

    outline: { label: 'Šiame puslapyje', level: [2, 3] },
    docFooter: { prev: 'Ankstesnis', next: 'Sekantis' },
    darkModeSwitchLabel: 'Tema',
    lightModeSwitchTitle: 'Šviesi tema',
    darkModeSwitchTitle: 'Tamsi tema',
    sidebarMenuLabel: 'Meniu',
    returnToTopLabel: 'Į viršų',
    externalLinkIcon: true,
    lastUpdatedText: 'Atnaujinta',
  },
});
