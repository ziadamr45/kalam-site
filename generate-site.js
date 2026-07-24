// dotenv is optional: locally it loads .env, on Vercel env vars are injected directly.
try {
  require('dotenv').config();
} catch (_) {}

const { Client } = require('@notionhq/client');
const { NotionToMarkdown } = require('notion-to-md');
const { marked } = require('marked');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

if (!process.env.NOTION_TOKEN || !process.env.NOTION_DATABASE_ID) {
  console.error('❌ Environment variables NOTION_TOKEN and NOTION_DATABASE_ID are required.');
  process.exit(1);
}

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });
const DB_ID = process.env.NOTION_DATABASE_ID;

// Production base URL (used for canonical, sitemap, RSS, OG)
const SITE_URL = (process.env.SITE_URL || 'https://kalaam-site.vercel.app').replace(/\/$/, '');

// ── i18n: load locale strings ────────────────────────────────────────────────
const LOCALES = {
  ar: JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', 'ar.json'), 'utf8')),
  en: JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', 'en.json'), 'utf8')),
};
// Deep getter: t('ar', 'article.readingTime', { n: 5 }) → "٥ دقايق قراءة"
function t(lang, key, params) {
  const parts = key.split('.');
  let v = LOCALES[lang];
  for (const p of parts) {
    if (v && typeof v === 'object' && p in v) v = v[p];
    else { v = undefined; break; }
  }
  if (typeof v !== 'string') return '';
  if (params) {
    for (const k of Object.keys(params)) {
      v = v.replace(new RegExp('\\{' + k + '\\}', 'g'), String(params[k]));
    }
  }
  return v;
}
// Format a number in the language's preferred digits (Arabic pages get Arabic-Indic digits)
function fmtNum(lang, n) {
  if (lang === 'ar') return toArabicDigits(n);
  return String(n);
}
// Localized category name (maps Arabic category → English equivalent on /en pages)
function localizeTag(lang, tag) {
  if (!tag) return '';
  if (lang === 'ar') return tag;
  return t('en', 'categories.' + tag) || tag;
}
// Localized level label
function localizeLevel(lang, level) {
  if (!level) return '';
  if (lang === 'ar') return level;
  return t('en', 'levels.' + level) || level;
}
// Localized date (e.g. "January 5, 2025" for EN, "٥ يناير ٢٠٢٥" for AR)
function localizeDate(lang, date) {
  const d = new Date(date);
  if (lang === 'en') {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ── helpers ──────────────────────────────────────────────────────────────────
function readingTime(html) {
  const words = html.replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}
function toArabicDigits(n) {
  return String(n).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
}
function escAttr(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escXml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function slugifyArabicTag(tag) {
  // Simple slugify for category URLs — keep arabic if it's arabic, else lowercase-hyphen
  return String(tag || '').trim().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\u0600-\u06FFa-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'uncategorized';
}
function isoDate(d) {
  return new Date(d).toISOString();
}

// ── Read CSS source ───────────────────────────────────────────────────────────
const CSS_SOURCE = fs.readFileSync(path.join(__dirname, 'src', 'style.css'), 'utf8');

// ── Inline SVG icons (no external libs) ───────────────────────────────────────
const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  sun:    '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
  moon:   '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  list:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.66.15-.2.3-.76.97-.93 1.17-.17.2-.34.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.34.44-.51.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.66-1.6-.9-2.19-.24-.58-.48-.5-.66-.5h-.56c-.2 0-.52.07-.79.37-.27.3-1.04 1.01-1.04 2.47 0 1.46 1.06 2.87 1.21 3.07.15.2 2.1 3.2 5.07 4.49.71.3 1.26.49 1.69.62.71.23 1.35.2 1.86.12.57-.08 1.76-.72 2-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35z"/><path d="M12 2a10 10 0 0 0-8.65 15l-1.35 4.93 5.05-1.32A10 10 0 1 0 12 2zm0 18.13a8.13 8.13 0 0 1-4.15-1.14l-.3-.18-3.05.8.82-2.98-.2-.31A8.13 8.13 0 1 1 12 20.13z"/></svg>',
  x:      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25h6.83l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  telegram: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.94 4.6 18.9 19.05c-.23 1.01-.83 1.26-1.68.79l-4.64-3.42-2.24 2.16c-.25.25-.46.46-.94.46l.33-4.73 8.62-7.79c.37-.33-.08-.52-.58-.19L6.21 13.18l-4.59-1.43c-1-.31-1.02-1 .21-1.48l17.92-6.91c.83-.31 1.56.2 1.19 1.24z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.93-1.95 1.88v2.28h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z"/></svg>',
  copy:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  bookmarkFilled: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  teacher: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>',
  copyText: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  tashkeel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V8a3 3 0 0 1 6 0v11M4 14h6M14 19V8a3 3 0 0 1 6 0v11M14 14h6"/><circle cx="7" cy="5" r="0.8" fill="currentColor"/><circle cx="17" cy="5" r="0.8" fill="currentColor"/></svg>',
  printer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
  check:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  xMark:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  play:   '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
};

// ── Language switcher icon (globe) ────────────────────────────────────────────
const ICON_GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

// ── HTML shell ────────────────────────────────────────────────────────────────
// lang: 'ar' | 'en' — drives <html lang/dir>, fonts, UI strings, header, footer, search
// depth: 0 = root, 1 = subdirectory, 2 = /en/articles/ (two levels deep)
// langSwitchHref: where the language switcher button links to
// alternateHref: canonical URL of the opposite-language equivalent (for hreflang)
// rssHref: RSS feed URL for this language
function shell({ title, metaDesc, body, depth = 0, head = '', canonical = '', ogImage = '', jsonLd = '', lang = 'ar', langSwitchHref = '', alternateHref = '', rssHref = '' }) {
  const cssHref = depth === 0 ? 'css/style.css' : (depth === 1 ? '../css/style.css' : '../../css/style.css');
  const homeHref = depth === 0 ? '/' : (depth === 1 ? '../' : '../../');
  const rootPath = depth === 0 ? '' : (depth === 1 ? '../' : '../../');
  const locale = LOCALES[lang];
  const YEAR = fmtNum(lang, new Date().getFullYear());

  // Font preloads — luxury design uses NotoArabic TTF for Arabic; Inter+Source Serif 4 for English
  const fontPreloads = lang === 'ar'
    ? `<link rel="preload" href="/fonts/NotoArabic-Regular.ttf" as="font" type="font/ttf" crossorigin>
  <link rel="preload" href="/fonts/NotoArabic-Bold.ttf" as="font" type="font/ttf" crossorigin>`
    : `<link rel="preload" href="/fonts/inter-la.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/source-serif-4-la.woff2" as="font" type="font/woff2" crossorigin>`;

  const canonicalTag = canonical ? `<link rel="canonical" href="${canonical}">` : '';
  // hreflang alternate tags (bidirectional: ar ↔ en)
  // x-default always points to the Arabic (primary language) URL
  const hreflangTags = (alternateHref && canonical)
    ? `<link rel="alternate" hreflang="${lang === 'ar' ? 'ar' : 'en'}" href="${canonical}">
  <link rel="alternate" hreflang="${lang === 'ar' ? 'en' : 'ar'}" href="${alternateHref}">
  <link rel="alternate" hreflang="x-default" href="${lang === 'ar' ? canonical : alternateHref}">`
    : '';
  const ogImageTag = ogImage ? `<meta property="og:image" content="${ogImage}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${ogImage}">` : '';
  const jsonLdTag = jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : '';
  const analyticsScript = process.env.VERCEL_ANALYTICS_ID
    ? `<script defer src="/_vercel/insights/script.js" data-ve-analytics-id="${process.env.VERCEL_ANALYTICS_ID}"></script>`
    : `<script defer src="/_vercel/insights/script.js"></script>`;

  // Language switcher — links to opposite-language equivalent
  const langSwitchHtml = langSwitchHref
    ? `<a class="lang-switch" href="${langSwitchHref}" aria-label="${escAttr(t(lang, 'nav.langSwitchAria'))}"><span class="lang-globe" aria-hidden="true">${ICON_GLOBE}</span><span class="lang-text-long">${t(lang, 'nav.langSwitchTo')}</span><span class="lang-text-short">${t(lang, 'nav.langSwitchTo').slice(0, 2)}</span></a>`
    : '';

  // RSS feed link
  const rssLink = rssHref || (lang === 'ar' ? `${SITE_URL}/feed.xml` : `${SITE_URL}/en/rss.xml`);

  // Favicon — Arabic "ك" or English "K" depending on language
  const faviconChar = lang === 'ar' ? 'ك' : 'K';
  const faviconFont = lang === 'ar' ? 'serif' : 'serif';

  return `<!DOCTYPE html>
<html lang="${locale.html.lang}" dir="${locale.html.dir}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${escAttr(metaDesc)}">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(metaDesc)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="${locale.html.locale}">
<meta name="theme-color" content="#f4f0e8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1a1d1b" media="(prefers-color-scheme: dark)">
${ogImageTag}
${canonicalTag}
${hreflangTags}
${fontPreloads}
<link rel="stylesheet" href="${cssHref}">
<link rel="alternate" type="application/rss+xml" title="${escAttr(t(lang, 'site.name'))}" href="${rssLink}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%23123e32'/><text x='50' y='72' font-size='62' text-anchor='middle' fill='white' font-family='serif'>${faviconChar}</text></svg>">
${jsonLdTag}
${head}
</head>
<body>
<a class="skip-link" href="#main">${t(lang, 'nav.skipToContent')}</a>
<div id="progress" aria-hidden="true"></div>
<div class="topline"></div>
<header class="site-header">
  <div class="container nav">
    <a class="brand" href="${homeHref}" aria-label="${escAttr(t(lang, 'nav.brandAria'))}">
      <span class="brand-seal" aria-hidden="true">${lang === 'ar' ? 'ك' : 'K'}</span>
      <span class="brand-copy">${t(lang, 'site.name')}<small>${t(lang, 'site.tagline')}</small></span>
    </a>
    <nav class="nav-links">
      <a href="${homeHref}#articles">${t(lang, 'home.articles')}</a>
      <a href="${homeHref}#values">${t(lang, 'home.values')}</a>
      <a href="${homeHref}#about">${t(lang, 'nav.about')}</a>
    </nav>
    <div class="nav-actions">
      <button class="icon-btn" id="search-btn" aria-label="${escAttr(t(lang, 'nav.search'))}" type="button">${ICONS.search}</button>
      ${langSwitchHtml}
      <button class="icon-btn" id="theme-btn" aria-label="${escAttr(t(lang, 'nav.themeToggle'))}" type="button">${ICONS.sun}${ICONS.moon}</button>
    </div>
  </div>
</header>
<main id="main">${body}</main>
<footer class="site-footer" id="about">
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">${t(lang, 'site.name')}<p>${t(lang, 'footer.tagline')} · ${t(lang, 'footer.authorName')}</p></div>
      <div class="footer-links">
        <a href="${homeHref}">${t(lang, 'nav.home')}</a>
        <a href="${homeHref}#articles">${t(lang, 'home.articles')}</a>
        <a href="https://ziadamrme.vercel.app" target="_blank" rel="noopener">${t(lang, 'nav.personalSite')} ↗</a>
      </div>
    </div>
    <div class="copyright">© ${YEAR} ${t(lang, 'site.name')} — ${t(lang, 'footer.rights', { year: YEAR })}</div>
  </div>
</footer>

<!-- Search modal -->
<div class="search-overlay" id="search-overlay" role="dialog" aria-modal="true" aria-label="${escAttr(t(lang, 'nav.searchDialogLabel'))}">
  <div class="search-box">
    <div class="search-input-wrap">
      ${ICONS.search}
      <input class="search-input" id="search-input" type="search" placeholder="${escAttr(t(lang, 'search.placeholder'))}" autocomplete="off">
      <button class="search-close" id="search-close" aria-label="${escAttr(t(lang, 'search.close'))}">×</button>
    </div>
    <div class="search-results" id="search-results"></div>
    <div class="search-hint">${t(lang, 'search.hint')}</div>
  </div>
</div>

<script>window.SITE_BASE='${rootPath}';window.SITE_LANG='${lang}';window.SITE_I18N=${JSON.stringify({
  ar: {
    searchLoading: t('ar', 'search.loading'),
    searchNoResults: t('ar', 'search.noResults'),
    like: t('ar', 'engagement.like'),
    liked: t('ar', 'engagement.liked'),
    thanksForLike: t('ar', 'engagement.thanksForLike'),
    alreadyLiked: t('ar', 'engagement.alreadyLiked'),
    rateLimited: t('ar', 'engagement.rateLimited'),
    likeError: t('ar', 'engagement.likeError'),
    noLikes: t('ar', 'engagement.noLikes'),
    likesCount: t('ar', 'engagement.likesCount').replace('{n}', '').trim(),
    publishing: t('ar', 'engagement.publishing'),
    publishComment: t('ar', 'engagement.publishComment'),
    commentError: t('ar', 'engagement.commentError'),
    noComments: t('ar', 'engagement.noComments'),
    guest: t('ar', 'engagement.guest'),
    now: t('ar', 'engagement.now'),
    minutesAgo: t('ar', 'engagement.minutesAgo'),
    hoursAgo: t('ar', 'engagement.hoursAgo'),
    daysAgo: t('ar', 'engagement.daysAgo'),
    bookmark: t('ar', 'article.bookmark'),
    bookmarked: t('ar', 'article.bookmarked'),
    clearAll: t('ar', 'home.clearAll'),
    clearAllConfirm: t('ar', 'home.clearAllConfirm'),
    copyTextDone: t('ar', 'article.copyTextDone'),
    answerCorrect: t('ar', 'article.answerCorrect'),
    answerWrong: t('ar', 'article.answerWrong'),
    saved: t('ar', 'card.saved'),
    readArticle: t('ar', 'card.readArticle'),
  },
  en: {
    searchLoading: t('en', 'search.loading'),
    searchNoResults: t('en', 'search.noResults'),
    like: t('en', 'engagement.like'),
    liked: t('en', 'engagement.liked'),
    thanksForLike: t('en', 'engagement.thanksForLike'),
    alreadyLiked: t('en', 'engagement.alreadyLiked'),
    rateLimited: t('en', 'engagement.rateLimited'),
    likeError: t('en', 'engagement.likeError'),
    noLikes: t('en', 'engagement.noLikes'),
    likesCount: t('en', 'engagement.likesCount').replace('{n}', '').trim(),
    publishing: t('en', 'engagement.publishing'),
    publishComment: t('en', 'engagement.publishComment'),
    commentError: t('en', 'engagement.commentError'),
    noComments: t('en', 'engagement.noComments'),
    guest: t('en', 'engagement.guest'),
    now: t('en', 'engagement.now'),
    minutesAgo: t('en', 'engagement.minutesAgo'),
    hoursAgo: t('en', 'engagement.hoursAgo'),
    daysAgo: t('en', 'engagement.daysAgo'),
    bookmark: t('en', 'article.bookmark'),
    bookmarked: t('en', 'article.bookmarked'),
    clearAll: t('en', 'home.clearAll'),
    clearAllConfirm: t('en', 'home.clearAllConfirm'),
    copyTextDone: t('en', 'article.copyTextDone'),
    answerCorrect: t('en', 'article.answerCorrect'),
    answerWrong: t('en', 'article.answerWrong'),
    saved: t('en', 'card.saved'),
    readArticle: t('en', 'card.readArticle'),
  },
})};</script>
<script src="${rootPath}js/app.js" defer></script>
<script>
(function(){var b=document.getElementById("progress");window.addEventListener("scroll",function(){var h=document.documentElement,m=h.scrollHeight-h.clientHeight;b.style.width=(m>0?(h.scrollTop/m)*100:0)+"%";},{passive:true});})();
</script>
${analyticsScript}
</body>
</html>`;
}

// ── Article card (luxury "article-row" style) ────────────────────────────────
// Used on category pages (still as rows like the home list)
function card(a, depth = 0, lang = 'ar') {
  const articleBase = 'articles/';
  const catBase = 'category/';
  const cardHref = depth === 0 ? `${articleBase}${a.slug}` : a.slug;
  const tagDisplay = localizeTag(lang, a.tag);
  const minutesLabel = t(lang, 'card.minutesShort', { n: fmtNum(lang, a.readingTime) });
  const title = (lang === 'en' && a.titleEn) ? a.titleEn : a.title;
  const excerpt = (lang === 'en' && a.excerptEn) ? a.excerptEn : a.excerpt;
  // Use sequential numbers like the design (٠١, ٠٢, ...)
  const num = (depth === 0) ? fmtNum(lang, 1 + (a._idx || 0)).padStart(2, '0') : '';
  return `<a class="article-row" href="${cardHref}" data-slug="${escAttr(a.slug)}">
  <span class="article-no">${num}</span>
  <div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(excerpt)}</p>
  </div>
  <span class="article-arrow" aria-hidden="true">${t(lang, 'card.readArrow')}</span>
</a>`;
}

// ── Index page (luxury homepage: hero + manifesto + featured + article-list + values) ──
function buildIndex(articles, lang = 'ar') {
  const shown = lang === 'en' ? articles.filter(a => a.translated) : articles;
  // Featured = first (newest) article; rest become article-list rows
  const featured = shown[0] || null;
  const rest = shown.slice(1);
  // Add _idx for sequential numbering
  shown.forEach((a, i) => { a._idx = i; });

  // Featured article card
  const featuredTitle = featured ? ((lang === 'en' && featured.titleEn) ? featured.titleEn : featured.title) : '';
  const featuredExcerpt = featured ? ((lang === 'en' && featured.excerptEn) ? featured.excerptEn : featured.excerpt) : '';
  const featuredTag = featured ? localizeTag(lang, featured.tag) : '';
  const featuredMinutes = featured ? t(lang, 'card.minutesShort', { n: fmtNum(lang, featured.readingTime) }) : '';
  const featuredHref = featured ? `articles/${featured.slug}` : '';
  const featuredHtml = featured ? `
  <article class="featured">
    <div class="featured-copy">
      <div class="meta"><span>${escapeHtml(featuredTag)}</span><span class="dot"></span><span>${featuredMinutes}</span></div>
      <h3>${escapeHtml(featuredTitle)}</h3>
      <p>${escapeHtml(featuredExcerpt)}</p>
      <a class="read-link" href="${featuredHref}">${t(lang, 'home.featuredReadFull')} <span aria-hidden="true">${t(lang, 'card.readArrow')}</span></a>
    </div>
    <a class="featured-visual" href="${featuredHref}" aria-label="${escAttr(featuredTitle)}"></a>
  </article>` : '';

  // Rest of articles as article-rows
  const restHtml = rest.map(a => card(a, 0, lang)).join('\n');

  // Total reading time
  const totalMinutes = shown.reduce((s, a) => s + a.readingTime, 0);
  const readingsCount = t(lang, 'home.threeReadings', { n: fmtNum(lang, shown.length), m: fmtNum(lang, totalMinutes) });

  // Bookmarks section (hidden by default, populated by JS if any)
  const bookmarksSection = `
  <section class="bookmarks-section" id="bookmarks-section" hidden aria-label="${escAttr(t(lang, 'home.yourBookmarks'))}">
    <div class="container">
      <div class="section-head">
        <h2>${t(lang, 'home.yourBookmarks')}</h2>
        <button class="bm-clear" id="bm-clear" type="button" aria-label="${escAttr(t(lang, 'home.clearAll'))}">${t(lang, 'home.clearAll')}</button>
      </div>
      <div class="bookmarks-grid" id="bookmarks-grid"></div>
    </div>
  </section>`;

  const body = `
  <section class="hero">
    <div class="container hero-grid">
      <div>
        <div class="eyebrow">${t(lang, 'home.eyebrowMagazine')}</div>
        <h1>${t(lang, 'home.heroEm1')}<em>${t(lang, 'home.heroEm2')}</em></h1>
        <p class="hero-lead">${t(lang, 'home.heroLead')}</p>
        <div class="hero-actions">
          <a class="primary-btn" href="#articles">${t(lang, 'home.discoverArticles')} <span aria-hidden="true">${t(lang, 'card.readArrow')}</span></a>
          <a class="quiet-link" href="#about">${t(lang, 'home.knowStory')}</a>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="arch"></div>
        <div class="gold-orbit"></div>
      </div>
    </div>
  </section>

  <section class="manifesto">
    <div class="container manifesto-row">
      <span class="manifesto-mark" aria-hidden="true">${t(lang, 'home.manifestoMark')}</span>
      <p>${t(lang, 'home.manifestoText')}</p>
      <small>${t(lang, 'home.manifestoAttrib')}</small>
    </div>
  </section>

  ${bookmarksSection}

  <section class="section" id="articles">
    <div class="container">
      <div class="section-head">
        <div>
          <div class="eyebrow">${t(lang, 'home.eyebrowSelection')}</div>
          <h2>${t(lang, 'home.latestSection')}</h2>
        </div>
        <p>${readingsCount}</p>
      </div>
      ${featuredHtml}
      <div class="article-list">
${restHtml}
      </div>
    </div>
  </section>

  <section class="values" id="values">
    <div class="container">
      <div class="section-head">
        <div>
          <div class="eyebrow">${t(lang, 'home.eyebrowValues')}</div>
          <h2>${t(lang, 'home.valuesTitle')}</h2>
        </div>
      </div>
      <div class="values-grid">
        <div class="value"><span aria-hidden="true">✦</span><h3>${t(lang, 'home.value1Title')}</h3><p>${t(lang, 'home.value1Text')}</p></div>
        <div class="value"><span aria-hidden="true">◌</span><h3>${t(lang, 'home.value2Title')}</h3><p>${t(lang, 'home.value2Text')}</p></div>
        <div class="value"><span aria-hidden="true">۞</span><h3>${t(lang, 'home.value3Title')}</h3><p>${t(lang, 'home.value3Text')}</p></div>
      </div>
    </div>
  </section>`;

  return shell({
    title: t(lang, 'home.title'),
    metaDesc: t(lang, 'home.metaDesc'),
    body,
    depth: lang === 'en' ? 1 : 0,
    lang,
    canonical: lang === 'en' ? `${SITE_URL}/en/` : `${SITE_URL}/`,
    alternateHref: lang === 'en' ? `${SITE_URL}/` : `${SITE_URL}/en/`,
    langSwitchHref: lang === 'en' ? '/' : '/en/',
    ogImage: `${SITE_URL}/og-default.svg`,
  });
}

// ── /start page ──────────────────────────────────────────────────────────────
function buildStart(articles, lang = 'ar') {
  // For EN, only consider translated articles for the "featured" pick
  const candidates = lang === 'en' ? articles.filter(a => a.translated) : articles;
  const featured = candidates[0];
  const featuredHref = featured ? (lang === 'en' ? `articles/${featured.slug}` : `articles/${featured.slug}`) : '';
  const heroQuote = t(lang, 'home.heroQuote');
  const featuredTitle = lang === 'en' && featured ? featured.titleEn : (featured ? featured.title : '');
  const nums = lang === 'ar' ? ['١', '٢', '٣', '٤'] : ['1', '2', '3', '4'];
  const body = `
  <div class="start-hero">
    <span class="hero-quote" aria-hidden="true">${heroQuote}</span>
    <h1>${t(lang, 'start.title')}</h1>
    <p class="tag">${t(lang, 'start.tag')}</p>
    <div class="orn-line" aria-hidden="true">✦</div>
  </div>
  <div class="wrap start-wrap">
    <section class="start-section">
      <span class="start-num" aria-hidden="true">${nums[0]}</span>
      <div>
        <h2>${t(lang, 'start.h1_1')}</h2>
        <p>${t(lang, 'start.p1_1')}</p>
      </div>
    </section>
    <section class="start-section">
      <span class="start-num" aria-hidden="true">${nums[1]}</span>
      <div>
        <h2>${t(lang, 'start.h1_2')}</h2>
        <p>${t(lang, 'start.p1_2')}</p>
      </div>
    </section>
    <section class="start-section">
      <span class="start-num" aria-hidden="true">${nums[2]}</span>
      <div>
        <h2>${t(lang, 'start.h1_3')}</h2>
        <p>${t(lang, 'start.p1_3')}</p>
      </div>
    </section>
    <section class="start-section">
      <span class="start-num" aria-hidden="true">${nums[3]}</span>
      <div>
        <h2>${t(lang, 'start.h1_4')}</h2>
        <p>${t(lang, 'start.p1_4')}</p>
      </div>
    </section>
    <div class="orn" aria-hidden="true">✦</div>
    ${featured ? `<a class="start-cta" href="${featuredHref}">${t(lang, 'start.featuredCta', { title: escapeHtml(featuredTitle) })}</a>` : ''}
    <p style="text-align:center;color:var(--muted);font-size:15px;margin-top:32px">${t(lang, 'start.browseAll')}</p>
  </div>`;
  return shell({
    title: t(lang, 'start.htmlTitle'),
    metaDesc: t(lang, 'start.metaDesc'),
    body,
    depth: lang === 'en' ? 1 : 0,
    lang,
    canonical: lang === 'en' ? `${SITE_URL}/en/start` : `${SITE_URL}/start`,
    alternateHref: lang === 'en' ? `${SITE_URL}/start` : `${SITE_URL}/en/start`,
    langSwitchHref: lang === 'en' ? '/start' : '/en/start',
    ogImage: `${SITE_URL}/og-default.svg`,
  });
}

// ── Level badge helper ───────────────────────────────────────────────────────
const LEVEL_META = {
  'مبتدئ':  { cls: 'lvl-beg',  label: 'مبتدئ',  labelEn: 'Beginner',    icon: '🟢' },
  'متوسط':  { cls: 'lvl-mid',  label: 'متوسط',  labelEn: 'Intermediate', icon: '🟡' },
  'متقدم':  { cls: 'lvl-adv',  label: 'متقدم',  labelEn: 'Advanced',    icon: '🔴' },
};
function levelBadge(level, lang = 'ar') {
  if (!level) return '';
  const m = LEVEL_META[level];
  if (!m) return '';
  const label = lang === 'en' ? m.labelEn : m.label;
  return `<span class="level-badge ${m.cls}" aria-label="${lang === 'en' ? 'Level' : 'المستوى'}: ${label}">${label}</span>`;
}

// ── Article page ──────────────────────────────────────────────────────────────
// lang: 'ar' | 'en' — drives UI strings, fonts, paths, JSON-LD inLanguage
// For EN: uses a.titleEn, a.excerptEn, a.englishHtml; hides tashkeel + exercises
function buildArticle(a, allArticles, lang = 'ar') {
  const isEn = lang === 'en';
  const title = isEn ? (a.titleEn || a.title) : a.title;
  const excerpt = isEn ? (a.excerptEn || a.excerpt) : a.excerpt;
  const bodyHtml = isEn ? (a.englishHtml || a.mainHtml) : a.mainHtml;
  const plainText = isEn ? (a.englishPlainText || a.plainText) : a.plainText;
  const articleDepth = isEn ? 2 : 1; // /en/articles/ is one level deeper
  const articleUrlBase = isEn ? `${SITE_URL}/en/articles/${a.slug}` : `${SITE_URL}/articles/${a.slug}`;
  const alternateUrl = isEn ? `${SITE_URL}/articles/${a.slug}` : `${SITE_URL}/en/articles/${a.slug}`;
  // Relative paths within article page
  const backHref = isEn ? '../' : '../'; // both go up one level to home (/en/ or /)
  const categoryHref = isEn ? `../category/${a.categorySlug}` : `../category/${a.categorySlug}`;
  const articleRelBase = ''; // sibling articles are at ./{slug}

  // For EN, only consider translated articles for prev/next + others
  const candidateArticles = isEn ? allArticles.filter(x => x.translated) : allArticles;
  const idx = candidateArticles.findIndex(x => x.slug === a.slug);
  const prev = idx > 0 ? candidateArticles[idx - 1] : null;
  const next = idx < candidateArticles.length - 1 ? candidateArticles[idx + 1] : null;
  const others = candidateArticles.filter(x => x.slug !== a.slug).slice(0, 2);
  const otherCards = others.map(x => card(x, isEn ? 2 : 1, lang)).join('\n');

  // TOC if 4+ h2s (in body only)
  const h2Matches = [...bodyHtml.matchAll(/<h2>([^<]+)<\/h2>/g)];
  let tocHtml = '';
  if (h2Matches.length >= 4) {
    const items = h2Matches.map((m, i) => {
      const id = `s${i + 1}`;
      return `<li><a href="#${id}">${m[1]}</a></li>`;
    }).join('');
    tocHtml = `<nav class="toc" aria-label="${escAttr(t(lang, 'article.contents'))}">
      <div class="toc-title">${ICONS.list}<span>${t(lang, 'article.contents')}</span></div>
      <ul class="toc-list">${items}</ul>
    </nav>`;
    let i = 0;
    a._tocInjectedBody = bodyHtml.replace(/<h2>([^<]+)<\/h2>/g, (match, txt) => {
      i++;
      return `<h2 id="s${i}">${txt}</h2>`;
    });
  } else {
    a._tocInjectedBody = bodyHtml;
  }
  const renderedBody = a._tocInjectedBody;

  // Series navigation (if article belongs to a series) — only on AR (series are Arabic-only currently)
  let seriesNavHtml = '';
  if (a.series && a.seriesOrder && !isEn) {
    const siblings = candidateArticles
      .filter(x => x.series === a.series && x.seriesOrder)
      .sort((x, y) => x.seriesOrder - y.seriesOrder);
    const sIdx = siblings.findIndex(x => x.slug === a.slug);
    if (sIdx >= 0) {
      const sPrev = sIdx > 0 ? siblings[sIdx - 1] : null;
      const sNext = sIdx < siblings.length - 1 ? siblings[sIdx + 1] : null;
      const total = siblings.length;
      const sPrevHtml = sPrev ? `<a class="sn-link sn-prev" href="${sPrev.slug}"><span class="sn-arrow" aria-hidden="true">${t(lang, 'article.prevArrow')}</span><span class="sn-meta">${t(lang, 'article.prevLesson')}</span><span class="sn-title">${sPrev.title}</span></a>` : '<span class="sn-spacer"></span>';
      const sNextHtml = sNext ? `<a class="sn-link sn-next" href="${sNext.slug}"><span class="sn-meta">${t(lang, 'article.nextLesson')}</span><span class="sn-title">${sNext.title}</span><span class="sn-arrow" aria-hidden="true">${t(lang, 'article.nextArrow')}</span></a>` : '<span class="sn-spacer"></span>';
      seriesNavHtml = `<nav class="series-nav" aria-label="${escAttr(t(lang, 'article.seriesAria'))}">
        <div class="sn-header">
          <span class="sn-name">${t(lang, 'article.series')}: ${escapeHtml(a.series)}</span>
          <span class="sn-progress">${t(lang, 'article.seriesLesson', { n: fmtNum(lang, a.seriesOrder), total: fmtNum(lang, total) })}</span>
        </div>
        <div class="sn-progress-bar"><div class="sn-progress-fill" style="width:${(a.seriesOrder / total) * 100}%"></div></div>
        <div class="sn-links">${sPrevHtml}${sNextHtml}</div>
      </nav>`;
    }
  }

  // Reading tools (luxury design — sticky floating toolbar)
  // Arabic: font-size +/- and tashkeel toggle. English: font-size +/- only.
  const fontDecLabel = isEn ? 'A−' : 'أ−';
  const fontIncLabel = isEn ? 'A+' : 'أ+';
  const tashkeelBtnHtml = (a.voweledHtml && !isEn) ? `<button id="tashkeel-btn" type="button" aria-pressed="false" title="${escAttr(t(lang, 'article.tashkeel'))}" aria-label="${escAttr(t(lang, 'article.tashkeel'))}">◌</button>` : '';
  const readingTools = `<div class="reading-tools" role="toolbar" aria-label="${escAttr(t(lang, 'article.readingControls'))}">
    <button id="font-dec" type="button" aria-label="${escAttr(t(lang, 'article.fontDec'))}" title="${escAttr(t(lang, 'article.fontDec'))}">${fontDecLabel}</button>
    <button id="font-inc" type="button" aria-label="${escAttr(t(lang, 'article.fontInc'))}" title="${escAttr(t(lang, 'article.fontInc'))}">${fontIncLabel}</button>
    ${tashkeelBtnHtml}
    <button id="bookmark-btn" type="button" aria-pressed="false" data-slug="${escAttr(a.slug)}" data-title="${escAttr(title)}" data-icon="${escAttr(a.icon)}" data-excerpt="${escAttr(excerpt)}" data-lang="${lang}" title="${escAttr(t(lang, 'article.saveForLater'))}" aria-label="${escAttr(t(lang, 'article.saveForLater'))}">${ICONS.bookmark}</button>
  </div>`;

  // Engagement section (luxury design: reaction-box + comments)
  const engagementHtml = `
  <section class="reaction" id="engagement" data-slug="${escAttr(a.slug)}">
    <div class="reading-container reaction-box">
      <h2>${t(lang, 'article.reachedIdea')}</h2>
      <p>${t(lang, 'article.likeHelps')}</p>
      <button class="like-btn" id="like-btn" type="button" aria-pressed="false" data-slug="${escAttr(a.slug)}">
        <span class="like-heart" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21s-7-4.5-9.5-9C1 8 3 4 7 4c2 0 3.5 1 5 3 1.5-2 3-3 5-3 4 0 6 4 4.5 8C19 16.5 12 21 12 21z"/></svg></span>
        <span class="like-label">${t(lang, 'engagement.like')}</span>
      </button>
      <span class="like-count" id="like-count" data-zero="${escAttr(t(lang, 'engagement.noLikes'))}">…</span>
      <span class="like-msg" id="like-msg" role="status" aria-live="polite"></span>
      <div class="comments">
        <h3>${t(lang, 'engagement.comments')} <small>(<span id="comments-count">…</span>)</small></h3>
        <form class="comment-form" id="comment-form" data-slug="${escAttr(a.slug)}" data-lang="${lang}">
          <input type="text" name="website" class="hp-field" tabindex="-1" autocomplete="off" aria-hidden="true">
          <div class="comment-form-row">
            <input type="text" name="name" class="comment-form-name" placeholder="${escAttr(t(lang, 'engagement.commentNamePlaceholder'))}" maxlength="50" autocomplete="name">
          </div>
          <textarea name="text" class="comment-form-text" placeholder="${escAttr(t(lang, 'engagement.commentTextPlaceholder'))}" maxlength="1000" required></textarea>
          <div class="comment-form-actions">
            <span class="comment-form-hint">${t(lang, 'engagement.commentHint')}</span>
            <button type="submit" class="comment-submit" id="comment-submit">${t(lang, 'engagement.publishComment')}</button>
          </div>
        </form>
        <div class="comment-list" id="comment-list" aria-live="polite"></div>
      </div>
    </div>
  </section>`;

  // Related articles (luxury design: related-grid of related-card)
  const relatedTitle = (x) => isEn ? (x.titleEn || x.title) : x.title;
  const relatedTag = (x) => localizeTag(lang, x.tag);
  const relatedCards = others.map(x => `<a class="related-card" href="${x.slug}"><small>${escapeHtml(relatedTag(x))}</small><h3>${escapeHtml(relatedTitle(x))} <span aria-hidden="true">${t(lang, 'card.readArrow')}</span></h3></a>`).join('\n');
  const relatedHtml = others.length ? `
  <section class="related">
    <div class="container">
      <div class="section-head">
        <h2>${t(lang, 'article.readAlso')}</h2>
        <p>${t(lang, 'article.relatedSubtitle')}</p>
      </div>
      <div class="related-grid">
${relatedCards}
      </div>
    </div>
  </section>` : '';

  // Hidden plain-text version for "copy text" + teacher print
  const plainTextEsc = escAttr(plainText);
  const voweledAvailable = isEn ? '0' : (a.voweledHtml ? '1' : '0');

  // Determine language switcher target
  const langSwitchTarget = isEn
    ? (a.hasEnglish !== false ? `/articles/${a.slug}` : `/`)
    : (a.hasEnglish ? `/en/articles/${a.slug}` : `/en/`);

  const backArrow = isEn ? '←' : '→';
  const backLabel = t(lang, 'article.backToArticles');
  const authorInitial = isEn ? 'Z' : 'ز';
  const authorName = t(lang, 'article.authorName');
  const writtenBy = t(lang, 'article.writtenBy');
  const readingTimeLabel = t(lang, 'article.readingTime', { n: fmtNum(lang, a.readingTime) });
  const levelLabel = a.level ? localizeLevel(lang, a.level) : '';
  const tagLabel = localizeTag(lang, a.tag);

  const body = `
  <header class="article-hero">
    <div class="container">
      <a class="back" href="${backHref}">${backArrow} ${backLabel}</a>
      <div class="eyebrow" style="margin-top:42px">${escapeHtml(tagLabel)}</div>
      <h1>${title}</h1>
      <p class="article-intro">${escapeHtml(excerpt)}</p>
      <div class="article-meta">
        <span>${writtenBy} ${authorName}</span>
        <span aria-hidden="true">•</span>
        <span>${readingTimeLabel}</span>
        ${levelLabel ? `<span aria-hidden="true">•</span><span class="level-badge">${escapeHtml(levelLabel)}</span>` : ''}
      </div>
      ${readingTools}
    </div>
  </header>

  ${seriesNavHtml}

  <article class="reading-container article-body" id="article-main">
${renderedBody}
  </article>
  ${(!isEn && a.voweledHtml) ? `<div class="reading-container article-body" id="article-voweled" hidden>${a.voweledHtml}</div>` : ''}
  ${!isEn ? a.exercisesHtml : ''}

  <section class="reading-container">
    <div class="author">
      <div class="author-main">
        <div class="avatar" aria-hidden="true">${authorInitial}</div>
        <div>
          <strong>${authorName}</strong>
          <small>${t(lang, 'article.founderBio')}</small>
        </div>
      </div>
      <a class="read-link" href="https://ziadamrme.vercel.app" target="_blank" rel="noopener">${t(lang, 'article.personalSiteLink')} <span aria-hidden="true">↗</span></a>
    </div>
  </section>

  ${engagementHtml}
  ${relatedHtml}

  <script type="text/plain" id="plain-text-data" data-title="${escAttr(title)}" data-lang="${lang}">${plainTextEsc}</script>
  <script type="text/plain" id="voweled-available" data-available="${voweledAvailable}"></script>
  <script type="text/plain" id="article-lang" data-lang="${lang}"></script>`;

  // JSON-LD Article structured data — correct inLanguage + URL per language
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description: excerpt,
    inLanguage: lang,
    author: { '@type': 'Person', name: authorName, url: 'https://ziadamrme.vercel.app' },
    publisher: { '@type': 'Person', name: authorName, url: 'https://ziadamrme.vercel.app' },
    datePublished: isoDate(a.createdTime || Date.now()),
    dateModified: isoDate(a.lastEditedTime || a.createdTime || Date.now()),
    mainEntityOfPage: { '@type': 'WebPage', '@id': articleUrlBase },
    url: articleUrlBase,
    articleSection: localizeTag(lang, a.tag),
    ...(a.level ? { educationalLevel: localizeLevel(lang, a.level) } : {}),
    ...(a.series && !isEn ? { isPartOf: { '@type': 'CreativeWorkSeries', name: a.series, position: a.seriesOrder } } : {}),
  });

  return shell({
    title: `${title} — ${t(lang, 'site.name')}`,
    metaDesc: excerpt || '',
    body,
    depth: articleDepth,
    lang,
    canonical: articleUrlBase,
    alternateHref: alternateUrl,
    langSwitchHref: langSwitchTarget,
    ogImage: `${SITE_URL}/og/${a.slug}.svg`,
    jsonLd,
  });
}

// ── Category page ─────────────────────────────────────────────────────────────
function buildCategoryPage(catName, catSlug, articles, depth = 1, lang = 'ar') {
  const cards = articles.map(a => card(a, depth, lang)).join('\n');
  const heroQuote = t(lang, 'home.heroQuote');
  const articlesInLabel = articles.length === 1
    ? t(lang, 'category.articlesInOne', { n: fmtNum(lang, articles.length) })
    : t(lang, 'category.articlesInMany', { n: fmtNum(lang, articles.length) });
  const articlesOfLabel = t(lang, 'category.articlesOf', { name: catName });
  const allArticlesLabel = t(lang, 'category.allArticles');
  const backHref = depth === 0 ? '/' : (depth === 1 ? '../' : '../../');
  const body = `
  <div class="hero" style="padding:60px 24px 50px">
    <span class="hero-quote" aria-hidden="true">${heroQuote}</span>
    <h1 style="font-size:clamp(36px,6vw,52px)">${escAttr(catName)}</h1>
    <p class="tag">${articlesInLabel}</p>
    <div class="orn-line" aria-hidden="true">✦</div>
  </div>
  <div class="wrap">
    <div class="section-head">
      <h2>${articlesOfLabel}</h2>
      <a href="${backHref}" style="color:var(--muted);font-size:14px;font-weight:700">${allArticlesLabel}</a>
    </div>
    <div class="grid">
${cards}
    </div>
  </div>`;
  return shell({
    title: `${catName}${t(lang, 'category.titleSuffix')}`,
    metaDesc: t(lang, 'category.metaDesc', { name: catName }),
    body,
    depth,
    lang,
    canonical: lang === 'en' ? `${SITE_URL}/en/category/${catSlug}` : `${SITE_URL}/category/${catSlug}`,
    alternateHref: lang === 'en' ? `${SITE_URL}/category/${catSlug}` : `${SITE_URL}/en/category/${catSlug}`,
    langSwitchHref: lang === 'en' ? `/category/${catSlug}` : `/en/category/${catSlug}`,
    ogImage: `${SITE_URL}/og-default.svg`,
  });
}

// ── 404 page ──────────────────────────────────────────────────────────────────
function build404(lang = 'ar') {
  const backHref = lang === 'en' ? '/en/' : '/';
  const body = `
  <div class="not-found">
    <div class="nf-code">${t(lang, 'notFound.code')}</div>
    <h1>${t(lang, 'notFound.title')}</h1>
    <p>${t(lang, 'notFound.desc')}</p>
    <a class="nf-btn" href="${backHref}">${t(lang, 'notFound.backHome')}</a>
  </div>`;
  return shell({
    title: t(lang, 'notFound.htmlTitle'),
    metaDesc: t(lang, 'notFound.metaDesc'),
    body,
    depth: lang === 'en' ? 1 : 0,
    lang,
    canonical: lang === 'en' ? `${SITE_URL}/en/404` : `${SITE_URL}/404`,
    langSwitchHref: lang === 'en' ? '/404' : '/en/404',
  });
}

// ── About page ───────────────────────────────────────────────────────────────
function buildAbout(lang = 'ar') {
  const backHref = lang === 'en' ? '/en/' : '/';
  const backArrow = lang === 'en' ? '←' : '→';
  const backLabel = t(lang, 'article.backToHome');
  const body = `
  <div class="about-shell">
    <a class="back" href="${backHref}"><span aria-hidden="true">${backArrow}</span> ${backLabel}</a>
    <h1>${t(lang, 'about.title')}</h1>
    <p class="lead">${t(lang, 'about.lead')}</p>
    <p>${t(lang, 'about.p1')}</p>
    <h2>${t(lang, 'about.h1')}</h2>
    <p>${t(lang, 'about.p2')}</p>
    <h2>${t(lang, 'about.h2')}</h2>
    <p>${t(lang, 'about.p3')}</p>
    <p><a class="author-link" href="https://ziadamrme.vercel.app" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;background:var(--accent);color:#fff;padding:11px 20px;border-radius:999px;font-weight:800;font-size:14px">ziadamrme.vercel.app <span aria-hidden="true">↗</span></a></p>
    <h2>${t(lang, 'about.h3')}</h2>
    <p>${t(lang, 'about.p4')}</p>
    <div class="orn" aria-hidden="true">✦</div>
    <p style="text-align:center;color:var(--muted);font-size:15px">${t(lang, 'about.thanks')}</p>
  </div>`;
  return shell({
    title: t(lang, 'about.htmlTitle'),
    metaDesc: t(lang, 'about.metaDesc'),
    body,
    depth: lang === 'en' ? 1 : 0,
    lang,
    canonical: lang === 'en' ? `${SITE_URL}/en/about` : `${SITE_URL}/about`,
    alternateHref: lang === 'en' ? `${SITE_URL}/about` : `${SITE_URL}/en/about`,
    langSwitchHref: lang === 'en' ? '/about' : '/en/about',
    ogImage: `${SITE_URL}/og-default.svg`,
  });
}

// ── /admin page (protected by ADMIN_TOKEN — login form, no server-rendered secrets) ──
// Admin stays Arabic-only — it's a backend moderation tool, not public-facing content.
// The /en/admin URL is intentionally not generated.
function buildAdmin() {
  const lang = 'ar';
  const body = `
  <div class="admin-shell" id="admin-root">
    <div class="admin-login" id="admin-login">
      <h1>${t(lang, 'admin.title')}</h1>
      <p>${t(lang, 'admin.loginPrompt')}</p>
      <input type="password" id="admin-token-input" placeholder="ADMIN_TOKEN" autocomplete="off">
      <button type="button" id="admin-login-btn">${t(lang, 'admin.login')}</button>
      <p id="admin-login-error" style="color:#A83232;font-size:13px;margin-top:10px;display:none"></p>
    </div>
    <div id="admin-content" hidden>
      <a class="back" href="/" style="margin-bottom:18px"><span aria-hidden="true">→</span> ${t(lang, 'article.backToHome')}</a>
      <h1 style="font-family:var(--font-display);font-size:30px;font-weight:700;margin:0 0 8px">${t(lang, 'admin.dashboardTitle')}</h1>
      <p style="color:var(--muted);font-size:14px;margin-bottom:18px">${t(lang, 'admin.dashboardDesc')}</p>
      <div class="admin-stats" id="admin-stats"></div>
      <h2 style="font-family:var(--font-display);font-size:22px;font-weight:700;margin:24px 0 14px">${t(lang, 'admin.allComments')}</h2>
      <div id="admin-comments"></div>
    </div>
  </div>
  <script>
  (function(){
    function $(id){ return document.getElementById(id); }
    var tokenKey = 'kalaam-admin-token';
    var savedToken = '';
    try { savedToken = localStorage.getItem(tokenKey) || ''; } catch(e){}

    function login(token){
      $('admin-login-error').style.display = 'none';
      $('admin-login-error').textContent = '';
      fetch('/api/admin-stats', { headers: { 'X-Admin-Token': token } })
        .then(function(r){
          if (r.status === 401) { throw new Error('${t(lang, 'admin.wrongToken')}'); }
          if (!r.ok) { throw new Error('${t(lang, 'admin.serverError')}'); }
          return r.json();
        })
        .then(function(stats){
          try { localStorage.setItem(tokenKey, token); } catch(e){}
          showDashboard(token, stats);
        })
        .catch(function(e){
          $('admin-login-error').textContent = e.message || '${t(lang, 'admin.problem')}';
          $('admin-login-error').style.display = 'block';
        });
    }

    function showDashboard(token, stats){
      $('admin-login').hidden = true;
      $('admin-content').hidden = false;
      var statsHtml = '';
      statsHtml += '<div class="admin-stat"><div class="num">' + (stats.totalComments || 0) + '</div><div class="lbl">${t(lang, 'admin.totalComments')}</div></div>';
      statsHtml += '<div class="admin-stat"><div class="num">' + (stats.totalLikes || 0) + '</div><div class="lbl">${t(lang, 'admin.totalLikes')}</div></div>';
      statsHtml += '<div class="admin-stat"><div class="num">' + (stats.slugs ? stats.slugs.length : 0) + '</div><div class="lbl">${t(lang, 'admin.articlesWithComments')}</div></div>';
      $('admin-stats').innerHTML = statsHtml;
      fetch('/api/comment-admin?all=1', { headers: { 'X-Admin-Token': token } })
        .then(function(r){ return r.json(); })
        .then(function(d){
          if (!d.items || d.items.length === 0) {
            $('admin-comments').innerHTML = '<div class="admin-empty">${t(lang, 'admin.noComments')}</div>';
            return;
          }
          var html = d.items.map(function(c){
            return '<div class="admin-comment">' +
              '<div class="admin-comment-top">' +
                '<span class="admin-comment-meta">' + new Date(c.ts).toLocaleString('ar-EG') + ' • ' + (c.name || 'زائر') + '</span>' +
                '<span class="admin-comment-slug">' + c.slug + '</span>' +
              '</div>' +
              '<div class="admin-comment-text">' + escapeHtml(c.text || '') + '</div>' +
              '<div class="admin-comment-actions">' +
                '<button class="admin-delete-btn" data-id="' + c.id + '" data-slug="' + c.slug + '">${t(lang, 'admin.delete')}</button>' +
              '</div>' +
            '</div>';
          }).join('');
          $('admin-comments').innerHTML = html;
          document.querySelectorAll('.admin-delete-btn').forEach(function(btn){
            btn.addEventListener('click', function(){
              if (!confirm('${t(lang, 'admin.confirmDelete')}')) return;
              var id = btn.getAttribute('data-id');
              var slug = btn.getAttribute('data-slug');
              fetch('/api/comment-admin?id=' + encodeURIComponent(id) + '&slug=' + encodeURIComponent(slug), {
                method: 'DELETE',
                headers: { 'X-Admin-Token': token }
              }).then(function(r){ return r.json(); }).then(function(d){
                if (d.ok) {
                  var card = btn.closest('.admin-comment');
                  if (card) card.remove();
                } else {
                  alert(d.error || '${t(lang, 'admin.deleteError')}');
                }
              }).catch(function(){ alert('${t(lang, 'admin.networkError')}'); });
            });
          });
        });
    }

    function escapeHtml(s){
      return String(s).replace(/[&<>"']/g, function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
      });
    }

    $('admin-login-btn').addEventListener('click', function(){
      login($('admin-token-input').value);
    });
    $('admin-token-input').addEventListener('keypress', function(e){
      if (e.key === 'Enter') login($('admin-token-input').value);
    });

    if (savedToken) {
      $('admin-token-input').value = savedToken;
      login(savedToken);
    }
  })();
  </script>`;
  return shell({
    title: t(lang, 'admin.htmlTitle'),
    metaDesc: t(lang, 'admin.metaDesc'),
    body,
    depth: 0,
    lang,
    canonical: `${SITE_URL}/admin`,
    ogImage: `${SITE_URL}/og-default.svg`,
  });
}

// ── Notion block tree fetcher (recursive, with children pre-attached) ─────────
async function fetchBlockTree(blockId) {
  const out = [];
  let cursor;
  do {
    const resp = await notion.blocks.children.list({
      block_id: blockId, start_cursor: cursor, page_size: 100,
    });
    for (const b of resp.results) {
      const block = { ...b, _children: [] };
      if (b.has_children) {
        block._children = await fetchBlockTree(b.id);
      }
      out.push(block);
    }
    cursor = resp.has_more ? resp.next_cursor : null;
  } while (cursor);
  return out;
}

// ── Custom block renderer (preserves bold annotations, no notion-to-md) ───────
function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function renderRichText(richText) {
  if (!Array.isArray(richText)) return '';
  return richText.map(r => {
    let s = escapeHtml(r.plain_text || '');
    if (!s) return '';
    if (r.annotations?.code) s = `<code>${s}</code>`;
    if (r.annotations?.bold) s = `<strong>${s}</strong>`;
    if (r.annotations?.italic) s = `<em>${s}</em>`;
    if (r.annotations?.strikethrough) s = `<del>${s}</del>`;
    if (r.annotations?.underline) s = `<u>${s}</u>`;
    if (r.href) s = `<a href="${escapeHtml(r.href)}" target="_blank" rel="noopener">${s}</a>`;
    return s;
  }).join('');
}
function getBlockRichText(b) {
  const t = b.type;
  return (b[t] && b[t].rich_text) ? b[t].rich_text : [];
}
function getBlockPlainText(b) {
  return getBlockRichText(b).map(r => r.plain_text || '').join('');
}

// Render a sequence of top-level blocks into HTML.
// - Groups consecutive bulleted_list_item / numbered_list_item into <ul>/<ol>
// - Skips "English Version" toggle (handled by caller)
// - Applies Quran / hadith / closing transforms inline
function renderBlocks(blocks) {
  let html = '';
  let i = 0;
  const transforms = (s) => s
    .replace(/﴿([^﴾]+)﴾/g, '<span class="verse">﴿$1﴾</span>')
    .replace(/«([^»]+)»/g, '<span class="hadith">«$1»</span>')
    .replace(/&lt;closing&gt;([\s\S]*?)&lt;\/closing&gt;/g, '<div class="closing">$1</div>')
    .replace(/<closing>([\s\S]*?)<\/closing>/g, '<div class="closing">$1</div>');

  while (i < blocks.length) {
    const b = blocks[i];
    const t = b.type;

    if (t === 'bulleted_list_item') {
      html += '<ul>';
      while (i < blocks.length && blocks[i].type === 'bulleted_list_item') {
        html += `<li>${transforms(renderRichText(getBlockRichText(blocks[i])))}</li>`;
        i++;
      }
      html += '</ul>';
      continue;
    }
    if (t === 'numbered_list_item') {
      html += '<ol>';
      while (i < blocks.length && blocks[i].type === 'numbered_list_item') {
        // For numbered items in main body (not exercises), the children are usually exercise options
        // — but main-body numbered items with children are rare. Render the item text only.
        html += `<li>${transforms(renderRichText(getBlockRichText(blocks[i])))}</li>`;
        i++;
      }
      html += '</ol>';
      continue;
    }

    const text = transforms(renderRichText(getBlockRichText(b)));
    switch (t) {
      case 'heading_1': html += `<h1>${text}</h1>`; break;
      case 'heading_2': html += `<h2>${text}</h2>`; break;
      case 'heading_3': html += `<h3>${text}</h3>`; break;
      case 'paragraph':
        // Empty paragraph after <closing> tag (the tag itself becomes a div via transforms)
        html += text ? `<p>${text}</p>` : '';
        break;
      case 'divider': html += '<hr>'; break;
      case 'quote': html += `<blockquote>${text}</blockquote>`; break;
      case 'callout': html += `<div class="callout">${text}</div>`; break;
      case 'toggle':
        // For main body, toggles other than "النسخة المشكولة" / "English Version"
        // are rendered as <details>. (Special ones are filtered out by caller.)
        html += `<details class="toggle"><summary>${text}</summary>${renderBlocks(b._children || [])}</details>`;
        break;
      case 'image': {
        const url = b.image?.external?.url || b.image?.file?.url || '';
        const cap = renderRichText(b.image?.caption || []);
        html += `<figure class="img"><img src="${escapeHtml(url)}" alt="${escapeHtml(cap)}" loading="lazy">${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`;
        break;
      }
      case 'bookmark': {
        const url = b.bookmark?.url || '';
        html += `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></p>`;
        break;
      }
      default:
        html += text ? `<p>${text}</p>` : '';
    }
    i++;
  }
  // Ornamental divider before each h2 (matches existing design)
  html = html.replace(/<h2>/g, '<div aria-hidden="true" class="orn">✦</div>\n<h2>');
  // Drop empty <p></p> leftovers from <closing> tag wrappers
  html = html.replace(/<p>\s*<\/p>/g, '');
  return html;
}

// ── Exercise parser — converts raw blocks into structured data ────────────────
// Input: the slice of blocks starting at the "تدريبات" heading.
// Output: array of { type: 'mcq'|'i3rab', title, questions[]|items[] }
function parseExercises(blocks) {
  const sections = [];
  let currentSection = null;

  for (const b of blocks) {
    const text = getBlockPlainText(b).trim();

    // Skip the main "تدريبات" heading
    if (b.type === 'heading_2' && text === 'تدريبات') continue;
    // Skip "English Version" toggle if it appears after exercises
    if (b.type === 'toggle' && text === 'English Version') continue;

    // Subsection title (e.g. "أسئلة فهم", "تدريبات إعراب")
    if (b.type === 'heading_3') {
      const isI3rab = /إعراب/.test(text);
      currentSection = {
        type: isI3rab ? 'i3rab' : 'mcq',
        title: text,
        questions: [],
        items: [],
      };
      sections.push(currentSection);
      continue;
    }

    // MCQ: numbered_list_item with bulleted children
    if (b.type === 'numbered_list_item' && (b._children || []).length) {
      const opts = (b._children || [])
        .filter(c => c.type === 'bulleted_list_item')
        .map(c => {
          const rt = getBlockRichText(c);
          return {
            html: renderRichText(rt),
            isCorrect: rt.some(r => r.annotations?.bold),
          };
        });
      if (!currentSection) {
        currentSection = { type: 'mcq', title: 'أسئلة', questions: [], items: [] };
        sections.push(currentSection);
      }
      if (currentSection.type !== 'mcq') {
        currentSection = { type: 'mcq', title: 'أسئلة', questions: [], items: [] };
        sections.push(currentSection);
      }
      currentSection.questions.push({
        questionHtml: renderRichText(getBlockRichText(b)),
        options: opts,
      });
      continue;
    }

    // إعراب toggle: title starts with "إعراب:"
    if (b.type === 'toggle' && /^إعراب/.test(text)) {
      if (!currentSection || currentSection.type !== 'i3rab') {
        currentSection = { type: 'i3rab', title: 'تدريبات الإعراب', questions: [], items: [] };
        sections.push(currentSection);
      }
      const answerItems = (b._children || [])
        .filter(c => c.type === 'bulleted_list_item')
        .map(c => `<li>${renderRichText(getBlockRichText(c))}</li>`)
        .join('');
      currentSection.items.push({
        questionHtml: renderRichText(getBlockRichText(b)),
        answerHtml: `<ul>${answerItems}</ul>`,
      });
      continue;
    }
    // Ignore other blocks inside exercises section
  }
  return sections;
}

// ── Render exercises as interactive HTML ──────────────────────────────────────
function renderExercises(sections) {
  if (!sections || !sections.length) return '';
  let html = '<section class="exercises" id="exercises" aria-label="تدريبات تفاعلية">';
  html += '<div class="ex-head"><span class="ex-icon" aria-hidden="true">✍️</span><h2>تدريبات</h2></div>';

  let qNum = 0;
  for (const s of sections) {
    html += `<div class="ex-section">`;
    html += `<h3 class="ex-section-title">${escapeHtml(s.title)}</h3>`;

    if (s.type === 'mcq') {
      for (const q of s.questions) {
        qNum++;
        html += `<div class="ex-question" data-q="${qNum}">`;
        html += `<div class="ex-q-text"><span class="ex-q-num">${toArabicDigits(qNum)}.</span> ${q.questionHtml}</div>`;
        html += `<div class="ex-options" role="radiogroup" aria-label="سؤال ${toArabicDigits(qNum)}">`;
        q.options.forEach((opt, idx) => {
          const letter = 'أبتثجحخدذرزسشصضطظعغفقكلمنهوي'[idx] || String.fromCharCode(65 + idx);
          html += `<button class="ex-option" data-correct="${opt.isCorrect ? '1' : '0'}" type="button" role="radio" aria-checked="false">`;
          html += `<span class="ex-marker" aria-hidden="true">${letter}</span>`;
          html += `<span class="ex-opt-text">${opt.html}</span>`;
          html += `</button>`;
        });
        html += `</div>`;
        html += `<div class="ex-feedback" role="status" aria-live="polite"></div>`;
        html += `</div>`;
      }
    } else if (s.type === 'i3rab') {
      let iNum = 0;
      for (const item of s.items) {
        iNum++;
        html += `<div class="ex-i3rab">`;
        html += `<div class="ex-q-text"><span class="ex-q-num">${toArabicDigits(iNum)}.</span> ${item.questionHtml}</div>`;
        html += `<button class="ex-reveal" type="button" aria-expanded="false">اعرض الإجابة النموذجية <span aria-hidden="true">▾</span></button>`;
        html += `<div class="ex-answer" hidden>${item.answerHtml}</div>`;
        html += `</div>`;
      }
    }
    html += `</div>`;
  }
  html += '</section>';
  return html;
}

// ── Plain-text renderer (for "copy text" button + teacher print) ──────────────
function blocksToPlainText(blocks) {
  let out = '';
  for (const b of blocks) {
    const t = b.type;
    const text = getBlockPlainText(b);
    if (t === 'heading_1' || t === 'heading_2' || t === 'heading_3') {
      out += `\n\n${text}\n${'─'.repeat(Math.min(text.length, 40))}\n`;
    } else if (t === 'bulleted_list_item') {
      out += `• ${text}\n`;
    } else if (t === 'numbered_list_item') {
      out += `${text}\n`;
    } else if (t === 'paragraph') {
      out += `${text}\n\n`;
    } else if (t === 'divider') {
      out += `\n${'═'.repeat(40)}\n\n`;
    } else if (text) {
      out += `${text}\n\n`;
    }
  }
  return out.trim();
}

// ── Get article data: main html + voweled html + exercises + plain text ───────
// Also extracts English body from "English Version" toggle if present.
async function getArticleData(pageId) {
  const allBlocks = await fetchBlockTree(pageId);

  let mainBlocks = [];
  let voweledBlocks = null;
  let exerciseBlocks = [];
  let englishBlocks = null;

  let inExercises = false;
  for (const b of allBlocks) {
    const text = getBlockPlainText(b).trim();

    // Toggle titled "النسخة المشكولة" → save its children as the voweled version
    if (b.type === 'toggle' && text === 'النسخة المشكولة') {
      voweledBlocks = b._children || [];
      continue;
    }
    // Toggle "English Version" → save its children as the English version
    if (b.type === 'toggle' && text === 'English Version') {
      englishBlocks = b._children || [];
      continue;
    }
    // heading_2 "تدريبات" → exercises section starts
    if (b.type === 'heading_2' && text === 'تدريبات') {
      inExercises = true;
      exerciseBlocks.push(b);
      continue;
    }
    if (inExercises) exerciseBlocks.push(b);
    else mainBlocks.push(b);
  }

  const mainHtml = renderBlocks(mainBlocks).trim();
  const voweledHtml = voweledBlocks && voweledBlocks.length
    ? renderBlocks(voweledBlocks).trim()
    : null;
  const exercises = parseExercises(exerciseBlocks);
  const exercisesHtml = renderExercises(exercises);
  const plainText = blocksToPlainText(mainBlocks);

  // English body — rendered with verse/hadith blockquote detection
  const englishHtml = englishBlocks && englishBlocks.length
    ? renderBlocksEn(englishBlocks).trim()
    : null;
  const englishPlainText = englishBlocks && englishBlocks.length
    ? blocksToPlainText(englishBlocks)
    : '';

  return { mainHtml, voweledHtml, exercisesHtml, exercises, plainText, englishHtml, englishPlainText, hasEnglish: !!(englishBlocks && englishBlocks.length) };
}

// ── English block renderer ─────────────────────────────────────────────────────
// Same as renderBlocks, but:
// 1. Detects English verse/hadith patterns in paragraphs and renders them as
//    blockquotes (.verse-en / .hadith-en).
// 2. Treats the LAST paragraph of the body as the closing (.closing).
// 3. Skips "النسخة المشكولة" / "English Version" / "تدريبات" toggles defensively
//    (shouldn't appear inside English toggle, but just in case).
function renderBlocksEn(blocks) {
  // Make a shallow copy so we can detect "last paragraph" without mutating caller
  const blockList = blocks.filter(b => {
    const text = getBlockPlainText(b).trim();
    if (b.type === 'toggle' && (text === 'النسخة المشكولة' || text === 'English Version')) return false;
    if (b.type === 'heading_2' && text === 'تدريبات') return false;
    return true;
  });

  // Find index of last paragraph for closing transformation
  let lastParagraphIdx = -1;
  for (let i = blockList.length - 1; i >= 0; i--) {
    if (blockList[i].type === 'paragraph') { lastParagraphIdx = i; break; }
  }

  let html = '';
  let i = 0;
  // No Quran/hadith tag transforms — verses/hadiths in English are detected by quote+citation pattern
  const transforms = (s) => s;

  while (i < blockList.length) {
    const b = blockList[i];
    const t = b.type;

    if (t === 'bulleted_list_item') {
      html += '<ul>';
      while (i < blockList.length && blockList[i].type === 'bulleted_list_item') {
        html += `<li>${transforms(renderRichText(getBlockRichText(blockList[i])))}</li>`;
        i++;
      }
      html += '</ul>';
      continue;
    }
    if (t === 'numbered_list_item') {
      html += '<ol>';
      while (i < blockList.length && blockList[i].type === 'numbered_list_item') {
        html += `<li>${transforms(renderRichText(getBlockRichText(blockList[i])))}</li>`;
        i++;
      }
      html += '</ol>';
      continue;
    }

    const text = transforms(renderRichText(getBlockRichText(b)));
    switch (t) {
      case 'heading_1': html += `<h1>${text}</h1>`; break;
      case 'heading_2': html += `<h2>${text}</h2>`; break;
      case 'heading_3': html += `<h3>${text}</h3>`; break;
      case 'paragraph':
        if (!text) { i++; break; }
        // Last paragraph → wrap in .closing
        if (i === lastParagraphIdx) {
          html += `<div class="closing">${text}</div>`;
        } else {
          // Detect verse/hadith quote+citation patterns in this paragraph
          html += transformEnglishQuoteParagraph(text);
        }
        break;
      case 'divider': html += '<hr>'; break;
      case 'quote': html += `<blockquote>${text}</blockquote>`; break;
      case 'callout': html += `<div class="callout">${text}</div>`; break;
      case 'toggle':
        html += `<details class="toggle"><summary>${text}</summary>${renderBlocksEn(b._children || [])}</details>`;
        break;
      case 'image': {
        const url = b.image?.external?.url || b.image?.file?.url || '';
        const cap = renderRichText(b.image?.caption || []);
        html += `<figure class="img"><img src="${escapeHtml(url)}" alt="${escapeHtml(cap)}" loading="lazy">${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`;
        break;
      }
      case 'bookmark': {
        const url = b.bookmark?.url || '';
        html += `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></p>`;
        break;
      }
      default:
        html += text ? `<p>${text}</p>` : '';
    }
    i++;
  }
  // Ornamental divider before each h2 (matches Arabic design)
  html = html.replace(/<h2>/g, '<div aria-hidden="true" class="orn">✦</div>\n<h2>');
  // Drop empty <p></p> leftovers
  html = html.replace(/<p>\s*<\/p>/g, '');
  return html;
}

// ── English verse/hadith quote detector ────────────────────────────────────────
// Pattern: a paragraph contains "quoted text" [citation] — extract the quote
// and render as <blockquote class="verse-en"> or .hadith-en.
// Citation examples: [Muslim], [Bukhari], [Agreed upon], [Quran 7:199],
// [Al-Hujurat 49:11], [Tirmidhi], etc.
// Surrounding commentary text is kept as regular paragraphs (split before/after).
function transformEnglishQuoteParagraph(paragraphHtml) {
  // Match: "..." or "..." (curly quotes) followed by optional [citation]
  // Use a regex that handles both straight and curly quotes
  const re = /([""]([^""]{8,400})[""]|'([^']{8,400})')\s*(\[[A-Za-z][A-Za-z\s\d:.\-'’]+?\])/g;

  // If no match, render as regular paragraph
  re.lastIndex = 0;
  const matches = [];
  let m;
  while ((m = re.exec(paragraphHtml)) !== null) {
    matches.push({
      full: m[0],
      quote: m[2] || m[3],
      citation: m[4],
      index: m.index,
      end: m.index + m[0].length,
    });
  }

  if (matches.length === 0) {
    return `<p>${paragraphHtml}</p>`;
  }

  // Build output: alternate paragraphs of commentary with blockquotes of quotes
  let result = '';
  let lastEnd = 0;
  for (const mt of matches) {
    const before = paragraphHtml.slice(lastEnd, mt.index).trim();
    if (before) {
      // Strip leading colon/comma/period from "before" if it's just punctuation
      const cleaned = before.replace(/^[\s:;,.—–-]+/, '').trim();
      if (cleaned) result += `<p>${cleaned}</p>`;
    }
    // Classify verse vs hadith based on citation + surrounding context (the "before" text)
    const hadithKeywords = /Muslim|Bukhari|Agreed|Tirmidhi|Abu Dawud|Ibn Majah|Nasai|Ahmad|Tabari|Bayhaqi|Malik|Prophet|Messenger|ﷺ|hadith/i;
    const verseKeywords = /Quran|Surah|Al-|An-|Verse|Ayah|Allah said|Allah says|Allah revealed/i;
    const contextText = (paragraphHtml.slice(Math.max(0, mt.index - 100), mt.index)) + ' ' + mt.citation;
    const isHadith = hadithKeywords.test(contextText) && !verseKeywords.test(mt.citation);
    const isVerse = verseKeywords.test(mt.citation) || (!isHadith && /Allah|revealed|verse/i.test(contextText));
    const cls = isHadith ? 'hadith-en' : (isVerse ? 'verse-en' : 'hadith-en');
    result += `<blockquote class="${cls}"><p>${escapeHtml(mt.quote)}</p><cite>${escapeHtml(mt.citation)}</cite></blockquote>`;
    lastEnd = mt.end;
  }
  const after = paragraphHtml.slice(lastEnd).trim();
  if (after) {
    const cleaned = after.replace(/^[\s:;,.—–-]+/, '').trim();
    if (cleaned) result += `<p>${cleaned}</p>`;
  }
  return result || `<p>${paragraphHtml}</p>`;
}

// ── Minify helpers (lightweight, no deps) ─────────────────────────────────────
function minifyHtml(s) {
  return s
    // collapse runs of whitespace between tags
    .replace(/>\s+</g, '><')
    // collapse interior whitespace runs to single space
    .replace(/\s{2,}/g, ' ')
    // remove comments (but keep IE conditionals if any — none here)
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
    .trim();
}
function minifyCss(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')   // strip block comments
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}
function minifyJs(s) {
  // Conservative minify: strip block + line comments and collapse whitespace
  // (preserves string literals because we don't tokenize)
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n\r]*/g, '$1')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── OG image generator (simple PNG using SVG → sharp-less, raw PNG via canvas) ─
// We generate a simple 1200x630 PNG per article + a default one.
// Using pure Node: build SVG → convert to PNG with @vercel/og? No, we're static.
// Instead, we write SVG files (small, crisp, supported everywhere) at /og/*.svg
// AND a /og-default.png fallback is not generated — we point og:image to .svg
// which works on most social platforms except some. So we'll generate SVGs.
function buildOgSvg({ title, subtitle = 'كلام له لازمه' }) {
  // Escape for SVG
  const t = escAttr(title).slice(0, 90);
  const s = escAttr(subtitle);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FAF9F6"/>
      <stop offset="100%" stop-color="#E7F1ED"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="0" y="0" width="14" height="630" fill="#166956"/>
  <rect x="0" y="560" width="1200" height="6" fill="#9A6B1F"/>
  <text x="60" y="120" font-family="Tahoma, Arial, sans-serif" font-size="28" font-weight="700" fill="#166956" direction="rtl">${s}</text>
  <text x="1140" y="120" font-family="Tahoma, Arial, sans-serif" font-size="28" font-weight="700" fill="#7C766C" text-anchor="end" direction="rtl">مقال بقلم زياد عمرو</text>
  <text x="60" y="320" font-family="Tahoma, Arial, sans-serif" font-size="64" font-weight="800" fill="#26231F" direction="rtl">${t}</text>
  <text x="60" y="500" font-family="Tahoma, Arial, sans-serif" font-size="22" font-weight="500" fill="#9A6B1F" direction="rtl">kalaam-site.vercel.app</text>
</svg>`;
}

// ── Build sitemap.xml ─────────────────────────────────────────────────────────
// Includes Arabic URLs (root) + English URLs (/en/) + hreflang alternates
function buildSitemap(articles, categories) {
  const urls = [
    { loc: `${SITE_URL}/`, priority: '1.0', changefreq: 'daily', alternates: [`${SITE_URL}/en/`] },
    { loc: `${SITE_URL}/start`, priority: '0.8', changefreq: 'monthly', alternates: [`${SITE_URL}/en/start`] },
    { loc: `${SITE_URL}/about`, priority: '0.6', changefreq: 'monthly', alternates: [`${SITE_URL}/en/about`] },
    // English root pages
    { loc: `${SITE_URL}/en/`, priority: '0.9', changefreq: 'daily', alternates: [`${SITE_URL}/`] },
    { loc: `${SITE_URL}/en/start`, priority: '0.7', changefreq: 'monthly', alternates: [`${SITE_URL}/start`] },
    { loc: `${SITE_URL}/en/about`, priority: '0.5', changefreq: 'monthly', alternates: [`${SITE_URL}/about`] },
  ];
  for (const c of categories) {
    urls.push({
      loc: `${SITE_URL}/category/${c.slug}`,
      priority: '0.5', changefreq: 'weekly',
      alternates: [`${SITE_URL}/en/category/${c.slug}`],
    });
    // English category page — only include if at least one translated article exists in this category
    const hasTranslated = c.articles.some(a => a.translated);
    if (hasTranslated) {
      urls.push({
        loc: `${SITE_URL}/en/category/${c.slug}`,
        priority: '0.4', changefreq: 'weekly',
        alternates: [`${SITE_URL}/category/${c.slug}`],
      });
    }
  }
  for (const a of articles) {
    const lastmod = isoDate(a.lastEditedTime || a.createdTime || Date.now());
    urls.push({
      loc: `${SITE_URL}/articles/${a.slug}`,
      priority: '0.8', changefreq: 'monthly', lastmod,
      alternates: a.translated ? [`${SITE_URL}/en/articles/${a.slug}`] : [],
    });
    if (a.translated) {
      urls.push({
        loc: `${SITE_URL}/en/articles/${a.slug}`,
        priority: '0.7', changefreq: 'monthly', lastmod,
        alternates: [`${SITE_URL}/articles/${a.slug}`],
      });
    }
  }
  const body = urls.map(u => {
    const altLinks = (u.alternates || []).map((alt, i) => {
      const lang = alt.startsWith(`${SITE_URL}/en/`) ? 'en' : 'ar';
      return `    <xhtml:link rel="alternate" hreflang="${lang}" href="${alt}"/>`;
    }).join('\n');
    return `  <url>
    <loc>${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}${altLinks ? '\n' + altLinks : ''}
  </url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${body}
</urlset>`;
}

// ── Build robots.txt ──────────────────────────────────────────────────────────
function buildRobots() {
  return `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;
}

// ── Build RSS feed (language-aware) ───────────────────────────────────────────
// lang='ar' → /feed.xml with Arabic articles
// lang='en' → /en/rss.xml with translated articles only
function buildRss(articles, lang = 'ar') {
  const feedArticles = lang === 'en' ? articles.filter(a => a.translated) : articles;
  const selfHref = lang === 'en' ? `${SITE_URL}/en/rss.xml` : `${SITE_URL}/feed.xml`;
  const siteName = t(lang, 'site.name');
  const siteDesc = t(lang, 'site.description');
  const articlePath = lang === 'en' ? `${SITE_URL}/en/articles/` : `${SITE_URL}/articles/`;
  const items = feedArticles.map(a => {
    const title = lang === 'en' ? (a.titleEn || a.title) : a.title;
    const excerpt = lang === 'en' ? (a.excerptEn || a.excerpt) : a.excerpt;
    const tag = localizeTag(lang, a.tag);
    return `    <item>
      <title>${escXml(title)}</title>
      <link>${articlePath}${a.slug}</link>
      <guid>${articlePath}${a.slug}</guid>
      <description>${escXml(excerpt)}</description>
      <category>${escXml(tag)}</category>${a.createdTime ? `\n      <pubDate>${new Date(a.createdTime).toUTCString()}</pubDate>` : ''}
    </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escXml(siteName)}</title>
    <link>${SITE_URL}${lang === 'en' ? '/en/' : '/'}</link>
    <atom:link href="${selfHref}" rel="self" type="application/rss+xml"/>
    <description>${escXml(siteDesc)}</description>
    <language>${lang}</language>
${items}
  </channel>
</rss>`;
}

// ── Build search-index.json (language-aware) ──────────────────────────────────
// Each language has its own search index with its own content
function buildSearchIndex(articles, lang = 'ar') {
  const feedArticles = lang === 'en' ? articles.filter(a => a.translated) : articles;
  return JSON.stringify(feedArticles.map(a => {
    const title = lang === 'en' ? (a.titleEn || a.title) : a.title;
    const excerpt = lang === 'en' ? (a.excerptEn || a.excerpt) : a.excerpt;
    const tag = localizeTag(lang, a.tag);
    return {
      title,
      excerpt,
      tag,
      categorySlug: a.categorySlug,
      slug: a.slug,
      icon: a.icon,
      readingTime: a.readingTime,
      level: a.level || '',
      series: a.series || '',
      hasVoweled: lang === 'ar' && !!a.voweledHtml,
      hasExercises: lang === 'ar' && !!(a.exercises && a.exercises.length),
      lang,
    };
  }));
}

// ── Client-side app.js (search + theme toggle + share copy) ──────────────────
function buildAppJs() {
  return `
(function(){
  "use strict";
  // ---------- i18n (loaded from server-rendered locale JSON, fallback to ar) ----------
  var I18N_RAW = window.SITE_I18N || {};
  var LANG = window.SITE_LANG || "ar";
  var I18N = I18N_RAW[LANG] || I18N_RAW.ar || {};
  // Fallbacks for any missing keys
  I18N.searchLoading = I18N.searchLoading || "جاري تحميل الفهرس…";
  I18N.searchNoResults = I18N.searchNoResults || "مفيش نتائج تطابق بحثك.";
  I18N.like = I18N.like || "أعجبني";
  I18N.liked = I18N.liked || "أعجبك";
  I18N.thanksForLike = I18N.thanksForLike || "شكرًا لإعجابك";
  I18N.alreadyLiked = I18N.alreadyLiked || "تم تسجيل إعجابك قبل كده";
  I18N.rateLimited = I18N.rateLimited || "وصلت للحد الأقصى";
  I18N.likeError = I18N.likeError || "فيه مشكلة، حاول تاني";
  I18N.noLikes = I18N.noLikes || "لا إعجابات بعد";
  I18N.publishing = I18N.publishing || "جاري النشر…";
  I18N.publishComment = I18N.publishComment || "نشر التعليق";
  I18N.commentError = I18N.commentError || "فيه مشكلة، حاول تاني";
  I18N.noComments = I18N.noComments || "لسه مفيش تعليقات — كن أول واحد يكتب";
  I18N.guest = I18N.guest || "زائر";
  I18N.now = I18N.now || "الآن";
  I18N.bookmarked = I18N.bookmarked || "محفوظ";
  I18N.bookmark = I18N.bookmark || "حفظ";
  I18N.copyTextDone = I18N.copyTextDone || "اتنسخ ✓";
  I18N.answerCorrect = I18N.answerCorrect || "✓ إجابة صحيحة! أحسنت.";
  I18N.answerWrong = I18N.answerWrong || "✗ مش صحيحة — شوف الإجابة الصحيحة باللون الأخضر.";
  I18N.clearAllConfirm = I18N.clearAllConfirm || "تمسح كل المحفوظات؟";
  I18N.saved = I18N.saved || "محفوظ";
  I18N.readArticle = I18N.readArticle || "اقرأ المقال";
  I18N.clearAll = I18N.clearAll || "مسح الكل";
  I18N.minutesAgo = I18N.minutesAgo || "منذ {n} دقيقة";
  I18N.hoursAgo = I18N.hoursAgo || "منذ {n} ساعة";
  I18N.daysAgo = I18N.daysAgo || "منذ {n} يوم";
  I18N.likesCount = I18N.likesCount || "إعجاب";
  // ---------- Theme toggle ----------
  var THEME_KEY = "kalaam-theme";
  var savedTheme = null;
  try { savedTheme = localStorage.getItem(THEME_KEY); } catch(e){}
  if (savedTheme === "light" || savedTheme === "dark") {
    document.documentElement.setAttribute("data-theme", savedTheme);
  }
  var themeBtn = document.getElementById("theme-btn");
  if (themeBtn) {
    themeBtn.addEventListener("click", function(){
      var current = document.documentElement.getAttribute("data-theme");
      var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      var isDark = current === "dark" || (current === null && prefersDark);
      var next = isDark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem(THEME_KEY, next); } catch(e){}
    });
  }

  // ---------- Search ----------
  var searchIndex = null;
  var searchOverlay = document.getElementById("search-overlay");
  var searchInput = document.getElementById("search-input");
  var searchResults = document.getElementById("search-results");
  var searchBtn = document.getElementById("search-btn");
  var searchClose = document.getElementById("search-close");

  function openSearch(){
    if (!searchOverlay) return;
    searchOverlay.classList.add("open");
    setTimeout(function(){ if (searchInput) searchInput.focus(); }, 50);
    if (!searchIndex) loadIndex();
  }
  function closeSearch(){
    if (!searchOverlay) return;
    searchOverlay.classList.remove("open");
    if (searchInput) searchInput.value = "";
    if (searchResults) searchResults.innerHTML = "";
  }
  function loadIndex(){
    var base = window.SITE_BASE || "";
    var lang = window.SITE_LANG || "ar";
    // Arabic: /search-index.json   English: /en/search-index.json
    var idxUrl = lang === "en" ? "/en/search-index.json" : "/search-index.json";
    fetch(idxUrl)
      .then(function(r){ return r.json(); })
      .then(function(d){ searchIndex = d; })
      .catch(function(){ searchIndex = []; });
  }
  function normalize(s){ return (s||"").toLowerCase().replace(/[\\u064B-\\u0652]/g, ""); }
  function escapeHtml(s){ return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function highlight(text, q){
    if (!q) return escapeHtml(text);
    var nText = normalize(text);
    var nQ = normalize(q);
    var idx = nText.indexOf(nQ);
    if (idx < 0) return escapeHtml(text);
    var before = text.slice(0, idx);
    var match = text.slice(idx, idx + q.length);
    var after = text.slice(idx + q.length);
    return escapeHtml(before) + '<mark class="search-mark">' + escapeHtml(match) + '</mark>' + escapeHtml(after);
  }
  function renderResults(q){
    if (!searchResults) return;
    if (!q) { searchResults.innerHTML = ""; return; }
    var lang = window.SITE_LANG || "ar";
    if (!searchIndex) { searchResults.innerHTML = '<div class="search-empty">' + I18N.searchLoading + '</div>'; return; }
    var nQ = normalize(q);
    var matches = searchIndex.filter(function(a){
      return normalize(a.title).indexOf(nQ) >= 0 || normalize(a.excerpt).indexOf(nQ) >= 0 || normalize(a.tag).indexOf(nQ) >= 0;
    }).slice(0, 8);
    if (matches.length === 0) {
      searchResults.innerHTML = '<div class="search-empty">' + I18N.searchNoResults + '</div>';
      return;
    }
    searchResults.innerHTML = matches.map(function(a){
      // Use absolute URL based on language
      var href = lang === 'en' ? '/en/articles/' + a.slug : '/articles/' + a.slug;
      return '<a class="search-result" href="' + href + '">' +
        '<span class="sr-tag">' + escapeHtml(a.tag) + '</span>' +
        '<span class="sr-title">' + highlight(a.title, q) + '</span>' +
        '<span class="sr-excerpt">' + highlight(a.excerpt, q) + '</span>' +
      '</a>';
    }).join("");
  }
  if (searchBtn) searchBtn.addEventListener("click", openSearch);
  if (searchClose) searchClose.addEventListener("click", closeSearch);
  if (searchOverlay) searchOverlay.addEventListener("click", function(e){
    if (e.target === searchOverlay) closeSearch();
  });
  if (searchInput) searchInput.addEventListener("input", function(){ renderResults(searchInput.value); });
  document.addEventListener("keydown", function(e){
    if (e.key === "Escape") closeSearch();
    if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); openSearch(); }
    if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
      e.preventDefault(); openSearch();
    }
  });

  // ---------- Share: copy link ----------
  document.querySelectorAll(".share-btn[data-net='copy']").forEach(function(btn){
    btn.addEventListener("click", function(){
      var url = btn.getAttribute("data-url");
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function(){
          btn.classList.add("copied");
          setTimeout(function(){ btn.classList.remove("copied"); }, 1500);
        });
      } else {
        var ta = document.createElement("textarea");
        ta.value = url; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); btn.classList.add("copied"); setTimeout(function(){ btn.classList.remove("copied"); }, 1500); } catch(e){}
        document.body.removeChild(ta);
      }
    });
  });

  // ---------- Tashkeel toggle ----------
  var tashkeelBtn = document.getElementById("tashkeel-btn");
  var articleMain = document.getElementById("article-main");
  var articleVoweled = document.getElementById("article-voweled");
  if (tashkeelBtn && articleMain && articleVoweled) {
    tashkeelBtn.addEventListener("click", function(){
      var isVoweled = articleVoweled.hasAttribute("hidden") === false;
      if (isVoweled) {
        articleVoweled.setAttribute("hidden", "");
        articleMain.removeAttribute("hidden");
        tashkeelBtn.setAttribute("aria-pressed", "false");
        tashkeelBtn.classList.remove("active");
      } else {
        articleMain.setAttribute("hidden", "");
        articleVoweled.removeAttribute("hidden");
        tashkeelBtn.setAttribute("aria-pressed", "true");
        tashkeelBtn.classList.add("active");
      }
      // Scroll back to top of article
      var head = document.querySelector(".article-head");
      if (head) head.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // ---------- Font size A-/A+ ----------
  var FONT_KEY = "kalaam-font-size";
  var FONT_MIN = 0.85, FONT_MAX = 1.35;
  var savedFont = null;
  try { savedFont = parseFloat(localStorage.getItem(FONT_KEY)); } catch(e){}
  if (isNaN(savedFont)) savedFont = 1.0;
  savedFont = Math.max(FONT_MIN, Math.min(FONT_MAX, savedFont));
  function applyFont(scale){
    var body = document.body;
    if (body) body.style.setProperty("--font-scale", scale);
  }
  applyFont(savedFont);
  var fontInc = document.getElementById("font-inc");
  var fontDec = document.getElementById("font-dec");
  if (fontInc) fontInc.addEventListener("click", function(){
    savedFont = Math.min(FONT_MAX, +(savedFont + 0.05).toFixed(2));
    try { localStorage.setItem(FONT_KEY, savedFont); } catch(e){}
    applyFont(savedFont);
  });
  if (fontDec) fontDec.addEventListener("click", function(){
    savedFont = Math.max(FONT_MIN, +(savedFont - 0.05).toFixed(2));
    try { localStorage.setItem(FONT_KEY, savedFont); } catch(e){}
    applyFont(savedFont);
  });

  // ---------- Bookmark (save for later) ----------
  var BM_KEY = "kalaam-bookmarks";
  function getBookmarks(){
    try { return JSON.parse(localStorage.getItem(BM_KEY) || "[]"); } catch(e){ return []; }
  }
  function setBookmarks(arr){
    try { localStorage.setItem(BM_KEY, JSON.stringify(arr)); } catch(e){}
  }
  var bookmarkBtn = document.getElementById("bookmark-btn");
  function isBookmarked(slug){
    return getBookmarks().some(function(b){ return b.slug === slug; });
  }
  function syncBookmarkBtn(){
    if (!bookmarkBtn) return;
    var slug = bookmarkBtn.getAttribute("data-slug");
    var saved = isBookmarked(slug);
    bookmarkBtn.setAttribute("aria-pressed", saved ? "true" : "false");
    bookmarkBtn.classList.toggle("active", saved);
    var label = bookmarkBtn.querySelector(".rc-label");
    if (label) label.textContent = saved ? I18N.bookmarked : I18N.bookmark;
  }
  if (bookmarkBtn) {
    syncBookmarkBtn();
    bookmarkBtn.addEventListener("click", function(){
      var slug = bookmarkBtn.getAttribute("data-slug");
      var title = bookmarkBtn.getAttribute("data-title");
      var icon = bookmarkBtn.getAttribute("data-icon");
      var excerpt = bookmarkBtn.getAttribute("data-excerpt");
      var arr = getBookmarks();
      var existing = arr.findIndex(function(b){ return b.slug === slug; });
      if (existing >= 0) {
        arr.splice(existing, 1);
      } else {
        arr.unshift({ slug: slug, title: title, icon: icon, excerpt: excerpt, savedAt: Date.now() });
      }
      setBookmarks(arr);
      syncBookmarkBtn();
    });
  }

  // ---------- Bookmarks section on home page ----------
  var bmSection = document.getElementById("bookmarks-section");
  var bmGrid = document.getElementById("bookmarks-grid");
  var bmClear = document.getElementById("bm-clear");
  function renderBookmarks(){
    if (!bmSection || !bmGrid) return;
    var arr = getBookmarks();
    if (!arr.length) {
      bmSection.setAttribute("hidden", "");
      bmGrid.innerHTML = "";
      return;
    }
    bmSection.removeAttribute("hidden");
    bmGrid.innerHTML = arr.map(function(b){
      var bookmarkBase = LANG === 'en' ? '/en/articles/' : 'articles/';
      return '<a class="card bookmark-card" href="' + bookmarkBase + b.slug + '">' +
        '<div class="card-top"><span class="card-icon" aria-hidden="true">' + (b.icon || "📝") + '</span>' +
        '<button class="bm-remove" type="button" data-slug="' + b.slug + '" aria-label="' + I18N.clearAll + '" onclick="event.stopPropagation();event.preventDefault();">×</button></div>' +
        '<h3>' + escapeHtml(b.title) + '</h3>' +
        '<p>' + escapeHtml(b.excerpt || "") + '</p>' +
        '<div class="card-meta"><span class="time">' + I18N.saved + '</span><span class="read">' + I18N.readArticle + ' <span class="arr" aria-hidden="true">←</span></span></div>' +
      '</a>';
    }).join("");
    bmGrid.querySelectorAll(".bm-remove").forEach(function(btn){
      btn.addEventListener("click", function(e){
        e.stopPropagation(); e.preventDefault();
        var s = btn.getAttribute("data-slug");
        var a = getBookmarks().filter(function(b){ return b.slug !== s; });
        setBookmarks(a);
        renderBookmarks();
      });
    });
  }
  renderBookmarks();
  if (bmClear) bmClear.addEventListener("click", function(){
    if (confirm(I18N.clearAllConfirm)) {
      setBookmarks([]);
      renderBookmarks();
      syncBookmarkBtn();
    }
  });

  // ---------- Copy text button ----------
  var copyTextBtn = document.getElementById("copy-text-btn");
  if (copyTextBtn) {
    copyTextBtn.addEventListener("click", function(){
      var titleEl = document.getElementById("plain-text-data");
      if (!titleEl) return;
      var title = titleEl.getAttribute("data-title") || "";
      var text = titleEl.textContent || "";
      var header = "من موقع «كلام له لازمه» — kalaam-site.vercel.app\\n\\n" + title + "\\n" + "═".repeat(50) + "\\n\\n";
      var full = header + text + "\\n\\n" + "═".repeat(50) + "\\n" + "المصدر: https://kalaam-site.vercel.app/articles/" + (window.__ARTICLE_SLUG || "");
      var label = copyTextBtn.querySelector(".rc-label");
      function done(){
        if (label) { var o = label.textContent; label.textContent = I18N.copyTextDone; setTimeout(function(){ label.textContent = o; }, 1500); }
        copyTextBtn.classList.add("copied");
        setTimeout(function(){ copyTextBtn.classList.remove("copied"); }, 1500);
      }
      if (navigator.clipboard) {
        navigator.clipboard.writeText(full).then(done).catch(function(){
          var ta = document.createElement("textarea"); ta.value = full; document.body.appendChild(ta); ta.select();
          try { document.execCommand("copy"); done(); } catch(e){}
          document.body.removeChild(ta);
        });
      } else {
        var ta = document.createElement("textarea"); ta.value = full; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); done(); } catch(e){}
        document.body.removeChild(ta);
      }
    });
  }

  // ---------- Teacher mode (print view) ----------
  var teacherBtn = document.getElementById("teacher-btn");
  if (teacherBtn) {
    teacherBtn.addEventListener("click", function(){
      document.body.classList.add("teacher-mode");
      // Hide all answers in exercises for print
      document.querySelectorAll(".ex-answer").forEach(function(el){ el.setAttribute("hidden", ""); });
      document.querySelectorAll(".ex-option").forEach(function(el){
        el.removeAttribute("data-correct-mark");
        el.classList.remove("correct", "wrong");
      });
      setTimeout(function(){
        window.print();
        // Cleanup after print dialog closes
        setTimeout(function(){
          document.body.classList.remove("teacher-mode");
        }, 500);
      }, 100);
    });
  }

  // ---------- Interactive exercises: MCQ click + reveal ----------
  document.querySelectorAll(".ex-option").forEach(function(opt){
    opt.addEventListener("click", function(){
      var parent = opt.closest(".ex-question");
      if (!parent || parent.classList.contains("answered")) return;
      parent.classList.add("answered");
      var correct = opt.getAttribute("data-correct") === "1";
      // Mark all options: highlight correct one green, the chosen wrong one red
      parent.querySelectorAll(".ex-option").forEach(function(o){
        var isThisCorrect = o.getAttribute("data-correct") === "1";
        if (isThisCorrect) o.classList.add("correct");
        else if (o === opt) o.classList.add("wrong");
        o.setAttribute("disabled", "");
      });
      var feedback = parent.querySelector(".ex-feedback");
      if (feedback) {
        if (correct) {
          feedback.textContent = I18N.answerCorrect;
          feedback.className = "ex-feedback correct";
        } else {
          feedback.textContent = I18N.answerWrong;
          feedback.className = "ex-feedback wrong";
        }
      }
    });
  });
  document.querySelectorAll(".ex-reveal").forEach(function(btn){
    btn.addEventListener("click", function(){
      var i3rab = btn.closest(".ex-i3rab");
      if (!i3rab) return;
      var ans = i3rab.querySelector(".ex-answer");
      if (!ans) return;
      var isOpen = ans.hasAttribute("hidden") === false;
      if (isOpen) {
        ans.setAttribute("hidden", "");
        btn.setAttribute("aria-expanded", "false");
        btn.classList.remove("active");
      } else {
        ans.removeAttribute("hidden");
        btn.setAttribute("aria-expanded", "true");
        btn.classList.add("active");
      }
    });
  });

  // ---------- Engagement: likes + comments ----------
  var ENGAGEMENT_API_BASE = (window.SITE_BASE || '/') + 'api';
  // Vercel serves /api at root regardless of SITE_BASE
  ENGAGEMENT_API_BASE = '/api';

  // Device fingerprint (lightweight, no external dep): canvas + UA + screen + tz
  function generateFingerprint(){
    try {
      var canvas = document.createElement('canvas');
      canvas.width = 200; canvas.height = 50;
      var ctx = canvas.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(0, 0, 200, 50);
      ctx.fillStyle = '#069';
      ctx.fillText('kalaam-fp-' + new Date().getTimezoneOffset(), 2, 2);
      var dataUrl = canvas.toDataURL();
      var fp = [
        navigator.userAgent,
        navigator.language,
        screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
        new Date().getTimezoneOffset(),
        dataUrl.slice(-64)
      ].join('|');
      // Simple hash → 32-char hex
      var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
      for (var i = 0; i < fp.length; i++) {
        var c = fp.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 2654435761);
        h2 = Math.imul(h2 ^ c, 1597334677);
      }
      h1 = (h1 >>> 0).toString(16).padStart(8, '0');
      h2 = (h2 >>> 0).toString(16).padStart(8, '0');
      var extra = (Math.imul(h1.charCodeAt(0), h2.charCodeAt(1)) >>> 0).toString(16).padStart(8, '0');
      var extra2 = (Math.imul(h2.charCodeAt(2), h1.charCodeAt(3)) >>> 0).toString(16).padStart(8, '0');
      return h1 + h2 + extra + extra2;
    } catch(e) {
      return 'fp-' + Math.random().toString(36).slice(2) + '-' + Date.now();
    }
  }

  var FINGERPRINT_KEY = 'kalaam-fp';
  function getFingerprint(){
    try {
      var fp = localStorage.getItem(FINGERPRINT_KEY);
      if (!fp || fp.length < 16) {
        fp = generateFingerprint();
        localStorage.setItem(FINGERPRINT_KEY, fp);
      }
      return fp;
    } catch(e) {
      return generateFingerprint();
    }
  }

  var LIKED_KEY = 'kalaam-liked';
  function getLikedSlugs(){
    try { return JSON.parse(localStorage.getItem(LIKED_KEY) || '[]'); } catch(e){ return []; }
  }
  function setLikedSlugs(arr){
    try { localStorage.setItem(LIKED_KEY, JSON.stringify(arr)); } catch(e){}
  }

  function toArabicNum(n){
    n = String(n);
    var map = {'0':'٠','1':'١','2':'٢','3':'٣','4':'٤','5':'٥','6':'٦','7':'٧','8':'٨','9':'٩'};
    return n.replace(/[0-9]/g, function(d){ return map[d]; });
  }

  function fmtTimeAgo(ts){
    var diff = Date.now() - ts;
    var sec = Math.floor(diff / 1000);
    var min = Math.floor(sec / 60);
    var hr = Math.floor(min / 60);
    var day = Math.floor(hr / 24);
    if (sec < 60) return I18N.now;
    if (min < 60) return I18N.minutesAgo.replace('{n}', toArabicNum(min));
    if (hr < 24) return I18N.hoursAgo.replace('{n}', toArabicNum(hr));
    if (day < 30) return I18N.daysAgo.replace('{n}', toArabicNum(day));
    return new Date(ts).toLocaleDateString(LANG === 'en' ? 'en-US' : 'ar-EG');
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  // Like button on article page
  var likeBtn = document.getElementById('like-btn');
  var likeCount = document.getElementById('like-count');
  var likeMsg = document.getElementById('like-msg');
  if (likeBtn) {
    var slug = likeBtn.getAttribute('data-slug');
    var fp = getFingerprint();
    var likedSlugs = getLikedSlugs();
    var isLiked = likedSlugs.indexOf(slug) !== -1;
    if (isLiked) {
      likeBtn.classList.add('is-liked');
      likeBtn.setAttribute('aria-pressed', 'true');
      likeBtn.querySelector('.like-label').textContent = I18N.liked;
    }

    // Fetch initial count
    fetch(ENGAGEMENT_API_BASE + '/likes?slug=' + encodeURIComponent(slug))
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d && typeof d.count === 'number') {
          updateLikeCount(d.count);
        }
      })
      .catch(function(){ /* silent */ });

    function updateLikeCount(count){
      if (!likeCount) return;
      if (count === 0) {
        likeCount.textContent = likeCount.getAttribute('data-zero') || I18N.noLikes;
        likeCount.classList.remove('has-likes');
      } else {
        likeCount.textContent = toArabicNum(count) + ' ' + (I18N.likesCount || 'إعجاب');
        likeCount.classList.add('has-likes');
      }
    }

    function showMsg(text, kind){
      if (!likeMsg) return;
      likeMsg.textContent = text;
      likeMsg.className = 'like-msg show ' + (kind || '');
      setTimeout(function(){ likeMsg.className = 'like-msg'; }, 3500);
    }

    likeBtn.addEventListener('click', function(){
      likeBtn.classList.add('loading');
      var wasLiked = likeBtn.classList.contains('is-liked');
      var method = wasLiked ? 'DELETE' : 'POST';
      fetch(ENGAGEMENT_API_BASE + '/like', {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slug, fingerprint: fp })
      })
        .then(function(r){ return r.json(); })
        .then(function(d){
          likeBtn.classList.remove('loading');
          if (d.error) { showMsg(d.error, 'error'); return; }
          if (typeof d.count === 'number') updateLikeCount(d.count);
          if (d.ok && d.liked) {
            likeBtn.classList.add('is-liked');
            likeBtn.setAttribute('aria-pressed', 'true');
            likeBtn.querySelector('.like-label').textContent = I18N.liked;
            if (likedSlugs.indexOf(slug) === -1) { likedSlugs.push(slug); setLikedSlugs(likedSlugs); }
            showMsg(I18N.thanksForLike, 'success');
          } else if (d.ok && d.liked === false) {
            likeBtn.classList.remove('is-liked');
            likeBtn.setAttribute('aria-pressed', 'false');
            likeBtn.querySelector('.like-label').textContent = I18N.like;
            var i = likedSlugs.indexOf(slug);
            if (i !== -1) { likedSlugs.splice(i, 1); setLikedSlugs(likedSlugs); }
          } else if (d.alreadyLiked) {
            likeBtn.classList.add('is-liked');
            likeBtn.setAttribute('aria-pressed', 'true');
            likeBtn.querySelector('.like-label').textContent = I18N.liked;
            showMsg(d.message || I18N.alreadyLiked, 'success');
          } else if (d.rateLimited) {
            showMsg(d.message || I18N.rateLimited, 'error');
          }
        })
        .catch(function(){
          likeBtn.classList.remove('loading');
          showMsg(I18N.likeError, 'error');
        });
    });
  }

  // Comments on article page
  var commentForm = document.getElementById('comment-form');
  var commentList = document.getElementById('comment-list');
  var commentsCount = document.getElementById('comments-count');
  var commentSlug = commentForm ? commentForm.getAttribute('data-slug') : null;
  if (commentForm && commentSlug) {
    var commentFp = getFingerprint();

    function renderComment(c, isMine){
      var div = document.createElement('div');
      div.className = 'comment-item' + (isMine ? ' is-mine' : '');
      var initial = (c.name || 'ز').charAt(0);
      div.innerHTML =
        '<div class="comment-top">' +
          '<span class="comment-author"><span class="comment-avatar">' + escapeHtml(initial) + '</span>' + escapeHtml(c.name || I18N.guest) + '</span>' +
          '<span class="comment-time">' + escapeHtml(fmtTimeAgo(c.ts)) + '</span>' +
        '</div>' +
        '<div class="comment-text">' + escapeHtml(c.text) + '</div>';
      return div;
    }

    function renderEmpty(){
      var div = document.createElement('div');
      div.className = 'comment-empty';
      div.textContent = I18N.noComments;
      return div;
    }

    function updateCommentsCount(count){
      if (!commentsCount) return;
      commentsCount.textContent = toArabicNum(count);
    }

    // Load existing comments
    fetch(ENGAGEMENT_API_BASE + '/comments?slug=' + encodeURIComponent(commentSlug))
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (!d || !d.items) return;
        updateCommentsCount(d.count || 0);
        commentList.innerHTML = '';
        if (d.items.length === 0) {
          commentList.appendChild(renderEmpty());
        } else {
          d.items.forEach(function(c){
            commentList.appendChild(renderComment(c, false));
          });
        }
      })
      .catch(function(){ /* silent */ });

    commentForm.addEventListener('submit', function(e){
      e.preventDefault();
      var submitBtn = document.getElementById('comment-submit');
      var nameInput = commentForm.querySelector('input[name="name"]');
      var textInput = commentForm.querySelector('textarea[name="text"]');
      var hpInput = commentForm.querySelector('input[name="website"]');
      var name = nameInput ? nameInput.value : '';
      var text = textInput ? textInput.value : '';
      var hp = hpInput ? hpInput.value : '';
      if (!text.trim()) return;
      submitBtn.disabled = true;
      submitBtn.textContent = I18N.publishing;
      fetch(ENGAGEMENT_API_BASE + '/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: commentSlug, name: name, text: text, fingerprint: commentFp, website: hp })
      })
        .then(function(r){ return r.json(); })
        .then(function(d){
          submitBtn.disabled = false;
          submitBtn.textContent = I18N.publishComment;
          if (d.error) { alert(d.error); return; }
          if (d.ok && d.fake) {
            // Honeypot triggered — silently "succeed" without actually adding
            commentForm.reset();
            return;
          }
          if (d.ok && d.comment) {
            // Remove empty placeholder
            var empty = commentList.querySelector('.comment-empty');
            if (empty) empty.remove();
            commentList.insertBefore(renderComment(d.comment, true), commentList.firstChild);
            updateCommentsCount(d.count);
            commentForm.reset();
          }
        })
        .catch(function(){
          submitBtn.disabled = false;
          submitBtn.textContent = I18N.publishComment;
          alert(I18N.commentError);
        });
    });
  }

  // Card stats on homepage / category pages — fetch likes+comments counts in batch
  var statEls = document.querySelectorAll('.card-stats[data-slug]');
  if (statEls.length > 0) {
    var slugs = [];
    statEls.forEach(function(el){
      var s = el.getAttribute('data-slug');
      if (slugs.indexOf(s) === -1) slugs.push(s);
    });
    Promise.all([
      fetch(ENGAGEMENT_API_BASE + '/likes?slugs=' + encodeURIComponent(slugs.join(','))).then(function(r){ return r.json(); }),
      fetch(ENGAGEMENT_API_BASE + '/comments?slugs=' + encodeURIComponent(slugs.join(','))).then(function(r){ return r.json(); })
    ]).then(function(results){
      var likes = results[0] && results[0].items ? results[0].items : [];
      var comments = results[1] && results[1].items ? results[1].items : [];
      var likeMap = {}, commentMap = {};
      likes.forEach(function(x){ likeMap[x.slug] = x.count; });
      comments.forEach(function(x){ commentMap[x.slug] = x.count; });
      statEls.forEach(function(el){
        var s = el.getAttribute('data-slug');
        var l = likeMap[s] || 0;
        var c = commentMap[s] || 0;
        var lNum = el.querySelector('.stat-likes-num');
        var cNum = el.querySelector('.stat-comments-num');
        if (lNum) lNum.textContent = l > 0 ? toArabicNum(l) : '·';
        if (cNum) cNum.textContent = c > 0 ? toArabicNum(c) : '·';
        el.classList.remove('is-loading');
      });
    }).catch(function(){ /* silent */ });
  }
})();
`;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('⏳ جاري سحب المقالات من Notion...');

  const response = await notion.databases.query({
    database_id: DB_ID,
    filter: { property: 'منشور', checkbox: { equals: true } },
    sorts: [{ timestamp: 'created_time', direction: 'descending' }],
  });

  const articles = [];
  for (const page of response.results) {
    const props = page.properties;
    const title = props['العنوان']?.title?.[0]?.plain_text || 'بدون عنوان';
    const slug  = props['Slug']?.rich_text?.[0]?.plain_text || page.id;
    const tag   = props['التصنيف']?.select?.name || 'متفرقات';
    const excerpt = props['المقتطف']?.rich_text?.[0]?.plain_text || '';
    const icon  = props['الأيقونة']?.rich_text?.[0]?.plain_text || '📝';
    const level = props['المستوى']?.select?.name || '';
    const series = (props['السلسلة']?.rich_text || []).map(r => r.plain_text).join('').trim() || '';
    const seriesOrder = props['الترتيب في السلسلة']?.number ?? null;
    // New: English title + excerpt
    const titleEn = (props['العنوان EN']?.rich_text || []).map(r => r.plain_text).join('').trim() || '';
    const excerptEn = (props['المقتطف EN']?.rich_text || []).map(r => r.plain_text).join('').trim() || '';

    console.log(`  📄 ${title}  [level=${level || '-'}, series=${series || '-'}, order=${seriesOrder ?? '-'}, en=${titleEn ? '✓' : '-'}]`);
    const data = await getArticleData(page.id);
    const readingTimeVal = readingTime(data.mainHtml);
    const readingTimeEnVal = data.englishHtml ? readingTime(data.englishHtml) : readingTimeVal;

    // Article is "translated" only if: published=true + EN title not empty + English Version toggle exists
    const translated = !!(titleEn && data.hasEnglish);

    articles.push({
      title, slug, tag, excerpt, icon,
      level, series, seriesOrder,
      titleEn, excerptEn,
      mainHtml: data.mainHtml,
      voweledHtml: data.voweledHtml,
      exercisesHtml: data.exercisesHtml,
      exercises: data.exercises,
      plainText: data.plainText,
      englishHtml: data.englishHtml,
      englishPlainText: data.englishPlainText,
      hasEnglish: data.hasEnglish,
      translated,
      readingTime: readingTimeVal,
      readingTimeEn: readingTimeEnVal,
      pageId: page.id,
      categorySlug: slugifyArabicTag(tag),
      createdTime: page.created_time,
      lastEditedTime: page.last_edited_time,
    });
  }

  // Group by category
  const categoriesMap = new Map();
  for (const a of articles) {
    if (!categoriesMap.has(a.categorySlug)) {
      categoriesMap.set(a.categorySlug, { name: a.tag, slug: a.categorySlug, articles: [] });
    }
    categoriesMap.get(a.categorySlug).articles.push(a);
  }
  const categories = [...categoriesMap.values()];

  // Create output dirs (Arabic at root + English at /en/)
  fs.mkdirSync('site/articles', { recursive: true });
  fs.mkdirSync('site/category', { recursive: true });
  fs.mkdirSync('site/css', { recursive: true });
  fs.mkdirSync('site/js', { recursive: true });
  fs.mkdirSync('site/fonts', { recursive: true });
  fs.mkdirSync('site/og', { recursive: true });
  fs.mkdirSync('site/en', { recursive: true });
  fs.mkdirSync('site/en/articles', { recursive: true });
  fs.mkdirSync('site/en/category', { recursive: true });

  // Copy static assets
  fs.writeFileSync('site/css/style.css', minifyCss(CSS_SOURCE), 'utf8');
  console.log('✅ css/style.css (minified)');

  // Copy fonts (binary, no minify)
  const fontsSrcDir = path.join(__dirname, 'src', 'fonts');
  if (fs.existsSync(fontsSrcDir)) {
    for (const f of fs.readdirSync(fontsSrcDir)) {
      if (f.endsWith('.woff2') || f.endsWith('.ttf')) {
        fs.copyFileSync(path.join(fontsSrcDir, f), path.join('site', 'fonts', f));
      }
    }
    console.log(`✅ fonts/ (${fs.readdirSync('site/fonts').length} files)`);
  }

  // app.js (minified, language-agnostic — uses window.SITE_LANG at runtime)
  fs.writeFileSync('site/js/app.js', minifyJs(buildAppJs()), 'utf8');
  console.log('✅ js/app.js (minified)');

  // search-index.json (Arabic — all articles)
  fs.writeFileSync('site/search-index.json', buildSearchIndex(articles, 'ar'), 'utf8');
  console.log('✅ search-index.json (Arabic)');

  // English search-index.json (only translated articles)
  fs.writeFileSync('site/en/search-index.json', buildSearchIndex(articles, 'en'), 'utf8');
  console.log('✅ en/search-index.json (English)');

  // sitemap.xml (includes both AR + EN URLs with hreflang alternates)
  fs.writeFileSync('site/sitemap.xml', buildSitemap(articles, categories), 'utf8');
  console.log('✅ sitemap.xml (bilingual)');

  // robots.txt
  fs.writeFileSync('site/robots.txt', buildRobots(), 'utf8');
  console.log('✅ robots.txt');

  // feed.xml (Arabic RSS)
  fs.writeFileSync('site/feed.xml', buildRss(articles, 'ar'), 'utf8');
  console.log('✅ feed.xml (Arabic)');

  // en/rss.xml (English RSS — only translated articles)
  fs.writeFileSync('site/en/rss.xml', buildRss(articles, 'en'), 'utf8');
  console.log('✅ en/rss.xml (English)');

  // OG images (SVG per article + default). og:image URLs in shell() use .svg directly.
  fs.writeFileSync('site/og-default.svg', buildOgSvg({ title: 'مقالات في الوعي والقيم', subtitle: 'كلام له لازمه' }), 'utf8');
  for (const a of articles) {
    fs.writeFileSync(`site/og/${a.slug}.svg`, buildOgSvg({ title: a.title, subtitle: 'كلام له لازمه' }), 'utf8');
  }
  console.log(`✅ og/ (${articles.length + 1} SVG images)`);

  // 404 pages (AR + EN)
  fs.writeFileSync('site/404.html', minifyHtml(build404('ar')), 'utf8');
  fs.writeFileSync('site/en/404.html', minifyHtml(build404('en')), 'utf8');
  console.log('✅ 404.html + en/404.html');

  // About pages (AR + EN)
  fs.writeFileSync('site/about.html', minifyHtml(buildAbout('ar')), 'utf8');
  fs.writeFileSync('site/en/about.html', minifyHtml(buildAbout('en')), 'utf8');
  console.log('✅ about.html + en/about.html');

  // /start pages (AR + EN)
  fs.writeFileSync('site/start.html', minifyHtml(buildStart(articles, 'ar')), 'utf8');
  fs.writeFileSync('site/en/start.html', minifyHtml(buildStart(articles, 'en')), 'utf8');
  console.log('✅ start.html + en/start.html');

  // /admin page (Arabic-only — backend moderation tool)
  fs.writeFileSync('site/admin.html', minifyHtml(buildAdmin()), 'utf8');
  console.log('✅ admin.html (Arabic-only)');

  // Index pages (AR + EN)
  fs.writeFileSync('site/index.html', minifyHtml(buildIndex(articles, 'ar')), 'utf8');
  fs.writeFileSync('site/en/index.html', minifyHtml(buildIndex(articles, 'en')), 'utf8');
  console.log('✅ index.html + en/index.html');

  // Article pages (AR for all + EN only for translated)
  let enArticleCount = 0;
  for (const a of articles) {
    fs.writeFileSync(`site/articles/${a.slug}.html`, minifyHtml(buildArticle(a, articles, 'ar')), 'utf8');
    if (a.translated) {
      fs.writeFileSync(`site/en/articles/${a.slug}.html`, minifyHtml(buildArticle(a, articles, 'en')), 'utf8');
      enArticleCount++;
    }
  }
  console.log(`✅ articles/ (${articles.length} Arabic) + en/articles/ (${enArticleCount} English)`);

  // Category pages (AR for all categories + EN only for categories with translated articles)
  let enCategoryCount = 0;
  for (const c of categories) {
    fs.writeFileSync(`site/category/${c.slug}.html`, minifyHtml(buildCategoryPage(c.name, c.slug, c.articles, 1, 'ar')), 'utf8');
    const translatedArticles = c.articles.filter(a => a.translated);
    if (translatedArticles.length > 0) {
      // For EN category page, use English category name + only translated articles
      const enCatName = localizeTag('en', c.name);
      fs.writeFileSync(`site/en/category/${c.slug}.html`, minifyHtml(buildCategoryPage(enCatName, c.slug, translatedArticles, 2, 'en')), 'utf8');
      enCategoryCount++;
    }
  }
  console.log(`✅ category/ (${categories.length} Arabic) + en/category/ (${enCategoryCount} English)`);

  const translatedCount = articles.filter(a => a.translated).length;
  console.log(`\n🎉 تم البناء! ${articles.length} مقالات (${translatedCount} مترجمة للإنجليزية)، ${categories.length} تصنيفات.`);
}

main().catch(e => { console.error(e); process.exit(1); });
