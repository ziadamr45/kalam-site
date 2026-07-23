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

// ── HTML shell ────────────────────────────────────────────────────────────────
function shell({ title, metaDesc, body, depth = 0, head = '', canonical = '', ogImage = '', jsonLd = '' }) {
  const cssHref = depth === 0 ? 'css/style.css' : '../css/style.css';
  const homeHref = depth === 0 ? '/' : '../';
  const rootPath = depth === 0 ? '' : '../';
  const YEAR = toArabicDigits(new Date().getFullYear());

  // Font preloads — only the two heaviest weights (Tajawal 400 Arabic + Amiri 400 Arabic)
  const fontPreloads = `
  <link rel="preload" href="/fonts/tajawal-400-ar.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/amiri-400-ar.woff2" as="font" type="font/woff2" crossorigin>`;

  const canonicalTag = canonical ? `<link rel="canonical" href="${canonical}">` : '';
  const ogImageTag = ogImage ? `<meta property="og:image" content="${ogImage}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${ogImage}">` : '';
  const jsonLdTag = jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : '';
  // Vercel Analytics (Web Analytics) — only loads in production.
  // Honours DNT, free, no consent banner needed.
  const analyticsScript = process.env.VERCEL_ANALYTICS_ID
    ? `<script defer src="/_vercel/insights/script.js" data-ve-analytics-id="${process.env.VERCEL_ANALYTICS_ID}"></script>`
    : `<script defer src="/_vercel/insights/script.js"></script>`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${escAttr(metaDesc)}">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(metaDesc)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="ar_EG">
<meta name="theme-color" content="#FAF9F6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1B1A17" media="(prefers-color-scheme: dark)">
${ogImageTag}
${canonicalTag}
${fontPreloads}
<link rel="stylesheet" href="${cssHref}">
<link rel="alternate" type="application/rss+xml" title="كلام له لازمه" href="${SITE_URL}/feed.xml">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%23166956'/><text x='50' y='72' font-size='62' text-anchor='middle' fill='white' font-family='serif'>ك</text></svg>">
${jsonLdTag}
${head}
</head>
<body>
<a class="skip-link" href="#main">تخطَّ إلى المحتوى</a>
<div id="progress" aria-hidden="true"></div>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="${homeHref}" aria-label="كلام له لازمه — الرئيسية">
      <span class="brand-mark" aria-hidden="true">ك</span>
      <span>
        <span class="brand-name">كلام له لازمه</span>
        <span class="brand-sub">مقالات في الوعي والقيم</span>
      </span>
    </a>
    <div class="header-utils">
      <button class="icon-btn" id="search-btn" aria-label="بحث" type="button">${ICONS.search}</button>
      <button class="icon-btn" id="theme-btn" aria-label="تبديل الوضع الليلي" type="button">${ICONS.sun}${ICONS.moon}</button>
      <a class="header-link" href="https://ziadamrme.vercel.app" target="_blank" rel="noopener">موقعي الشخصي <span aria-hidden="true">↗</span></a>
    </div>
  </div>
</header>
<main id="main">${body}</main>
<footer class="site-footer">
  <div class="wrap">
    <span class="f-brand">كلام له لازمه<span style="color:var(--gold)">.</span></span>
    <span class="f-note">جميع الحقوق محفوظة © ${YEAR} — بقلم <a href="https://ziadamrme.vercel.app" target="_blank" rel="noopener">زياد عمرو</a></span>
  </div>
</footer>

<!-- Search modal -->
<div class="search-overlay" id="search-overlay" role="dialog" aria-modal="true" aria-label="بحث في الموقع">
  <div class="search-box">
    <div class="search-input-wrap">
      ${ICONS.search}
      <input class="search-input" id="search-input" type="search" placeholder="ابحث في المقالات…" autocomplete="off">
      <button class="search-close" id="search-close" aria-label="إغلاق">×</button>
    </div>
    <div class="search-results" id="search-results"></div>
    <div class="search-hint">اكتب كلمة أو اكتر — النتائج بتظهر وأنت بتكتب</div>
  </div>
</div>

<script>window.SITE_BASE='${rootPath}';</script>
<script src="${rootPath}js/app.js" defer></script>
<script>
(function(){var b=document.getElementById("progress");window.addEventListener("scroll",function(){var h=document.documentElement,m=h.scrollHeight-h.clientHeight;b.style.width=(m>0?(h.scrollTop/m)*100:0)+"%";},{passive:true});})();
</script>
${analyticsScript}
</body>
</html>`;
}

// ── Article card ─────────────────────────────────────────────────────────────
function card(a, depth = 0) {
  const href = depth === 0 ? `articles/${a.slug}` : a.slug;
  const catHref = depth === 0 ? `category/${a.categorySlug}` : `../category/${a.categorySlug}`;
  return `<a class="card" href="${href}">
  <div class="card-top">
    <span class="card-icon" aria-hidden="true">${a.icon}</span>
    <div class="card-tags">${levelBadge(a.level)}<a class="card-tag" href="${catHref}" onclick="event.stopPropagation()">${a.tag}</a></div>
  </div>
  <h3>${a.title}</h3>
  <p>${a.excerpt}</p>
  <div class="card-meta"><span class="time">${toArabicDigits(a.readingTime)} دقايق قراءة</span><span class="read">اقرأ المقال <span class="arr" aria-hidden="true">←</span></span></div>
</a>`;
}

// ── Index page ────────────────────────────────────────────────────────────────
function buildIndex(articles) {
  const cards = articles.map(a => card(a, 0)).join('\n');
  const body = `
  <div class="hero">
    <span class="hero-quote" aria-hidden="true">”</span>
    <h1>كلام له لازمه<span class="dot">.</span></h1>
    <p class="tag">مش كل كلام يتقال… لكن فيه كلام لازم يتقال. مقالات هادية في الوعي والقيم والأخلاق، مكتوبة بلغة قريبة من القلب.</p>
    <div class="orn-line" aria-hidden="true">✦</div>
    <a class="hero-start" href="start">ابدأ من هنا ←</a>
  </div>
  <div class="wrap">
    <section class="bookmarks-section" id="bookmarks-section" hidden aria-label="محفوظاتك">
      <div class="section-head">
        <h2>محفوظاتك</h2>
        <button class="bm-clear" id="bm-clear" type="button" aria-label="مسح كل المحفوظات">مسح الكل</button>
      </div>
      <div class="grid bookmarks-grid" id="bookmarks-grid"></div>
    </section>
    <div class="section-head">
      <h2>المقالات</h2>
      <span class="count">${toArabicDigits(articles.length)} مقالات</span>
    </div>
    <div class="grid">
${cards}
    </div>
  </div>`;
  return shell({
    title: 'كلام له لازمه — مقالات في الوعي والقيم',
    metaDesc: 'مقالات هادية في الوعي والقيم والأخلاق بقلم زياد عمرو.',
    body,
    depth: 0,
    canonical: `${SITE_URL}/`,
    ogImage: `${SITE_URL}/og-default.svg`,
  });
}

// ── /start page ──────────────────────────────────────────────────────────────
function buildStart(articles) {
  // Pick the most recent article for "ابدأ الآن" if user has no specific entry
  const featured = articles[0];
  const featuredHref = featured ? `articles/${featured.slug}` : '';
  const body = `
  <div class="start-hero">
    <span class="hero-quote" aria-hidden="true">”</span>
    <h1>ابدأ من هنا</h1>
    <p class="tag">لو إنت جديد في «كلام له لازمه»، الصفحة دي بتدلّك على إزاي تستفيد من الموقع وتلاقي اللي يخصّك بسرعة.</p>
    <div class="orn-line" aria-hidden="true">✦</div>
  </div>
  <div class="wrap start-wrap">
    <section class="start-section">
      <span class="start-num" aria-hidden="true">١</span>
      <div>
        <h2>إيه اللي هتلاقيه هنا؟</h2>
        <p>مقالات عربية هادفة في ثلاثة محاور رئيسية: <strong>الوعي الرقمي</strong> (تعاملنا السليم مع السوشيال ميديا والترندات)، و<strong>القيم والمجتمع</strong> (رؤية الإسلام للعلاقات الإنسانية والكرامة)، و<strong>الأخلاق والتزكية</strong> (بناء النفس وترويضها على الفضائل). كل مقال مكتوب بلغة قريبة من القلب، وفيه آيات وأحاديث وشواهد من الواقع.</p>
      </div>
    </section>
    <section class="start-section">
      <span class="start-num" aria-hidden="true">٢</span>
      <div>
        <h2>مميزات بتساعدك تقرأ</h2>
        <p>كل مقال فيه <strong>زرار تشكيل</strong> لو النسخة المشكولة متوفرة — لما تحتاج تقرأ بالنص الأصلي بالحركات. وفي نهاية كل مقال <strong>تدريبات تفاعلية</strong>: أسئلة اختيار من متعدد بتصحيح فوري، وتدريبات إعراب بزرار «اعرض الإجابة النموذجية». كمان فيه <strong>وضع المعلم</strong> للطباعة بدون إجابات، و<strong>أزرار حجم الخط</strong> تظبط القراءة على راحتك، و<strong>حفظ للقراءة لاحقًا</strong> يخزّن المقالات في الـ localStorage.</p>
      </div>
    </section>
    <section class="start-section">
      <span class="start-num" aria-hidden="true">٣</span>
      <div>
        <h2>إزاي تختار اللي يناسبك؟</h2>
        <p>كل مقال عليه <strong>badge للمستوى</strong> (مبتدئ / متوسط / متقدم). لو إنت جديد، ابدأ بمقالات «مبتدئ» وادّي صعودًا. تقدر كمان تدخل على أي <strong>تصنيف</strong> من فوق أو من بطاقة المقال، وتشوف كل مقالاته في صفحة واحدة. والمقالات اللي بتنتسب لـ<strong>سلسلة</strong> مترابطة هتلاقيها بـ«الدرس السابق / التالي» ومسار تقدر تتبعه.</p>
      </div>
    </section>
    <section class="start-section">
      <span class="start-num" aria-hidden="true">٤</span>
      <div>
        <h2>مفتاح الاختصارات</h2>
        <p>في أي صفحة، اضغط <kbd>/</kbd> أو <kbd>Ctrl</kbd>+<kbd>K</kbd> تفتح صندوق البحث. اضغط <kbd>Esc</kbd> تقفله. وفي صفحة المقال، الزرار اللي فوق المحتوى بيديك تحكم كامل في التجربة.</p>
      </div>
    </section>
    <div class="orn" aria-hidden="true">✦</div>
    ${featured ? `<a class="start-cta" href="${featuredHref}">ابدأ بأحدث مقال: «${escapeHtml(featured.title)}» ←</a>` : ''}
    <p style="text-align:center;color:var(--muted);font-size:15px;margin-top:32px">أو <a href="/" style="color:var(--accent);font-weight:800">تصفّح كل المقالات</a> مباشرة.</p>
  </div>`;
  return shell({
    title: 'ابدأ من هنا — كلام له لازمه',
    metaDesc: 'دليل البدء لموقع «كلام له لازمه»: إيه اللي هتلاقيه، مميزات القراءة، وإزاي تختار اللي يناسبك.',
    body,
    depth: 0,
    canonical: `${SITE_URL}/start`,
    ogImage: `${SITE_URL}/og-default.svg`,
  });
}

// ── Level badge helper ───────────────────────────────────────────────────────
const LEVEL_META = {
  'مبتدئ':  { cls: 'lvl-beg',  label: 'مبتدئ',  icon: '🟢' },
  'متوسط':  { cls: 'lvl-mid',  label: 'متوسط',  icon: '🟡' },
  'متقدم':  { cls: 'lvl-adv',  label: 'متقدم',  icon: '🔴' },
};
function levelBadge(level) {
  if (!level) return '';
  const m = LEVEL_META[level];
  if (!m) return '';
  return `<span class="level-badge ${m.cls}" aria-label="المستوى: ${m.label}">${m.label}</span>`;
}

// ── Article page ──────────────────────────────────────────────────────────────
function buildArticle(a, allArticles) {
  // Reading-time should NOT count exercises — only main article body.
  // a.readingTime was computed against a.mainHtml (see main()).
  const idx = allArticles.findIndex(x => x.slug === a.slug);
  const prev = idx > 0 ? allArticles[idx - 1] : null;
  const next = idx < allArticles.length - 1 ? allArticles[idx + 1] : null;
  const others = allArticles.filter(x => x.slug !== a.slug).slice(0, 2);
  const otherCards = others.map(x => card(x, 1)).join('\n');

  // TOC if 4+ h2s (in main body only)
  const h2Matches = [...a.mainHtml.matchAll(/<h2>([^<]+)<\/h2>/g)];
  let tocHtml = '';
  if (h2Matches.length >= 4) {
    const items = h2Matches.map((m, i) => {
      const id = `s${i + 1}`;
      return `<li><a href="#${id}">${m[1]}</a></li>`;
    }).join('');
    tocHtml = `<nav class="toc" aria-label="جدول المحتويات">
      <div class="toc-title">${ICONS.list}<span>المحتويات</span></div>
      <ul class="toc-list">${items}</ul>
    </nav>`;
    let i = 0;
    a.mainHtml = a.mainHtml.replace(/<h2>([^<]+)<\/h2>/g, (match, txt) => {
      i++;
      return `<h2 id="s${i}">${txt}</h2>`;
    });
    if (a.voweledHtml) {
      let j = 0;
      a.voweledHtml = a.voweledHtml.replace(/<h2>([^<]+)<\/h2>/g, (match, txt) => {
        j++;
        return `<h2 id="vs${j}">${txt}</h2>`;
      });
    }
  }

  // Series navigation (if article belongs to a series)
  let seriesNavHtml = '';
  if (a.series && a.seriesOrder) {
    const siblings = allArticles
      .filter(x => x.series === a.series && x.seriesOrder)
      .sort((x, y) => x.seriesOrder - y.seriesOrder);
    const sIdx = siblings.findIndex(x => x.slug === a.slug);
    if (sIdx >= 0) {
      const sPrev = sIdx > 0 ? siblings[sIdx - 1] : null;
      const sNext = sIdx < siblings.length - 1 ? siblings[sIdx + 1] : null;
      const total = siblings.length;
      const sPrevHtml = sPrev ? `<a class="sn-link" href="${sPrev.slug}"><span class="sn-arrow" aria-hidden="true">→</span><span class="sn-meta">الدرس السابق</span><span class="sn-title">${sPrev.title}</span></a>` : '<span class="sn-spacer"></span>';
      const sNextHtml = sNext ? `<a class="sn-link sn-next" href="${sNext.slug}"><span class="sn-meta">الدرس التالي</span><span class="sn-title">${sNext.title}</span><span class="sn-arrow" aria-hidden="true">←</span></a>` : '<span class="sn-spacer"></span>';
      seriesNavHtml = `<nav class="series-nav" aria-label="مسار السلسلة">
        <div class="sn-header">
          <span class="sn-name">📚 السلسلة: ${escapeHtml(a.series)}</span>
          <span class="sn-progress">الدرس ${toArabicDigits(a.seriesOrder)} من ${toArabicDigits(total)}</span>
        </div>
        <div class="sn-progress-bar"><div class="sn-progress-fill" style="width:${(a.seriesOrder / total) * 100}%"></div></div>
        <div class="sn-links">${sPrevHtml}${sNextHtml}</div>
      </nav>`;
    }
  }

  // Reading controls bar (font size, bookmark, tashkeel, teacher, copy text)
  const readingControls = `<div class="reading-controls" role="toolbar" aria-label="أدوات القراءة">
    ${a.voweledHtml ? `<button class="rc-btn" id="tashkeel-btn" type="button" aria-pressed="false" title="التشكيل">${ICONS.tashkeel}<span>التشكيل</span></button>` : ''}
    <div class="rc-font" role="group" aria-label="حجم الخط">
      <button class="rc-btn rc-font-btn" id="font-dec" type="button" aria-label="تصغير الخط" title="تصغير الخط">أ−</button>
      <button class="rc-btn rc-font-btn" id="font-inc" type="button" aria-label="تكبير الخط" title="تكبير الخط">أ+</button>
    </div>
    <button class="rc-btn" id="bookmark-btn" type="button" aria-pressed="false" data-slug="${a.slug}" data-title="${escAttr(a.title)}" data-icon="${escAttr(a.icon)}" data-excerpt="${escAttr(a.excerpt)}" title="حفظ للقراءة لاحقًا">${ICONS.bookmark}<span class="rc-label">حفظ</span></button>
    <button class="rc-btn" id="copy-text-btn" type="button" title="نسخ النص" data-title="${escAttr(a.title)}">${ICONS.copyText}<span class="rc-label">انسخ النص</span></button>
    <button class="rc-btn" id="teacher-btn" type="button" title="نسخة للمعلم">${ICONS.teacher}<span class="rc-label">للمعلم</span></button>
  </div>`;

  // Share buttons
  const shareUrl = `${SITE_URL}/articles/${a.slug}`;
  const shareText = encodeURIComponent(`${a.title} — كلام له لازمه`);
  const shareBlock = `<div class="share-bar" aria-label="شارك المقال">
    <span class="share-label">شارك:</span>
    <a class="share-btn" data-net="whatsapp" href="https://wa.me/?text=${shareText}%20${encodeURIComponent(shareUrl)}" target="_blank" rel="noopener" aria-label="شارك على واتساب">${ICONS.whatsapp}</a>
    <a class="share-btn" data-net="x" href="https://twitter.com/intent/tweet?text=${shareText}&url=${encodeURIComponent(shareUrl)}" target="_blank" rel="noopener" aria-label="شارك على X">${ICONS.x}</a>
    <a class="share-btn" data-net="telegram" href="https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${shareText}" target="_blank" rel="noopener" aria-label="شارك على تيليجرام">${ICONS.telegram}</a>
    <a class="share-btn" data-net="facebook" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}" target="_blank" rel="noopener" aria-label="شارك على فيسبوك">${ICONS.facebook}</a>
    <button class="share-btn" data-net="copy" type="button" aria-label="نسخ الرابط" data-url="${shareUrl}">${ICONS.copy}</button>
  </div>`;

  // Prev / next (general — not series)
  const prevHtml = prev ? `<a href="${prev.slug}"><span class="pn-label">← المقال السابق</span><span class="pn-title">${prev.title}</span></a>` : '<span></span>';
  const nextHtml = next ? `<a class="pn-next" href="${next.slug}"><span class="pn-label">المقال التالي →</span><span class="pn-title">${next.title}</span></a>` : '<span></span>';

  const moreSection = others.length ? `
  <div class="more">
    <h2>اقرأ كمان</h2>
    <div class="grid" style="padding-bottom:0">
${otherCards}
    </div>
  </div>` : '';

  // Hidden plain-text version for "copy text" + teacher print
  const plainTextEsc = escAttr(a.plainText);

  const body = `
  <div class="article-shell">
    <a class="back" href="../"><span aria-hidden="true">→</span> كل المقالات</a>
    ${seriesNavHtml}
    <header class="article-head">
      <div class="article-head-tags">
        <a class="card-tag" href="../category/${a.categorySlug}">${a.tag}</a>
        ${levelBadge(a.level)}
      </div>
      <h1>${a.title}</h1>
      <div class="meta">
        <span>بقلم <span class="who">زياد عمرو</span></span>
        <span class="sep" aria-hidden="true">•</span>
        <span>${toArabicDigits(a.readingTime)} دقايق قراءة</span>
      </div>
    </header>
    ${readingControls}
    ${tocHtml}
    <div class="article-body article-body-main" id="article-main">
${a.mainHtml}
    </div>
    ${a.voweledHtml ? `<div class="article-body article-body-voweled" id="article-voweled" hidden>${a.voweledHtml}</div>` : ''}
    ${a.exercisesHtml}
    ${shareBlock}
    <div class="prev-next">${prevHtml}${nextHtml}</div>
    <aside class="author-card">
      <span class="avatar" aria-hidden="true">ز</span>
      <div class="author-info">
        <div class="lbl">المؤلف</div>
        <div class="name">زياد عمرو</div>
      </div>
      <a class="author-link" href="https://ziadamrme.vercel.app" target="_blank" rel="noopener">ziadamrme.vercel.app <span aria-hidden="true">↗</span></a>
    </aside>
  </div>${moreSection}
  <script type="text/plain" id="plain-text-data" data-title="${escAttr(a.title)}">${plainTextEsc}</script>
  <script type="text/plain" id="voweled-available" data-available="${a.voweledHtml ? '1' : '0'}"></script>`;

  // JSON-LD Article structured data
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.excerpt,
    inLanguage: 'ar',
    author: { '@type': 'Person', name: 'زياد عمرو', url: 'https://ziadamrme.vercel.app' },
    publisher: { '@type': 'Person', name: 'زياد عمرو', url: 'https://ziadamrme.vercel.app' },
    datePublished: isoDate(a.createdTime || Date.now()),
    dateModified: isoDate(a.lastEditedTime || a.createdTime || Date.now()),
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/articles/${a.slug}` },
    url: `${SITE_URL}/articles/${a.slug}`,
    articleSection: a.tag,
    ...(a.level ? { educationalLevel: a.level } : {}),
    ...(a.series ? { isPartOf: { '@type': 'CreativeWorkSeries', name: a.series, position: a.seriesOrder } } : {}),
  });

  return shell({
    title: `${a.title} — كلام له لازمه`,
    metaDesc: a.excerpt || '',
    body,
    depth: 1,
    canonical: `${SITE_URL}/articles/${a.slug}`,
    ogImage: `${SITE_URL}/og/${a.slug}.svg`,
    jsonLd,
  });
}

// ── Category page ─────────────────────────────────────────────────────────────
function buildCategoryPage(catName, catSlug, articles, depth = 1) {
  const cards = articles.map(a => card(a, depth)).join('\n');
  const body = `
  <div class="hero" style="padding:60px 24px 50px">
    <span class="hero-quote" aria-hidden="true">”</span>
    <h1 style="font-size:clamp(36px,6vw,52px)">${catName}</h1>
    <p class="tag">${toArabicDigits(articles.length)} ${articles.length === 1 ? 'مقال' : 'مقالات'} في التصنيف ده</p>
    <div class="orn-line" aria-hidden="true">✦</div>
  </div>
  <div class="wrap">
    <div class="section-head">
      <h2>مقالات «${catName}»</h2>
      <a href="${depth === 0 ? '/' : '../'}" style="color:var(--muted);font-size:14px;font-weight:700">← كل المقالات</a>
    </div>
    <div class="grid">
${cards}
    </div>
  </div>`;
  return shell({
    title: `${catName} — كلام له لازمه`,
    metaDesc: `مقالات في تصنيف «${catName}» على كلام له لازمه.`,
    body,
    depth,
    canonical: `${SITE_URL}/category/${catSlug}`,
    ogImage: `${SITE_URL}/og-default.svg`,
  });
}

// ── 404 page ──────────────────────────────────────────────────────────────────
function build404() {
  const body = `
  <div class="not-found">
    <div class="nf-code">٤٠٤</div>
    <h1>الصفحة دي مش موجودة</h1>
    <p>يمكن الرابط اتغيّر أو الصفحة اتمسحت. خلّينا نرجّعك للرئيسية عشان تقرأ أحدث المقالات.</p>
    <a class="nf-btn" href="/">→ الرجوع للرئيسية</a>
  </div>`;
  return shell({
    title: '٤٠٤ — الصفحة مش موجودة | كلام له لازمه',
    metaDesc: 'الصفحة غير موجودة.',
    body,
    depth: 0,
    canonical: `${SITE_URL}/404`,
  });
}

// ── About page ───────────────────────────────────────────────────────────────
function buildAbout() {
  const body = `
  <div class="about-shell">
    <a class="back" href="/"><span aria-hidden="true">→</span> الرئيسية</a>
    <h1>عن «كلام له لازمه»</h1>
    <p class="lead">مش كل كلام لازم يتقال… لكن فيه كلام لازم يتقال.</p>
    <p>«كلام له لازمه» هو مشروع مقالات عربي هادف بيكتبه <strong>زياد عمرو</strong>. الفكرة بسيطة: إننا نرجّع للكلمة وزنها، ونكتب في الوعي والقيم والأخلاق بلغة قريبة من القلب — بلا تكلف وبلا تعقيد، بس بحرص على المعنى وعمق في الطرح.</p>
    <h2>إيه اللي بنكتب فيه؟</h2>
    <p>بنكتب في مواضيع بتلمس حياتنا اليومية: الوعي الرقمي، الأخلاق والتزكية، القيم والمجتمع، العلاقات الإنسانية، وكل ما يمسّ القلب والوجدان. الهدف مش الوعظ بقدر ما هو إثارة أسئلة وتقديم رؤية — دينًا واجتماعًا وإنسانية — تساعد القارئ يقف مع نفسه شوية.</p>
    <h2>مين ورا الكلام ده؟</h2>
    <p>أنا <strong>زياد عمرو</strong>، كاتب مهتم بالكلمة الهادية والمعنى العميق. بتلاقيني على موقعي الشخصي وفيه باقي أعمالي وكتاباتي:</p>
    <p><a class="author-link" href="https://ziadamrme.vercel.app" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;background:var(--accent);color:#fff;padding:11px 20px;border-radius:999px;font-weight:800;font-size:14px">ziadamrme.vercel.app <span aria-hidden="true">↗</span></a></p>
    <h2>إزاي تواصلني؟</h2>
    <p>لو عندك ملاحظة، اقتراح لموضوع، أو حابة تشاركني في فكرة — تقدر توصلني من خلال موقعي الشخصي. رأيك بيهمني، وأي حوار بسيط بيفتح باب لفهم أعمق.</p>
    <div class="orn" aria-hidden="true">✦</div>
    <p style="text-align:center;color:var(--muted);font-size:15px">شكرًا إنك قرأت لحد هنا. يلا نكمّل.</p>
  </div>`;
  return shell({
    title: 'عن الموقع — كلام له لازمه',
    metaDesc: 'تعريف بمشروع «كلام له لازمه» ومؤلفه زياد عمرو.',
    body,
    depth: 0,
    canonical: `${SITE_URL}/about`,
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
async function getArticleData(pageId) {
  const allBlocks = await fetchBlockTree(pageId);

  let mainBlocks = [];
  let voweledBlocks = null;
  let exerciseBlocks = [];

  let inExercises = false;
  for (const b of allBlocks) {
    const text = getBlockPlainText(b).trim();

    // Toggle titled "النسخة المشكولة" → save its children as the voweled version
    if (b.type === 'toggle' && text === 'النسخة المشكولة') {
      voweledBlocks = b._children || [];
      continue;
    }
    // Toggle "English Version" → skip everywhere
    if (b.type === 'toggle' && text === 'English Version') {
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

  return { mainHtml, voweledHtml, exercisesHtml, exercises, plainText };
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
function buildSitemap(articles, categories) {
  const urls = [
    { loc: `${SITE_URL}/`, priority: '1.0', changefreq: 'daily' },
    { loc: `${SITE_URL}/start`, priority: '0.8', changefreq: 'monthly' },
    { loc: `${SITE_URL}/about`, priority: '0.6', changefreq: 'monthly' },
  ];
  for (const c of categories) {
    urls.push({ loc: `${SITE_URL}/category/${c.slug}`, priority: '0.5', changefreq: 'weekly' });
  }
  for (const a of articles) {
    urls.push({
      loc: `${SITE_URL}/articles/${a.slug}`,
      priority: '0.8',
      changefreq: 'monthly',
      lastmod: isoDate(a.lastEditedTime || a.createdTime || Date.now()),
    });
  }
  const body = urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}
  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
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

// ── Build RSS feed ───────────────────────────────────────────────────────────
function buildRss(articles) {
  const items = articles.map(a => `    <item>
      <title>${escXml(a.title)}</title>
      <link>${SITE_URL}/articles/${a.slug}</link>
      <guid>${SITE_URL}/articles/${a.slug}</guid>
      <description>${escXml(a.excerpt)}</description>
      <category>${escXml(a.tag)}</category>${a.createdTime ? `\n      <pubDate>${new Date(a.createdTime).toUTCString()}</pubDate>` : ''}
    </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>كلام له لازمه</title>
    <link>${SITE_URL}</link>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>مقالات هادية في الوعي والقيم والأخلاق بقلم زياد عمرو.</description>
    <language>ar</language>
${items}
  </channel>
</rss>`;
}

// ── Build search-index.json ──────────────────────────────────────────────────
function buildSearchIndex(articles) {
  return JSON.stringify(articles.map(a => ({
    title: a.title,
    excerpt: a.excerpt,
    tag: a.tag,
    categorySlug: a.categorySlug,
    slug: a.slug,
    icon: a.icon,
    readingTime: a.readingTime,
    level: a.level || '',
    series: a.series || '',
    hasVoweled: !!a.voweledHtml,
    hasExercises: !!(a.exercises && a.exercises.length),
  })));
}

// ── Client-side app.js (search + theme toggle + share copy) ──────────────────
function buildAppJs() {
  return `
(function(){
  "use strict";
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
    fetch(base + "search-index.json")
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
    if (!searchIndex) { searchResults.innerHTML = '<div class="search-empty">جاري تحميل الفهرس…</div>'; return; }
    var nQ = normalize(q);
    var matches = searchIndex.filter(function(a){
      return normalize(a.title).indexOf(nQ) >= 0 || normalize(a.excerpt).indexOf(nQ) >= 0 || normalize(a.tag).indexOf(nQ) >= 0;
    }).slice(0, 8);
    if (matches.length === 0) {
      searchResults.innerHTML = '<div class="search-empty">مفيش نتائج تطابق بحثك.</div>';
      return;
    }
    searchResults.innerHTML = matches.map(function(a){
      var base = window.SITE_BASE || "";
      return '<a class="search-result" href="' + base + 'articles/' + a.slug + '">' +
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
    if (label) label.textContent = saved ? "محفوظ" : "حفظ";
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
      return '<a class="card bookmark-card" href="articles/' + b.slug + '">' +
        '<div class="card-top"><span class="card-icon" aria-hidden="true">' + (b.icon || "📝") + '</span>' +
        '<button class="bm-remove" type="button" data-slug="' + b.slug + '" aria-label="إزالة من المحفوظات" onclick="event.stopPropagation();event.preventDefault();">×</button></div>' +
        '<h3>' + escapeHtml(b.title) + '</h3>' +
        '<p>' + escapeHtml(b.excerpt || "") + '</p>' +
        '<div class="card-meta"><span class="time">محفوظ</span><span class="read">اقرأ المقال <span class="arr" aria-hidden="true">←</span></span></div>' +
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
    if (confirm("تمسح كل المحفوظات؟")) {
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
        if (label) { var o = label.textContent; label.textContent = "اتنسخ ✓"; setTimeout(function(){ label.textContent = o; }, 1500); }
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
          feedback.textContent = "✓ إجابة صحيحة! أحسنت.";
          feedback.className = "ex-feedback correct";
        } else {
          feedback.textContent = "✗ مش صحيحة — شوف الإجابة الصحيحة باللون الأخضر.";
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
    // Note: Notion property is named "الترتيب في السلسلة" (with definite article)
    const seriesOrder = props['الترتيب في السلسلة']?.number ?? null;

    console.log(`  📄 ${title}  [level=${level || '-'}, series=${series || '-'}, order=${seriesOrder ?? '-'}]`);
    const data = await getArticleData(page.id);
    // Reading time should only count the MAIN article body, not exercises
    const readingTimeVal = readingTime(data.mainHtml);

    articles.push({
      title, slug, tag, excerpt, icon,
      level, series, seriesOrder,
      mainHtml: data.mainHtml,
      voweledHtml: data.voweledHtml,
      exercisesHtml: data.exercisesHtml,
      exercises: data.exercises,
      plainText: data.plainText,
      readingTime: readingTimeVal,
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

  // Create output dirs
  fs.mkdirSync('site/articles', { recursive: true });
  fs.mkdirSync('site/category', { recursive: true });
  fs.mkdirSync('site/css', { recursive: true });
  fs.mkdirSync('site/js', { recursive: true });
  fs.mkdirSync('site/fonts', { recursive: true });
  fs.mkdirSync('site/og', { recursive: true });

  // Copy static assets
  fs.copyFileSync(path.join(__dirname, 'src', 'style.css'), 'site/css/style.css');
  fs.writeFileSync('site/css/style.css', minifyCss(CSS_SOURCE), 'utf8');
  console.log('✅ css/style.css (minified)');

  // Copy fonts (binary, no minify)
  const fontsSrcDir = path.join(__dirname, 'src', 'fonts');
  if (fs.existsSync(fontsSrcDir)) {
    for (const f of fs.readdirSync(fontsSrcDir)) {
      if (f.endsWith('.woff2')) {
        fs.copyFileSync(path.join(fontsSrcDir, f), path.join('site', 'fonts', f));
      }
    }
    console.log(`✅ fonts/ (${fs.readdirSync('site/fonts').length} files)`);
  }

  // app.js (minified)
  fs.writeFileSync('site/js/app.js', minifyJs(buildAppJs()), 'utf8');
  console.log('✅ js/app.js (minified)');

  // search-index.json
  fs.writeFileSync('site/search-index.json', buildSearchIndex(articles), 'utf8');
  console.log('✅ search-index.json');

  // sitemap.xml
  fs.writeFileSync('site/sitemap.xml', buildSitemap(articles, categories), 'utf8');
  console.log('✅ sitemap.xml');

  // robots.txt
  fs.writeFileSync('site/robots.txt', buildRobots(), 'utf8');
  console.log('✅ robots.txt');

  // feed.xml
  fs.writeFileSync('site/feed.xml', buildRss(articles), 'utf8');
  console.log('✅ feed.xml');

  // OG images (SVG per article + default). og:image URLs in shell() use .svg directly.
  fs.writeFileSync('site/og-default.svg', buildOgSvg({ title: 'مقالات في الوعي والقيم', subtitle: 'كلام له لازمه' }), 'utf8');
  for (const a of articles) {
    fs.writeFileSync(`site/og/${a.slug}.svg`, buildOgSvg({ title: a.title, subtitle: 'كلام له لازمه' }), 'utf8');
  }
  console.log(`✅ og/ (${articles.length + 1} SVG images)`);

  // 404 page
  fs.writeFileSync('site/404.html', minifyHtml(build404()), 'utf8');
  console.log('✅ 404.html');

  // About page
  fs.writeFileSync('site/about.html', minifyHtml(buildAbout()), 'utf8');
  console.log('✅ about.html');

  // /start page (entry guide for new visitors)
  fs.writeFileSync('site/start.html', minifyHtml(buildStart(articles)), 'utf8');
  console.log('✅ start.html');

  // Index
  fs.writeFileSync('site/index.html', minifyHtml(buildIndex(articles)), 'utf8');
  console.log('✅ index.html');

  // Articles
  for (const a of articles) {
    fs.writeFileSync(`site/articles/${a.slug}.html`, minifyHtml(buildArticle(a, articles)), 'utf8');
    console.log(`✅ articles/${a.slug}.html`);
  }

  // Category pages
  for (const c of categories) {
    fs.writeFileSync(`site/category/${c.slug}.html`, minifyHtml(buildCategoryPage(c.name, c.slug, c.articles, 1)), 'utf8');
    console.log(`✅ category/${c.slug}.html`);
  }

  console.log(`\n🎉 تم البناء! ${articles.length} مقالات، ${categories.length} تصنيفات.`);
}

main().catch(e => { console.error(e); process.exit(1); });
