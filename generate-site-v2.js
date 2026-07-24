/* ============================================================
   generate-site-v2.js — Redesign v2 (editorial, calm, premium)
   Reads Notion data + locales, outputs new HTML/CSS/JS to site/.
   Builds: Style Guide, Home (AR+EN), Article (AR+EN), 404,
           sitemap, RSS, search-index, OG images.
   ============================================================ */

try { require('dotenv').config(); } catch (_) {}

const fs = require('fs');
const path = require('path');
const lib = require('./lib-v2.js');
const {
  LOCALES, t, fmtNum, localizeTag, localizeLevel, localizeDate,
  readingTime, toArabicDigits, escAttr, escXml, slugifyArabicTag, isoDate, escapeHtml,
  getArticleData, buildToc, ICONS, CSS_SOURCE, SITE_URL, notion, DB_ID,
} = lib;

// ── Minify helpers (lightweight, no deps) ──────────────────
function minifyHtml(s) {
  return s.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').replace(/<!--(?!\[if)[\s\S]*?-->/g, '').trim();
}
function minifyCss(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{}:;,>])\s*/g, '$1').replace(/;}/g, '}').trim();
}
function minifyJs(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n\r]*/g, '$1').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').replace(/\n{2,}/g, '\n').replace(/\s{2,}/g, ' ').trim();
}

// ── Determine article's translated peer slug for hreflang ─
// (translated article has the SAME slug on both / and /en/)
function langSwitchHrefFor(article, lang) {
  if (lang === 'ar') {
    // AR → EN: if article is translated, link to /en/articles/{slug}, else /en/
    return article.translated ? `/en/articles/${article.slug}` : '/en/';
  } else {
    // EN → AR: always link back to /articles/{slug} (article must exist in AR)
    return `/articles/${article.slug}`;
  }
}

// ── Font preload tags (per-language) ───────────────────────
function fontPreloads(lang) {
  if (lang === 'ar') {
    return `
      <link rel="preload" href="/fonts/tajawal-500-ar.woff2" as="font" type="font/woff2" crossorigin>
      <link rel="preload" href="/fonts/amiri-700-ar.woff2" as="font" type="font/woff2" crossorigin>
      <link rel="preload" href="/fonts/amiri-400-ar.woff2" as="font" type="font/woff2" crossorigin>
    `;
  }
  return `
    <link rel="preload" href="/fonts/inter-la.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/fonts/source-serif-4-la.woff2" as="font" type="font/woff2" crossorigin>
  `;
}

// ── Shell — main HTML wrapper ──────────────────────────────
function shell({ title, metaDesc, body, head = '', canonical = '', lang = 'ar', langSwitchHref = '', alternateHref = '', rssHref = '', jsonLd = '', bodyClass = '' }) {
  const L = LOCALES[lang];
  const htmlLang = L.html.lang;
  const dir = L.html.dir;
  const displayTitle = title.includes('—') ? title : `${title}${L.category?.titleSuffix || ' — ' + L.site.name}`;
  const canon = canonical || (lang === 'en' ? SITE_URL + '/en/' : SITE_URL + '/');
  const rss = rssHref || (lang === 'en' ? '/en/rss.xml' : '/feed.xml');
  const ogImage = SITE_URL + '/og-default.svg';

  return `<!DOCTYPE html>
<html lang="${htmlLang}" dir="${dir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escAttr(displayTitle)}</title>
  <meta name="description" content="${escAttr(metaDesc || L.site.description)}">
  <link rel="canonical" href="${canon}">
  <link rel="alternate" hreflang="${lang === 'ar' ? 'ar' : 'en'}" href="${canon}">
  ${alternateHref ? `<link rel="alternate" hreflang="${lang === 'ar' ? 'en' : 'ar'}" href="${alternateHref}">` : ''}
  <link rel="alternate" type="application/rss+xml" title="${escAttr(L.site.name)} RSS" href="${rss}">
  ${fontPreloads(lang)}
  <link rel="preload" href="/css/style.css" as="style">
  <link rel="stylesheet" href="/css/style.css">
  <meta property="og:title" content="${escAttr(title)}">
  <meta property="og:description" content="${escAttr(metaDesc || L.site.description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canon}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:locale" content="${L.html.locale}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#FAF9F6">
  <script>
    (function(){
      try {
        var saved = localStorage.getItem('kalaam-theme');
        if (saved === 'dark') document.documentElement.setAttribute('data-theme','dark');
        else if (saved === 'light') document.documentElement.setAttribute('data-theme','light');
        else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
          document.documentElement.setAttribute('data-theme','dark');
        }
      } catch(e){}
    })();
  </script>
  ${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : ''}
  ${head}
</head>
<body class="${bodyClass}">
  <a class="skip-link" href="#main">${L.nav.skipToContent}</a>
  <div class="reading-progress" id="reading-progress" aria-hidden="true"></div>
  ${buildHeader(lang, langSwitchHref)}
  <main id="main">
  ${body}
  </main>
  ${buildFooter(lang)}
  <script>window.SITE_LANG=${JSON.stringify(lang)};window.SITE_I18N=${JSON.stringify(LOCALES)};window.SITE_BASE=${JSON.stringify(SITE_URL)};</script>
  <script src="/js/app.js" defer></script>
</body>
</html>`;
}

// ── Header ─────────────────────────────────────────────────
function buildHeader(lang, langSwitchHref) {
  const L = LOCALES[lang];
  const homeHref = lang === 'en' ? '/en/' : '/';
  const articlesHref = homeHref;
  const aboutHref = lang === 'en' ? '/en/about.html' : '/about.html';

  return `<header class="site-header">
    <div class="container site-header__inner">
      <a class="site-header__brand" href="${homeHref}" aria-label="${escAttr(L.nav.brandAria)}">
        ${escapeHtml(L.site.name)}
        <small>${escapeHtml(L.site.tagline)}</small>
      </a>
      <nav class="site-nav" aria-label="${escAttr(L.nav.allArticles)}">
        <a class="site-nav__link site-nav__link--essential" href="${articlesHref}">${escapeHtml(L.nav.allArticles)}</a>
        <a class="site-nav__link" href="${aboutHref}">${escapeHtml(L.about.title.replace(/^[عن«»\s]+/, '').split('—')[0].trim() || 'About')}</a>
        <span class="site-nav__divider" aria-hidden="true"></span>
        <button class="icon-btn" id="search-btn" aria-label="${escAttr(L.nav.search)}" type="button">${ICONS.search}</button>
        <a class="lang-pill" href="${langSwitchHref}" hreflang="${lang === 'ar' ? 'en' : 'ar'}" aria-label="${escAttr(L.nav.langSwitchAria)}">${escapeHtml(L.nav.langSwitchTo)}</a>
        <button class="icon-btn" id="theme-btn" aria-label="${escAttr(L.nav.themeToggle)}" type="button">${ICONS.moon}${ICONS.sun}</button>
      </nav>
    </div>
    ${buildSearchDialog(lang)}
  </header>`;
}

// ── Search dialog ──────────────────────────────────────────
function buildSearchDialog(lang) {
  const L = LOCALES[lang].search;
  return `<div class="search-dialog" id="search-dialog" role="dialog" aria-modal="true" aria-label="${escAttr(L.close)}" hidden>
    <div class="search-dialog__panel">
      <div class="search-dialog__input-wrap">
        ${ICONS.search}
        <input type="search" class="search-dialog__input" id="search-input" placeholder="${escAttr(L.placeholder)}" autocomplete="off" spellcheck="false">
        <button class="icon-btn" id="search-close" type="button" aria-label="${escAttr(L.close)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="search-dialog__results" id="search-results"></div>
      <div class="search-dialog__hint">${escapeHtml(L.hint)}</div>
    </div>
  </div>`;
}

// ── Footer ─────────────────────────────────────────────────
function buildFooter(lang) {
  const L = LOCALES[lang];
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
    <div class="container site-footer__inner">
      <div class="site-footer__brand">${escapeHtml(L.site.name)}</div>
      <div class="site-footer__meta">
        ${escapeHtml(L.footer.rights.replace('{year}', year))} <a href="https://ziadamrme.vercel.app" target="_blank" rel="noopener">${escapeHtml(L.footer.authorName)}</a>${escapeHtml(L.footer.dot)}
      </div>
    </div>
  </footer>`;
}

// ── Article card ───────────────────────────────────────────
function card(a, lang) {
  const L = LOCALES[lang];
  const href = lang === 'en' ? `/en/articles/${a.slug}` : `/articles/${a.slug}`;
  const title = lang === 'en' ? (a.titleEn || a.title) : a.title;
  const excerpt = lang === 'en' ? (a.excerptEn || a.excerpt) : a.excerpt;
  const category = localizeTag(lang, a.tag);
  const rt = lang === 'en' ? a.readingTimeEn : a.readingTime;
  const minutesText = L.card.minutesShort.replace('{n}', fmtNum(lang, rt));

  return `<article class="card">
    <span class="card__category">${escapeHtml(category)}</span>
    <h3 class="card__title"><a href="${href}">${escapeHtml(title)}</a></h3>
    <p class="card__excerpt">${escapeHtml(excerpt)}</p>
    <div class="card__meta">
      <span>${ICONS.clock}<span>${minutesText}</span></span>
      <span class="card-stats" data-slug="${escAttr(a.slug)}">
        <span class="stat-likes">${ICONS.heart}<span class="stat-likes-num">·</span></span>
        <span class="stat-comments">${ICONS.comment}<span class="stat-comments-num">·</span></span>
      </span>
    </div>
  </article>`;
}

// ── Homepage ───────────────────────────────────────────────
function buildIndex(articles, lang) {
  const L = LOCALES[lang];
  // Filter articles per language — English only shows translated articles
  const visibleArticles = lang === 'en' ? articles.filter(a => a.translated) : articles;

  const hero = `<section class="hero">
    <div class="container">
      <p class="hero__eyebrow">${escapeHtml(L.site.tagline)}</p>
      <h1 class="hero__title">${escapeHtml(L.home.heroTitle)}</h1>
      <p class="hero__lede">${escapeHtml(L.home.heroTag)}</p>
    </div>
  </section>`;

  const articlesList = visibleArticles.map(a => card(a, lang)).join('\n');

  const body = `${hero}
  <section class="articles-section">
    <div class="container">
      <div class="articles-section__head">
        <h2 class="articles-section__title">${escapeHtml(L.home.articles)}</h2>
        <span class="articles-section__count">${escapeHtml(L.home.articlesCount.replace('{n}', fmtNum(lang, visibleArticles.length)))}</span>
      </div>
      <div class="articles-grid">
        ${articlesList}
      </div>
    </div>
  </section>`;

  return shell({
    title: L.home.title,
    metaDesc: L.home.metaDesc,
    body,
    lang,
    canonical: lang === 'en' ? SITE_URL + '/en/' : SITE_URL + '/',
    langSwitchHref: lang === 'ar' ? '/en/' : '/',
    alternateHref: lang === 'ar' ? SITE_URL + '/en/' : SITE_URL + '/',
    jsonLd: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: L.site.name,
      description: L.site.description,
      url: lang === 'en' ? SITE_URL + '/en/' : SITE_URL + '/',
      inLanguage: LOCALES[lang].html.locale,
    }),
  });
}

// ── Article page ───────────────────────────────────────────
function buildArticle(a, allArticles, lang) {
  const L = LOCALES[lang];
  const isEn = lang === 'en';
  const title = isEn ? (a.titleEn || a.title) : a.title;
  const excerpt = isEn ? (a.excerptEn || a.excerpt) : a.excerpt;
  const bodyHtml = isEn ? (a.englishHtml || a.mainHtml) : a.mainHtml;
  const rt = isEn ? a.readingTimeEn : a.readingTime;
  const category = localizeTag(lang, a.tag);
  const articleHref = isEn ? `/en/articles/${a.slug}` : `/articles/${a.slug}`;
  const canonical = SITE_URL + articleHref;
  const langSwitch = langSwitchHrefFor(a, lang);

  // TOC (only if there are at least 2 h2 headings)
  const tocItems = buildToc(bodyHtml);
  const hasToc = tocItems && tocItems.length >= 2;
  const tocHtml = hasToc ? `<aside class="toc" aria-label="${escAttr(L.article.contents)}">
    <p class="toc__title">${escapeHtml(L.article.contents)}</p>
    <nav><ul class="toc__list">
      ${tocItems.map(it => `<li><a href="#${it.id}">${escapeHtml(it.text)}</a></li>`).join('')}
    </ul></nav>
  </aside>` : '';

  // Reading toolbar — tashkeel button is Arabic-only
  const tashkeelBtn = !isEn && a.voweledHtml
    ? `<button class="toolbar__btn" id="tashkeel-btn" type="button" aria-pressed="false">${ICONS.globe || ''}<span>${escapeHtml(L.article.tashkeel)}</span></button>`
    : '';
  const toolbar = `<div class="article__toolbar">
    <div class="toolbar__group">
      <span class="toolbar__label">${escapeHtml(L.article.fontSize)}</span>
      <button class="toolbar__btn toolbar__btn--font" id="font-dec" type="button" aria-label="${escAttr(L.article.fontDec)}">A−</button>
      <button class="toolbar__btn toolbar__btn--font" id="font-inc" type="button" aria-label="${escAttr(L.article.fontInc)}">A+</button>
    </div>
    <div class="toolbar__group">
      ${tashkeelBtn}
    </div>
  </div>`;

  // Article header
  const header = `<div class="article__header">
    <span class="article__category">${escapeHtml(category)}</span>
    <h1 class="article__title">${escapeHtml(title)}</h1>
    <div class="article__meta">
      <span>${escapeHtml(L.article.writtenBy)} <a href="https://ziadamrme.vercel.app" target="_blank" rel="noopener">${escapeHtml(L.article.authorName)}</a></span>
      <span>${ICONS.clock}<span>${escapeHtml(L.article.readingTime.replace('{n}', fmtNum(lang, rt)))}</span></span>
      <span>${escapeHtml(localizeDate(lang, a.createdTime))}</span>
    </div>
  </div>`;

  // Article body — includes voweled hidden div if available
  const voweledHidden = !isEn && a.voweledHtml ? `<div class="article__body article__body--voweled is-hidden" id="voweled-body" hidden>${a.voweledHtml}</div>` : '';

  const mainBody = `<div class="article__body" id="main-body">${bodyHtml}</div>${voweledHidden}`;

  // Exercises — Arabic only
  const exercisesHtml = !isEn && a.exercisesHtml ? a.exercisesHtml : '';

  // Author card
  const authorCard = `<div class="author-card">
    <div class="author-card__avatar">${escapeHtml((L.article.authorName || 'Z').charAt(0))}</div>
    <div class="author-card__body">
      <p class="author-card__label">${escapeHtml(L.article.writtenBy)}</p>
      <p class="author-card__name"><a href="https://ziadamrme.vercel.app" target="_blank" rel="noopener">${escapeHtml(L.article.authorName)}</a></p>
      <p class="author-card__bio">${escapeHtml(L.site.description)}</p>
    </div>
  </div>`;

  // Engagement (likes + comments)
  const engagement = `<section class="engagement" id="engagement">
    <div class="engagement__like-row">
      <button class="like-btn" id="like-btn" type="button" data-slug="${escAttr(a.slug)}" aria-pressed="false">
        ${ICONS.heart}
        <span class="like-label">${escapeHtml(L.engagement.like)}</span>
        <span class="like-btn__count" id="like-count" data-zero="${escAttr(L.engagement.noLikes)}">${escapeHtml(L.engagement.noLikes)}</span>
      </button>
    </div>
    <div class="comments">
      <div class="comments__head">
        <h2 class="comments__title">${escapeHtml(L.engagement.comments)}</h2>
        <span class="comments__count" id="comments-count">٠</span>
      </div>
      <form class="comment-form" id="comment-form" data-slug="${escAttr(a.slug)}">
        <div class="comment-form__field">
          <label class="comment-form__label" for="comment-name">${escapeHtml(L.engagement.commentNamePlaceholder)}</label>
          <input class="comment-form__input" type="text" id="comment-name" name="name" maxlength="50" autocomplete="name" placeholder="${escAttr(L.engagement.commentNamePlaceholder)}">
        </div>
        <div class="comment-form__field">
          <label class="comment-form__label" for="comment-text">${escapeHtml(L.engagement.commentTextPlaceholder)}</label>
          <textarea class="comment-form__textarea" id="comment-text" name="text" required maxlength="1000" placeholder="${escAttr(L.engagement.commentTextPlaceholder)}"></textarea>
          <span class="comment-form__hint">${escapeHtml(L.engagement.commentHint)}</span>
        </div>
        <input type="hidden" name="website" value="" aria-hidden="true" tabindex="-1" autocomplete="off">
        <div class="comment-form__actions">
          <button class="btn-primary" type="submit" id="comment-submit">${escapeHtml(L.engagement.publishComment)}</button>
          <span class="comment-form__status" id="comment-status"></span>
        </div>
      </form>
      <ul class="comment-list" id="comment-list"></ul>
    </div>
  </section>`;

  // Read also (prev/next within the same sorted list)
  const idx = allArticles.findIndex(x => x.slug === a.slug);
  // For EN, use translated list
  const peerList = isEn ? allArticles.filter(x => x.translated) : allArticles;
  const peerIdx = peerList.findIndex(x => x.slug === a.slug);
  const prev = peerIdx > 0 ? peerList[peerIdx - 1] : null;
  const next = peerIdx < peerList.length - 1 ? peerList[peerIdx + 1] : null;
  const prevCard = prev ? `<a class="read-also__card" href="${isEn ? '/en/articles/' : '/articles/'}${prev.slug}">
    <span class="read-also__label">${escapeHtml(L.article.previousArticle)}</span>
    <p class="read-also__article-title">${escapeHtml(isEn ? (prev.titleEn || prev.title) : prev.title)}</p>
  </a>` : `<span class="read-also__card read-also__card--empty"></span>`;
  const nextCard = next ? `<a class="read-also__card" href="${isEn ? '/en/articles/' : '/articles/'}${next.slug}">
    <span class="read-also__label">${escapeHtml(L.article.nextArticle)}</span>
    <p class="read-also__article-title">${escapeHtml(isEn ? (next.titleEn || next.title) : next.title)}</p>
  </a>` : `<span class="read-also__card read-also__card--empty"></span>`;

  const readAlso = `<section class="read-also" aria-label="${escAttr(L.article.prevNextAria)}">
    <p class="read-also__title">${escapeHtml(L.article.readMore)}</p>
    <div class="read-also__grid">
      ${prevCard}
      ${nextCard}
    </div>
  </section>`;

  // Article layout with optional TOC sidebar
  const articleLayout = hasToc
    ? `<div class="article-layout has-toc">
        ${tocHtml}
        <div class="article__main">
          ${header}
          ${toolbar}
          ${mainBody}
          ${exercisesHtml}
          ${authorCard}
          ${engagement}
        </div>
      </div>`
    : `${header}
      ${toolbar}
      ${mainBody}
      ${exercisesHtml}
      ${authorCard}
      ${engagement}`;

  const body = `<article class="article">
    <div class="container">
      ${articleLayout}
    </div>
    ${readAlso}
  </article>`;

  // JSON-LD
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description: excerpt,
    author: { '@type': 'Person', name: L.article.authorName, url: 'https://ziadamrme.vercel.app' },
    datePublished: isoDate(a.createdTime),
    dateModified: isoDate(a.lastEditedTime),
    inLanguage: LOCALES[lang].html.locale,
    mainEntityOfPage: canonical,
    publisher: { '@type': 'Organization', name: L.site.name, url: SITE_URL },
  });

  return shell({
    title: `${title}${L.category?.titleSuffix || ''}`,
    metaDesc: excerpt || L.site.description,
    body,
    lang,
    canonical,
    langSwitchHref: langSwitch,
    alternateHref: SITE_URL + (lang === 'ar' ? `/en/articles/${a.slug}` : `/articles/${a.slug}`),
    jsonLd,
    bodyClass: 'article-page',
  });
}

// ── 404 ────────────────────────────────────────────────────
function build404(lang) {
  const L = LOCALES[lang].notFound;
  const homeHref = lang === 'en' ? '/en/' : '/';
  const body = `<section class="hero">
    <div class="container">
      <p class="hero__eyebrow">${escapeHtml(L.code)}</p>
      <h1 class="hero__title">${escapeHtml(L.title)}</h1>
      <p class="hero__lede">${escapeHtml(L.desc)}</p>
      <p style="margin-top:32px"><a class="btn-primary" href="${homeHref}">${escapeHtml(L.backHome)}</a></p>
    </div>
  </section>`;
  return shell({
    title: L.htmlTitle,
    metaDesc: L.metaDesc,
    body,
    lang,
    canonical: SITE_URL + (lang === 'en' ? '/en/404.html' : '/404.html'),
    langSwitchHref: lang === 'ar' ? '/en/404.html' : '/404.html',
  });
}

// ── Style Guide page ───────────────────────────────────────
function buildStyleGuide(lang) {
  const L = LOCALES[lang];
  const isEn = lang === 'en';

  const swatches = [
    ['Background', '--bg', '#FAF9F6'],
    ['Surface',    '--surface', '#F2EEE5'],
    ['Surface 2',  '--surface-2', '#ECE6D9'],
    ['Text',       '--text', '#26231F'],
    ['Muted',      '--text-muted', '#6E6A60'],
    ['Subtle',     '--text-subtle', '#9A9586'],
    ['Primary',    '--primary', '#166956'],
    ['Primary soft','--primary-soft', '#1E7E68'],
    ['Gold',       '--gold', '#9A6B1F'],
    ['Border',     '--border', 'rgba(38,35,31,0.10)'],
  ];

  const typeScale = [
    ['xs',   '--text-xs',   '13px — meta, captions'],
    ['sm',   '--text-sm',   '14px — small UI'],
    ['base', '--text-base', '16px — UI default'],
    ['md',   '--text-md',   '18px — article body'],
    ['lg',   '--text-lg',   '20px — subheads'],
    ['xl',   '--text-xl',   '24px — section heads'],
    ['2xl',  '--text-2xl',  '30px — featured'],
    ['3xl',  '--text-3xl',  '36px — article title'],
    ['4xl',  '--text-4xl',  '44px — hero'],
  ];

  const spacing = [
    ['1', '--s-1', '4px'],
    ['2', '--s-2', '8px'],
    ['3', '--s-3', '12px'],
    ['4', '--s-4', '16px'],
    ['5', '--s-5', '20px'],
    ['6', '--s-6', '24px'],
    ['8', '--s-8', '32px'],
    ['10', '--s-10', '40px'],
    ['12', '--s-12', '48px'],
    ['16', '--s-16', '64px'],
    ['20', '--s-20', '80px'],
    ['24', '--s-24', '96px'],
  ];

  const sampleCard = `<article class="card">
    <span class="card__category">${escapeHtml(localizeTag(lang, 'وعي رقمي'))}</span>
    <h3 class="card__title">${escapeHtml(isEn ? 'Sample Article Title' : 'عنوان مقال تجريبي')}</h3>
    <p class="card__excerpt">${escapeHtml(isEn ? 'A short excerpt of the article that gives the reader a sense of what it is about.' : 'هذا مقتطف قصير من المقال يعطي القارئ فكرة عن محتواه.')}</p>
    <div class="card__meta">
      <span>${ICONS.clock}<span>${escapeHtml(L.card.minutesShort.replace('{n}', fmtNum(lang, 5)))}</span></span>
      <span>${ICONS.heart}<span>${fmtNum(lang, 12)}</span></span>
      <span>${ICONS.comment}<span>${fmtNum(lang, 3)}</span></span>
    </div>
  </article>`;

  const sampleVerse = isEn
    ? `<blockquote class="verse-en"><p>"And the servants of the Most Merciful are those who walk upon the earth easily."</p><span class="citation">[Quran 25:63]</span></blockquote>`
    : `<blockquote class="verse"><p>﴿وَعِبَادُ الرَّحْمَٰنِ الَّذِينَ يَمْشُونَ عَلَى الْأَرْضِ هَوْنًا﴾</p><span class="citation">سورة الفرقان ٦٣</span></blockquote>`;

  const body = `<section class="guide">
    <div class="container container--article">
      <h1 class="article__title" style="margin-bottom:8px">${escapeHtml(isEn ? 'Style Guide' : 'دليل الأسلوب')}</h1>
      <p class="hero__lede" style="margin-bottom:48px">${escapeHtml(isEn ? 'A live preview of the design tokens, typography, and key components used across the site.' : 'معاينة حيّة لرموز التصميم والخطوط والمكوّنات الأساسية المستخدمة في الموقع.')}</p>

      <div class="guide__section">
        <h2 class="guide__heading">${escapeHtml(isEn ? 'Colors' : 'الألوان')}</h2>
        <p class="guide__sub">${escapeHtml(isEn ? 'Warm paper background, deep green primary, gold reserved for limited accents.' : 'خلفية ورقية دافئة، أخضر عميق كلون رئيسي، وذهبي محجوز لتفاصيل محدودة.')}</p>
        <div class="guide__swatches">
          ${swatches.map(([name, varName, val]) => `<div class="guide__swatch">
            <div class="guide__swatch-color" style="background: var(${varName})"></div>
            <div class="guide__swatch-meta">
              <div class="guide__swatch-name">${escapeHtml(name)}</div>
              <div class="guide__swatch-value">${escapeHtml(val)}</div>
            </div>
          </div>`).join('')}
        </div>
      </div>

      <div class="guide__section">
        <h2 class="guide__heading">${escapeHtml(isEn ? 'Typography' : 'الخطوط')}</h2>
        <p class="guide__sub">${escapeHtml(isEn ? 'Source Serif 4 for article body, Inter for UI. Arabic: Amiri for body + headings, Tajawal for UI.' : 'Source Serif 4 لمتن المقال، Inter للواجهة. عربي: Amiri للمتن والعناوين، Tajawal للواجهة.')}</p>
        <div class="guide__scale">
          ${typeScale.map(([name, varName, desc]) => `<div class="guide__scale-row">
            <span class="guide__scale-label">${escapeHtml(name)} · ${escapeHtml(desc)}</span>
            <span style="font-size: var(${varName}); line-height: 1.4; font-family: ${isEn ? 'var(--font-en-article)' : 'var(--font-ar-article)'}">${escapeHtml(isEn ? 'The quick brown fox' : 'صِفْ خَلْقَ خَوْدٍ')}</span>
          </div>`).join('')}
        </div>
      </div>

      <div class="guide__section">
        <h2 class="guide__heading">${escapeHtml(isEn ? 'Headings & Body' : 'العناوين والمتن')}</h2>
        <div class="article__body" style="padding:0;max-width:none">
          <h2>${escapeHtml(isEn ? 'Section Heading' : 'عنوان قسم رئيسي')}</h2>
          <p>${escapeHtml(isEn ? 'This is a paragraph of article body text. It uses a comfortable reading size with a generous line-height so the eye can move easily from line to line without strain. The width is constrained between 680px and 760px, which is the optimal measure for long-form reading.' : 'هذه فقرة من متن المقال. تستخدم حجم خط مريح للقراءة مع line-height واسع يسمح للعين بالانتقال بسلاسة من سطر لآخر. العرض محصور بين ٦٨٠ و٧٦٠ بكسل، وهو المقياس الأمثل للقراءة الطويلة.')}</p>
          <h3>${escapeHtml(isEn ? 'Subsection' : 'عنوان فرعي')}</h3>
          <p>${escapeHtml(isEn ? 'A second paragraph follows to show spacing between blocks. Links inside the body look like this: a quiet <a href="#">underlined reference</a> without aggressive color.' : 'تأتي فقرة ثانية لتوضيح المسافات بين الكتل. الروابط داخل المتن تبدو هكذا: <a href="#">إشارة تحتها خط</a> هادئة دون ألوان صاخبة.')}</p>
        </div>
      </div>

      <div class="guide__section">
        <h2 class="guide__heading">${escapeHtml(isEn ? 'Buttons' : 'الأزرار')}</h2>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
          <button class="btn-primary" type="button">${escapeHtml(L.engagement.publishComment)}</button>
          <button class="like-btn" type="button">${ICONS.heart}<span>${escapeHtml(L.engagement.like)}</span><span class="like-btn__count">${fmtNum(lang, 24)}</span></button>
          <button class="toolbar__btn is-active" type="button">${escapeHtml(L.article.tashkeel)}</button>
          <a class="lang-pill" href="#">${escapeHtml(L.nav.langSwitchTo)}</a>
        </div>
      </div>

      <div class="guide__section">
        <h2 class="guide__heading">${escapeHtml(isEn ? 'Inputs' : 'حقول الإدخال')}</h2>
        <form class="comment-form" style="max-width:520px" onsubmit="return false">
          <div class="comment-form__field">
            <label class="comment-form__label" for="guide-input">${escapeHtml(L.engagement.commentNamePlaceholder)}</label>
            <input class="comment-form__input" type="text" id="guide-input" placeholder="${escAttr(L.engagement.commentNamePlaceholder)}">
          </div>
          <div class="comment-form__field">
            <label class="comment-form__label" for="guide-textarea">${escapeHtml(L.engagement.commentTextPlaceholder)}</label>
            <textarea class="comment-form__textarea" id="guide-textarea" placeholder="${escAttr(L.engagement.commentTextPlaceholder)}"></textarea>
            <span class="comment-form__hint">${escapeHtml(L.engagement.commentHint)}</span>
          </div>
          <button class="btn-primary" type="submit">${escapeHtml(L.engagement.publishComment)}</button>
        </form>
      </div>

      <div class="guide__section">
        <h2 class="guide__heading">${escapeHtml(isEn ? 'Article Card' : 'كارت المقال')}</h2>
        <div class="articles-grid" style="grid-template-columns: 1fr; max-width: 420px">
          ${sampleCard}
        </div>
      </div>

      <div class="guide__section">
        <h2 class="guide__heading">${escapeHtml(isEn ? 'Verse / Hadith' : 'الآيات والأحاديث')}</h2>
        <div class="article__body" style="padding:0;max-width:none">
          ${sampleVerse}
        </div>
      </div>

      <div class="guide__section">
        <h2 class="guide__heading">${escapeHtml(isEn ? 'Spacing Scale' : 'مقياس المسافات')}</h2>
        <div class="guide__scale">
          ${spacing.map(([name, varName, val]) => `<div class="guide__scale-row">
            <span class="guide__scale-label">--s-${name} (${val})</span>
            <span style="display:inline-block;background:var(--primary-tint);height:12px;width: var(${varName}); border-radius: 2px;"></span>
          </div>`).join('')}
        </div>
      </div>
    </div>
  </section>`;

  return shell({
    title: isEn ? 'Style Guide' : 'دليل الأسلوب',
    metaDesc: isEn ? 'Design system preview' : 'معاينة نظام التصميم',
    body,
    lang,
    canonical: SITE_URL + (lang === 'en' ? '/en/style-guide.html' : '/style-guide.html'),
    langSwitchHref: lang === 'ar' ? '/en/style-guide.html' : '/style-guide.html',
    bodyClass: 'guide-page',
  });
}

// ── Sitemap ────────────────────────────────────────────────
function buildSitemap(articles) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';
  // Home AR + EN
  xml += `  <url><loc>${SITE_URL}/</loc><xhtml:link rel="alternate" hreflang="ar" href="${SITE_URL}/"/><xhtml:link rel="alternate" hreflang="en" href="${SITE_URL}/en/"/><lastmod>${isoDate(new Date())}</lastmod><priority>1.0</priority></url>\n`;
  xml += `  <url><loc>${SITE_URL}/en/</loc><xhtml:link rel="alternate" hreflang="ar" href="${SITE_URL}/"/><xhtml:link rel="alternate" hreflang="en" href="${SITE_URL}/en/"/><lastmod>${isoDate(new Date())}</lastmod><priority>1.0</priority></url>\n`;
  // Articles
  for (const a of articles) {
    xml += `  <url><loc>${SITE_URL}/articles/${a.slug}</loc>`;
    if (a.translated) xml += `<xhtml:link rel="alternate" hreflang="en" href="${SITE_URL}/en/articles/${a.slug}"/>`;
    xml += `<lastmod>${isoDate(a.lastEditedTime)}</lastmod><priority>0.8</priority></url>\n`;
    if (a.translated) {
      xml += `  <url><loc>${SITE_URL}/en/articles/${a.slug}</loc>`;
      xml += `<xhtml:link rel="alternate" hreflang="ar" href="${SITE_URL}/articles/${a.slug}"/>`;
      xml += `<lastmod>${isoDate(a.lastEditedTime)}</lastmod><priority>0.8</priority></url>\n`;
    }
  }
  xml += '</urlset>\n';
  return xml;
}

// ── Robots ─────────────────────────────────────────────────
function buildRobots() {
  return `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

// ── RSS ────────────────────────────────────────────────────
function buildRss(articles, lang) {
  const L = LOCALES[lang];
  const isEn = lang === 'en';
  const items = isEn ? articles.filter(a => a.translated) : articles;
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n';
  xml += `  <title>${escXml(L.site.name)}</title>\n`;
  xml += `  <link>${SITE_URL}${isEn ? '/en/' : '/'}</link>\n`;
  xml += `  <description>${escXml(L.site.description)}</description>\n`;
  xml += `  <language>${L.html.locale}</language>\n`;
  xml += `  <atom:link href="${SITE_URL}${isEn ? '/en/rss.xml' : '/feed.xml'}" rel="self" type="application/rss+xml"/>\n`;
  for (const a of items) {
    const title = isEn ? (a.titleEn || a.title) : a.title;
    const excerpt = isEn ? (a.excerptEn || a.excerpt) : a.excerpt;
    const url = `${SITE_URL}${isEn ? '/en/articles/' : '/articles/'}${a.slug}`;
    xml += `  <item>\n    <title>${escXml(title)}</title>\n    <link>${url}</link>\n    <guid>${url}</guid>\n    <description>${escXml(excerpt)}</description>\n    <pubDate>${new Date(a.createdTime).toUTCString()}</pubDate>\n  </item>\n`;
  }
  xml += '</channel>\n</rss>\n';
  return xml;
}

// ── Search index ───────────────────────────────────────────
function buildSearchIndex(articles, lang) {
  const isEn = lang === 'en';
  const items = isEn ? articles.filter(a => a.translated) : articles;
  return JSON.stringify(items.map(a => ({
    slug: a.slug,
    title: isEn ? (a.titleEn || a.title) : a.title,
    excerpt: isEn ? (a.excerptEn || a.excerpt) : a.excerpt,
    tag: localizeTag(lang, a.tag),
  })));
}

// ── OG image (simple SVG, dark text on light bg) ──────────
function buildOgSvg({ title, subtitle = 'كلام له لازمه' }) {
  const safeTitle = escXml(title).slice(0, 80);
  const safeSub = escXml(subtitle);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#FAF9F6"/>
  <rect x="0" y="0" width="1200" height="6" fill="#166956"/>
  <text x="80" y="120" font-family="Tajawal, sans-serif" font-size="32" fill="#9A6B1F" font-weight="500">${safeSub}</text>
  <text x="80" y="350" font-family="Amiri, serif" font-size="68" fill="#26231F" font-weight="700">
    <tspan x="80" dy="0">${safeTitle.slice(0, 40)}</tspan>
    <tspan x="80" dy="80">${safeTitle.slice(40, 80)}</tspan>
  </text>
  <text x="80" y="570" font-family="Tajawal, sans-serif" font-size="24" fill="#6E6A60">kalaam-site.vercel.app</text>
</svg>`;
}

// ── App.js (client-side JS) ───────────────────────────────
function buildAppJs() {
  return `
(function(){
  "use strict";
  var LANG = window.SITE_LANG || "ar";
  var I18N_RAW = window.SITE_I18N || {};
  var I18N = I18N_RAW[LANG] || I18N_RAW.ar || {};
  var L = I18N.engagement || {};
  var LA = I18N.article || {};
  var LS = I18N.search || {};
  var ENGAGEMENT_API_BASE = '/api';

  // Fallbacks for missing keys
  L.like = L.like || "أعجبني";
  L.liked = L.liked || "أعجبك";
  L.thanksForLike = L.thanksForLike || "شكرًا لإعجابك";
  L.alreadyLiked = L.alreadyLiked || "تم تسجيل إعجابك قبل كده";
  L.rateLimited = L.rateLimited || "وصلت للحد الأقصى";
  L.likeError = L.likeError || "فيه مشكلة، حاول تاني";
  L.noLikes = L.noLikes || "لا إعجابات بعد";
  L.publishing = L.publishing || "جاري النشر…";
  L.publishComment = L.publishComment || "نشر التعليق";
  L.commentError = L.commentError || "فيه مشكلة، حاول تاني";
  L.noComments = L.noComments || "لسه مفيش تعليقات — كن أول واحد يكتب";
  L.guest = L.guest || "زائر";
  L.now = L.now || "الآن";
  L.minutesAgo = L.minutesAgo || "منذ {n} دقيقة";
  L.hoursAgo = L.hoursAgo || "منذ {n} ساعة";
  L.daysAgo = L.daysAgo || "منذ {n} يوم";
  L.likesCount = L.likesCount || "إعجاب";
  LS.searchLoading = LS.loading || "جاري تحميل الفهرس…";
  LS.searchNoResults = LS.noResults || "مفيش نتائج";
  LS.searchHint = LS.hint || "";
  LA.answerCorrect = LA.answerCorrect || "✓ إجابة صحيحة! أحسنت.";
  LA.answerWrong = LA.answerWrong || "✗ مش صحيحة — شوف الإجابة الصحيحة باللون الأخضر.";
  LA.tashkeel = LA.tashkeel || "التشكيل";

  // ---------- Theme toggle ----------
  var themeBtn = document.getElementById("theme-btn");
  if (themeBtn) {
    themeBtn.addEventListener("click", function(){
      var current = document.documentElement.getAttribute("data-theme");
      var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      var isDark = current === "dark" || (current === null && prefersDark);
      var next = isDark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("kalaam-theme", next); } catch(e){}
    });
  }

  // ---------- Search ----------
  var searchIndex = null;
  var searchDialog = document.getElementById("search-dialog");
  var searchInput = document.getElementById("search-input");
  var searchResults = document.getElementById("search-results");
  var searchBtn = document.getElementById("search-btn");
  var searchClose = document.getElementById("search-close");

  function openSearch(){
    if (!searchDialog) return;
    searchDialog.hidden = false;
    searchDialog.classList.add("is-open");
    setTimeout(function(){ if (searchInput) searchInput.focus(); }, 50);
    if (!searchIndex) loadIndex();
  }
  function closeSearch(){
    if (!searchDialog) return;
    searchDialog.classList.remove("is-open");
    searchDialog.hidden = true;
    if (searchInput) searchInput.value = "";
    if (searchResults) searchResults.innerHTML = "";
  }
  function loadIndex(){
    var lang = window.SITE_LANG || "ar";
    var idxUrl = lang === "en" ? "/en/search-index.json" : "/search-index.json";
    fetch(idxUrl).then(function(r){ return r.json(); }).then(function(d){ searchIndex = d; }).catch(function(){ searchIndex = []; });
  }
  function normalize(s){ return (s||"").toLowerCase().replace(/[\\u064B-\\u0652]/g, ""); }
  function escapeHtml(s){ return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function renderResults(q){
    if (!searchResults) return;
    if (!q) { searchResults.innerHTML = '<div class="search-dialog__empty">' + (LS.searchHint || '') + '</div>'; return; }
    var lang = window.SITE_LANG || "ar";
    if (!searchIndex) { searchResults.innerHTML = '<div class="search-dialog__empty">' + LS.searchLoading + '</div>'; return; }
    var nQ = normalize(q);
    var matches = searchIndex.filter(function(a){
      return normalize(a.title).indexOf(nQ) >= 0 || normalize(a.excerpt).indexOf(nQ) >= 0 || normalize(a.tag).indexOf(nQ) >= 0;
    }).slice(0, 8);
    if (matches.length === 0) {
      searchResults.innerHTML = '<div class="search-dialog__empty">' + LS.searchNoResults + '</div>';
      return;
    }
    searchResults.innerHTML = matches.map(function(a){
      var href = lang === 'en' ? '/en/articles/' + a.slug : '/articles/' + a.slug;
      return '<a class="search-dialog__result" href="' + href + '">' +
        '<div class="search-dialog__result-title">' + escapeHtml(a.title) + '</div>' +
        '<div class="search-dialog__result-excerpt">' + escapeHtml(a.excerpt) + '</div>' +
      '</a>';
    }).join('');
  }
  if (searchBtn) searchBtn.addEventListener("click", openSearch);
  if (searchClose) searchClose.addEventListener("click", closeSearch);
  if (searchInput) searchInput.addEventListener("input", function(){ renderResults(searchInput.value); });
  document.addEventListener("keydown", function(e){
    if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
      e.preventDefault(); openSearch();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault(); openSearch();
    } else if (e.key === "Escape" && searchDialog && searchDialog.classList.contains("is-open")) {
      closeSearch();
    }
  });
  if (searchDialog) searchDialog.addEventListener("click", function(e){
    if (e.target === searchDialog) closeSearch();
  });

  // ---------- Fingerprint (simple, deterministic) ----------
  function generateFingerprint(){
    try {
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillText('kalaam-fp-' + new Date().getTimezoneOffset(), 2, 2);
      var dataUrl = canvas.toDataURL();
      var fp = [navigator.userAgent, navigator.language, screen.width + 'x' + screen.height + 'x' + screen.colorDepth, new Date().getTimezoneOffset(), dataUrl.slice(-64)].join('|');
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
      if (!fp || fp.length < 16) { fp = generateFingerprint(); localStorage.setItem(FINGERPRINT_KEY, fp); }
      return fp;
    } catch(e) { return generateFingerprint(); }
  }

  // ---------- Like button ----------
  var likeBtn = document.getElementById('like-btn');
  var likeCount = document.getElementById('like-count');
  if (likeBtn) {
    var slug = likeBtn.getAttribute('data-slug');
    var fp = getFingerprint();
    var likedSlugs = [];
    try { likedSlugs = JSON.parse(localStorage.getItem('kalaam-liked') || '[]'); } catch(e){}
    var isLiked = likedSlugs.indexOf(slug) !== -1;
    if (isLiked) {
      likeBtn.classList.add('is-liked');
      likeBtn.setAttribute('aria-pressed', 'true');
      var lbl = likeBtn.querySelector('.like-label');
      if (lbl) lbl.textContent = L.liked;
    }
    function toArabicNum(n){
      n = String(n);
      var map = {'0':'٠','1':'١','2':'٢','3':'٣','4':'٤','5':'٥','6':'٦','7':'٧','8':'٨','9':'٩'};
      return n.replace(/[0-9]/g, function(d){ return map[d]; });
    }
    function fmtNum(n){
      if (LANG === 'ar') return toArabicNum(n);
      return String(n);
    }
    function updateLikeCount(count){
      if (!likeCount) return;
      if (count === 0) {
        likeCount.textContent = likeCount.getAttribute('data-zero') || L.noLikes;
      } else {
        likeCount.textContent = fmtNum(count);
      }
    }
    fetch(ENGAGEMENT_API_BASE + '/likes?slug=' + encodeURIComponent(slug))
      .then(function(r){ return r.json(); })
      .then(function(d){ if (d && typeof d.count === 'number') updateLikeCount(d.count); })
      .catch(function(){});
    likeBtn.addEventListener('click', function(){
      var wasLiked = likeBtn.classList.contains('is-liked');
      var method = wasLiked ? 'DELETE' : 'POST';
      fetch(ENGAGEMENT_API_BASE + '/like', {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slug, fingerprint: fp })
      })
        .then(function(r){ return r.json(); })
        .then(function(d){
          if (d.error) return;
          if (typeof d.count === 'number') updateLikeCount(d.count);
          if (d.ok && d.liked) {
            likeBtn.classList.add('is-liked');
            likeBtn.setAttribute('aria-pressed', 'true');
            var lbl2 = likeBtn.querySelector('.like-label');
            if (lbl2) lbl2.textContent = L.liked;
            if (likedSlugs.indexOf(slug) === -1) { likedSlugs.push(slug); try { localStorage.setItem('kalaam-liked', JSON.stringify(likedSlugs)); } catch(e){} }
          } else if (d.ok && d.liked === false) {
            likeBtn.classList.remove('is-liked');
            likeBtn.setAttribute('aria-pressed', 'false');
            var lbl3 = likeBtn.querySelector('.like-label');
            if (lbl3) lbl3.textContent = L.like;
            var i = likedSlugs.indexOf(slug);
            if (i !== -1) { likedSlugs.splice(i, 1); try { localStorage.setItem('kalaam-liked', JSON.stringify(likedSlugs)); } catch(e){} }
          }
        })
        .catch(function(){});
    });
  }

  // ---------- Comments ----------
  var commentForm = document.getElementById('comment-form');
  var commentList = document.getElementById('comment-list');
  var commentsCount = document.getElementById('comments-count');
  var commentSlug = commentForm ? commentForm.getAttribute('data-slug') : null;
  if (commentForm && commentSlug) {
    function toArabicNum(n){
      n = String(n);
      var map = {'0':'٠','1':'١','2':'٢','3':'٣','4':'٤','5':'٥','6':'٦','7':'٧','8':'٨','9':'٩'};
      return n.replace(/[0-9]/g, function(d){ return map[d]; });
    }
    function fmtNum(n){ if (LANG === 'ar') return toArabicNum(n); return String(n); }
    function fmtTimeAgo(ts){
      var diff = Date.now() - ts;
      var sec = Math.floor(diff / 1000);
      var min = Math.floor(sec / 60);
      var hr = Math.floor(min / 60);
      var day = Math.floor(hr / 24);
      if (sec < 60) return L.now;
      if (min < 60) return L.minutesAgo.replace('{n}', fmtNum(min));
      if (hr < 24) return L.hoursAgo.replace('{n}', fmtNum(hr));
      if (day < 30) return L.daysAgo.replace('{n}', fmtNum(day));
      return new Date(ts).toLocaleDateString(LANG === 'en' ? 'en-US' : 'ar-EG');
    }
    function escapeHtml(s){
      return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
    }
    function renderComment(c){
      var initial = (c.name || (LANG === 'en' ? 'G' : 'ز')).charAt(0);
      var div = document.createElement('li');
      div.className = 'comment';
      div.innerHTML =
        '<div class="comment__head">' +
          '<span class="comment__name">' + escapeHtml(c.name || L.guest) + '</span>' +
          '<span class="comment__time">' + escapeHtml(fmtTimeAgo(c.ts)) + '</span>' +
        '</div>' +
        '<p class="comment__text">' + escapeHtml(c.text) + '</p>';
      return div;
    }
    function updateCommentsCount(count){
      if (!commentsCount) return;
      commentsCount.textContent = fmtNum(count);
    }
    fetch(ENGAGEMENT_API_BASE + '/comments?slug=' + encodeURIComponent(commentSlug))
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (!d || !d.items) return;
        updateCommentsCount(d.count || 0);
        commentList.innerHTML = '';
        if (d.items.length === 0) {
          var empty = document.createElement('li');
          empty.className = 'comments__empty';
          empty.textContent = L.noComments;
          commentList.appendChild(empty);
        } else {
          d.items.forEach(function(c){ commentList.appendChild(renderComment(c)); });
        }
      })
      .catch(function(){});
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
      submitBtn.textContent = L.publishing;
      fetch(ENGAGEMENT_API_BASE + '/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: commentSlug, name: name, text: text, fingerprint: getFingerprint(), website: hp })
      })
        .then(function(r){ return r.json(); })
        .then(function(d){
          submitBtn.disabled = false;
          submitBtn.textContent = L.publishComment;
          if (d.error) { alert(d.error); return; }
          if (d.ok && d.fake) { commentForm.reset(); return; }
          if (d.ok && d.comment) {
            var empty = commentList.querySelector('.comments__empty');
            if (empty) empty.remove();
            commentList.insertBefore(renderComment(d.comment), commentList.firstChild);
            updateCommentsCount(d.count);
            commentForm.reset();
          }
        })
        .catch(function(){
          submitBtn.disabled = false;
          submitBtn.textContent = L.publishComment;
          alert(L.commentError);
        });
    });
  }

  // ---------- Card stats on homepage ----------
  var statEls = document.querySelectorAll('.card-stats[data-slug]');
  if (statEls.length > 0) {
    var slugs = [];
    statEls.forEach(function(el){ var s = el.getAttribute('data-slug'); if (slugs.indexOf(s) === -1) slugs.push(s); });
    function toArabicNum(n){
      n = String(n);
      var map = {'0':'٠','1':'١','2':'٢','3':'٣','4':'٤','5':'٥','6':'٦','7':'٧','8':'٨','9':'٩'};
      return n.replace(/[0-9]/g, function(d){ return map[d]; });
    }
    function fmtNum(n){ if (LANG === 'ar') return toArabicNum(n); return String(n); }
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
        if (lNum) lNum.textContent = l > 0 ? fmtNum(l) : '·';
        if (cNum) cNum.textContent = c > 0 ? fmtNum(c) : '·';
      });
    }).catch(function(){});
  }

  // ---------- Reading toolbar: font size + tashkeel ----------
  var mainBody = document.getElementById('main-body');
  var voweledBody = document.getElementById('voweled-body');
  var tashkeelBtn = document.getElementById('tashkeel-btn');
  var fontInc = document.getElementById('font-inc');
  var fontDec = document.getElementById('font-dec');
  var FONT_KEY = 'kalaam-font';
  var currentFontScale = 0;
  try { currentFontScale = parseInt(localStorage.getItem(FONT_KEY) || '0') || 0; } catch(e){}
  function applyFont(){
    if (!mainBody) return;
    var base = 18; // var(--text-md)
    var size = base + currentFontScale * 2;
    mainBody.style.fontSize = size + 'px';
    if (voweledBody) voweledBody.style.fontSize = size + 'px';
  }
  applyFont();
  if (fontInc) fontInc.addEventListener('click', function(){
    currentFontScale = Math.min(4, currentFontScale + 1);
    try { localStorage.setItem(FONT_KEY, String(currentFontScale)); } catch(e){}
    applyFont();
  });
  if (fontDec) fontDec.addEventListener('click', function(){
    currentFontScale = Math.max(-2, currentFontScale - 1);
    try { localStorage.setItem(FONT_KEY, String(currentFontScale)); } catch(e){}
    applyFont();
  });
  if (tashkeelBtn && voweledBody && mainBody) {
    tashkeelBtn.addEventListener('click', function(){
      var pressed = tashkeelBtn.getAttribute('aria-pressed') === 'true';
      if (pressed) {
        mainBody.hidden = false;
        voweledBody.hidden = true;
        voweledBody.classList.add('is-hidden');
        tashkeelBtn.setAttribute('aria-pressed', 'false');
        tashkeelBtn.classList.remove('is-active');
      } else {
        mainBody.hidden = true;
        voweledBody.hidden = false;
        voweledBody.classList.remove('is-hidden');
        tashkeelBtn.setAttribute('aria-pressed', 'true');
        tashkeelBtn.classList.add('is-active');
      }
    });
  }

  // ---------- Exercises (Arabic only) ----------
  var exChoices = document.querySelectorAll('.exercise__choice');
  exChoices.forEach(function(btn){
    btn.addEventListener('click', function(){
      var ex = btn.closest('.exercise');
      if (!ex) return;
      var feedback = ex.querySelector('.exercise__feedback');
      var isCorrect = btn.getAttribute('data-correct') === '1';
      // Reset siblings
      ex.querySelectorAll('.exercise__choice').forEach(function(s){
        s.classList.remove('is-correct', 'is-wrong');
        s.setAttribute('aria-checked', 'false');
      });
      btn.setAttribute('aria-checked', 'true');
      if (isCorrect) {
        btn.classList.add('is-correct');
        if (feedback) { feedback.textContent = LA.answerCorrect; feedback.className = 'exercise__feedback is-correct'; }
      } else {
        btn.classList.add('is-wrong');
        // Highlight the correct one
        var correct = ex.querySelector('.exercise__choice[data-correct="1"]');
        if (correct) correct.classList.add('is-correct');
        if (feedback) { feedback.textContent = LA.answerWrong; feedback.className = 'exercise__feedback is-wrong'; }
      }
    });
  });
  var exReveals = document.querySelectorAll('.exercise__reveal');
  exReveals.forEach(function(btn){
    btn.addEventListener('click', function(){
      var ex = btn.closest('.exercise');
      if (!ex) return;
      var answer = ex.querySelector('.exercise__answer');
      if (!answer) return;
      var expanded = btn.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        answer.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      } else {
        answer.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  // ---------- Reading progress bar ----------
  var progress = document.getElementById('reading-progress');
  if (progress) {
    function updateProgress(){
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      var scrolled = window.scrollY;
      var pct = docHeight > 0 ? Math.min(100, Math.max(0, (scrolled / docHeight) * 100)) : 0;
      progress.style.width = pct + '%';
    }
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress);
    updateProgress();
  }
})();
`;
}

// ── Main ───────────────────────────────────────────────────
async function main() {
  console.log('⏳ [redesign-v2] جاري سحب المقالات من Notion...');

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
    const titleEn = (props['العنوان EN']?.rich_text || []).map(r => r.plain_text).join('').trim() || '';
    const excerptEn = (props['المقتطف EN']?.rich_text || []).map(r => r.plain_text).join('').trim() || '';

    console.log(`  📄 ${title}  [en=${titleEn ? '✓' : '-'}]`);
    const data = await getArticleData(page.id);
    const readingTimeVal = readingTime(data.mainHtml);
    const readingTimeEnVal = data.englishHtml ? readingTime(data.englishHtml) : readingTimeVal;
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

  // Group by category (kept for compat — not building category pages in v2)
  const categoriesMap = new Map();
  for (const a of articles) {
    if (!categoriesMap.has(a.categorySlug)) categoriesMap.set(a.categorySlug, { name: a.tag, slug: a.categorySlug, articles: [] });
    categoriesMap.get(a.categorySlug).articles.push(a);
  }
  const categories = [...categoriesMap.values()];

  // Create output dirs
  fs.mkdirSync('site/articles', { recursive: true });
  fs.mkdirSync('site/css', { recursive: true });
  fs.mkdirSync('site/js', { recursive: true });
  fs.mkdirSync('site/fonts', { recursive: true });
  fs.mkdirSync('site/og', { recursive: true });
  fs.mkdirSync('site/en', { recursive: true });
  fs.mkdirSync('site/en/articles', { recursive: true });

  // CSS
  fs.writeFileSync('site/css/style.css', minifyCss(CSS_SOURCE), 'utf8');
  // Also copy the design-tokens.css file (style.css @imports it)
  const TOKENS_SOURCE = fs.readFileSync(path.join(__dirname, 'src', 'design-tokens.css'), 'utf8');
  fs.writeFileSync('site/css/design-tokens.css', minifyCss(TOKENS_SOURCE), 'utf8');
  console.log('✅ css/style.css + css/design-tokens.css (minified)');

  // Fonts
  const fontsSrcDir = path.join(__dirname, 'src', 'fonts');
  if (fs.existsSync(fontsSrcDir)) {
    for (const f of fs.readdirSync(fontsSrcDir)) {
      if (f.endsWith('.woff2')) fs.copyFileSync(path.join(fontsSrcDir, f), path.join('site', 'fonts', f));
    }
    console.log(`✅ fonts/ (${fs.readdirSync('site/fonts').length} files)`);
  }

  // JS
  fs.writeFileSync('site/js/app.js', minifyJs(buildAppJs()), 'utf8');
  console.log('✅ js/app.js (minified)');

  // Search indexes
  fs.writeFileSync('site/search-index.json', buildSearchIndex(articles, 'ar'), 'utf8');
  fs.writeFileSync('site/en/search-index.json', buildSearchIndex(articles, 'en'), 'utf8');
  console.log('✅ search-index.json + en/search-index.json');

  // Sitemap
  fs.writeFileSync('site/sitemap.xml', buildSitemap(articles), 'utf8');
  console.log('✅ sitemap.xml');

  // robots.txt
  fs.writeFileSync('site/robots.txt', buildRobots(), 'utf8');
  console.log('✅ robots.txt');

  // RSS
  fs.writeFileSync('site/feed.xml', buildRss(articles, 'ar'), 'utf8');
  fs.writeFileSync('site/en/rss.xml', buildRss(articles, 'en'), 'utf8');
  console.log('✅ feed.xml + en/rss.xml');

  // OG images
  fs.writeFileSync('site/og-default.svg', buildOgSvg({ title: 'مقالات في الوعي والقيم', subtitle: 'كلام له لازمه' }), 'utf8');
  for (const a of articles) {
    fs.writeFileSync(`site/og/${a.slug}.svg`, buildOgSvg({ title: a.title, subtitle: 'كلام له لازمه' }), 'utf8');
  }
  console.log(`✅ og/ (${articles.length + 1} SVG images)`);

  // 404
  fs.writeFileSync('site/404.html', minifyHtml(build404('ar')), 'utf8');
  fs.writeFileSync('site/en/404.html', minifyHtml(build404('en')), 'utf8');
  console.log('✅ 404.html + en/404.html');

  // Style Guide (preview page)
  fs.writeFileSync('site/style-guide.html', minifyHtml(buildStyleGuide('ar')), 'utf8');
  fs.writeFileSync('site/en/style-guide.html', minifyHtml(buildStyleGuide('en')), 'utf8');
  console.log('✅ style-guide.html + en/style-guide.html');

  // Index pages
  fs.writeFileSync('site/index.html', minifyHtml(buildIndex(articles, 'ar')), 'utf8');
  fs.writeFileSync('site/en/index.html', minifyHtml(buildIndex(articles, 'en')), 'utf8');
  console.log('✅ index.html + en/index.html');

  // Article pages
  let enCount = 0;
  for (const a of articles) {
    fs.writeFileSync(`site/articles/${a.slug}.html`, minifyHtml(buildArticle(a, articles, 'ar')), 'utf8');
    if (a.translated) {
      fs.writeFileSync(`site/en/articles/${a.slug}.html`, minifyHtml(buildArticle(a, articles, 'en')), 'utf8');
      enCount++;
    }
  }
  console.log(`✅ articles/ (${articles.length} Arabic) + en/articles/ (${enCount} English)`);

  const translatedCount = articles.filter(a => a.translated).length;
  console.log(`\n🎉 [redesign-v2] تم البناء! ${articles.length} مقالات (${translatedCount} مترجمة للإنجليزية).`);
}

main().catch(e => { console.error(e); process.exit(1); });
