// dotenv is optional: locally it loads .env, on Vercel env vars are injected directly.
try {
  require('dotenv').config();
} catch (_) {
  // dotenv not installed (e.g. on Vercel) — fall through to process.env.
}

const { Client } = require('@notionhq/client');
const { NotionToMarkdown } = require('notion-to-md');
const { marked } = require('marked');
const fs = require('fs');
const path = require('path');

if (!process.env.NOTION_TOKEN || !process.env.NOTION_DATABASE_ID) {
  console.error('❌ Environment variables NOTION_TOKEN and NOTION_DATABASE_ID are required.');
  console.error('   Local: create a .env file (see .env.example). Vercel: set them in Project Settings → Environment Variables.');
  process.exit(1);
}

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });
const DB_ID = process.env.NOTION_DATABASE_ID;

// ── helpers ──────────────────────────────────────────────────────────────────
function readingTime(html) {
  const words = html.replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

// Arabic digits
function toArabicDigits(n) {
  return String(n).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
}

// ── CSS source (read once, copied to site/css/style.css during build) ─────────
const CSS_SOURCE = fs.readFileSync(path.join(__dirname, 'src', 'style.css'), 'utf8');

// ── HTML shell ────────────────────────────────────────────────────────────────
// depth: 0 = root page, 1 = page inside /articles/
function shell({ title, metaDesc, body, depth = 0, headExtra = '' }) {
  const cssHref = depth === 0 ? 'css/style.css' : '../css/style.css';
  const homeHref = depth === 0 ? 'index.html' : '../index.html';
  const YEAR = toArabicDigits(new Date().getFullYear());
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${metaDesc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${metaDesc}">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${cssHref}">
${headExtra}
</head>
<body>
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
    <a class="header-link" href="https://ziadamrme.vercel.app" target="_blank" rel="noopener">موقعي الشخصي <span aria-hidden="true">↗</span></a>
  </div>
</header>
${body}
<footer class="site-footer">
  <div class="wrap">
    <span class="f-brand">كلام له لازمه<span style="color:var(--gold)">.</span></span>
    <span class="f-note">جميع الحقوق محفوظة © ${YEAR} — بقلم <a href="https://ziadamrme.vercel.app" target="_blank" rel="noopener">زياد عمرو</a></span>
  </div>
</footer>
<script>
(function(){var b=document.getElementById("progress");window.addEventListener("scroll",function(){var h=document.documentElement,m=h.scrollHeight-h.clientHeight;b.style.width=(m>0?(h.scrollTop/m)*100:0)+"%";},{passive:true});})();
</script>
</body>
</html>`;
}

// ── article card (whole card is a single <a>) ────────────────────────────────
// depth: 0 = root (href = articles/SLUG.html), 1 = inside /articles/ (href = SLUG.html)
function card(a, depth = 0) {
  const href = depth === 0 ? `articles/${a.slug}.html` : `${a.slug}.html`;
  return `<a class="card" href="${href}">
  <div class="card-top"><span class="card-icon" aria-hidden="true">${a.icon}</span><span class="card-tag">${a.tag}</span></div>
  <h3>${a.title}</h3>
  <p>${a.excerpt}</p>
  <div class="card-meta"><span class="time">${toArabicDigits(a.readingTime)} دقايق قراءة</span><span class="read">اقرأ المقال <span class="arr" aria-hidden="true">←</span></span></div>
</a>`;
}

// ── index page ────────────────────────────────────────────────────────────────
function buildIndex(articles) {
  const cards = articles.map(a => card(a, 0)).join('\n');
  const body = `<main>
  <div class="hero">
    <span class="hero-quote" aria-hidden="true">”</span>
    <h1>كلام له لازمه<span class="dot">.</span></h1>
    <p class="tag">مش كل كلام يتقال… لكن فيه كلام لازم يتقال. مقالات هادية في الوعي والقيم والأخلاق، مكتوبة بلغة قريبة من القلب.</p>
    <div class="orn-line" aria-hidden="true">✦</div>
  </div>
  <div class="wrap">
    <div class="section-head">
      <h2>المقالات</h2>
      <span class="count">${toArabicDigits(articles.length)} مقالات</span>
    </div>
    <div class="grid">
${cards}
    </div>
  </div>
</main>`;
  return shell({
    title: 'كلام له لازمه — مقالات في الوعي والقيم',
    metaDesc: 'مقالات هادية في الوعي والقيم والأخلاق بقلم زياد عمرو.',
    body,
    depth: 0
  });
}

// ── article page ──────────────────────────────────────────────────────────────
function buildArticle(a, allArticles) {
  const others = allArticles.filter(x => x.slug !== a.slug).slice(0, 2);
  const otherCards = others.map(x => card(x, 1)).join('\n');
  const moreSection = others.length ? `
  <div class="more">
    <h2>اقرأ كمان</h2>
    <div class="grid" style="padding-bottom:0">
${otherCards}
    </div>
  </div>` : '';
  const body = `<main>
  <div class="article-shell">
    <a class="back" href="../index.html"><span aria-hidden="true">→</span> كل المقالات</a>
    <header class="article-head">
      <span class="card-tag">${a.tag}</span>
      <h1>${a.title}</h1>
      <div class="meta">
        <span>بقلم <span class="who">زياد عمرو</span></span>
        <span class="sep" aria-hidden="true">•</span>
        <span>${toArabicDigits(a.readingTime)} دقايق قراءة</span>
      </div>
    </header>
    <div class="article-body">
${a.html}
    </div>
    <aside class="author-card">
      <span class="avatar" aria-hidden="true">ز</span>
      <div class="author-info">
        <div class="lbl">المؤلف</div>
        <div class="name">زياد عمرو</div>
      </div>
      <a class="author-link" href="https://ziadamrme.vercel.app" target="_blank" rel="noopener">ziadamrme.vercel.app <span aria-hidden="true">↗</span></a>
    </aside>
  </div>${moreSection}
</main>`;
  return shell({
    title: `${a.title} — كلام له لازمه`,
    metaDesc: a.excerpt || '',
    body,
    depth: 1
  });
}

// ── Notion → HTML conversion ──────────────────────────────────────────────────
async function getArticleHtml(pageId) {
  const mdBlocks = await n2m.pageToMarkdown(pageId);
  let md = n2m.toMarkdownString(mdBlocks).parent;

  // Style Quran verses ﴿...﴾ → gold span
  md = md.replace(/﴿([^﴾]+)﴾/g, '<span class="verse">﴿$1﴾</span>');
  // Style hadith «...» → teal span
  md = md.replace(/«([^»]+)»/g, '<span class="hadith">«$1»</span>');
  // closing block (Notion paragraphs wrapping <closing>...</closing>)
  md = md.replace(/<closing>([\s\S]*?)<\/closing>/g, '<div class="closing">$1</div>');
  // Remove any leftover literal <closing> tags that survived markdown
  md = md.replace(/&lt;closing&gt;([\s\S]*?)&lt;\/closing&gt;/g, '<div class="closing">$1</div>');

  // Convert markdown to HTML
  let html = marked.parse(md);

  // Add accent bar to h2 inside article body (CSS expects h2 inside .article-body,
  // which it already is — but keep this hook in case future styling needs a class)
  // No class needed; .article-body h2 selector handles it.

  // Insert ornamental divider before each h2 (matches reference design)
  html = html.replace(/<h2>/g, '<div aria-hidden="true" class="orn">✦</div>\n<h2>');

  return html.trim();
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('⏳ جاري سحب المقالات من Notion...');

  const response = await notion.databases.query({
    database_id: DB_ID,
    filter: { property: 'منشور', checkbox: { equals: true } },
    sorts: [{ timestamp: 'created_time', direction: 'descending' }]
  });

  const articles = [];
  for (const page of response.results) {
    const props = page.properties;
    const title = props['العنوان']?.title?.[0]?.plain_text || 'بدون عنوان';
    const slug  = props['Slug']?.rich_text?.[0]?.plain_text || page.id;
    const tag   = props['التصنيف']?.select?.name || '';
    const excerpt = props['المقتطف']?.rich_text?.[0]?.plain_text || '';
    const icon  = props['الأيقونة']?.rich_text?.[0]?.plain_text || '📝';

    console.log(`  📄 ${title}`);
    const html = await getArticleHtml(page.id);
    const readingTimeVal = readingTime(html);

    articles.push({ title, slug, tag, excerpt, icon, html, readingTime: readingTimeVal, pageId: page.id });
  }

  // Create output dirs
  fs.mkdirSync('site/articles', { recursive: true });
  fs.mkdirSync('site/css', { recursive: true });

  // Copy CSS to site/css/style.css (CSS is now a separate file)
  fs.writeFileSync('site/css/style.css', CSS_SOURCE, 'utf8');
  console.log('✅ css/style.css');

  // Write index
  fs.writeFileSync('site/index.html', buildIndex(articles), 'utf8');
  console.log('✅ index.html');

  // Write articles
  for (const a of articles) {
    fs.writeFileSync(`site/articles/${a.slug}.html`, buildArticle(a, articles), 'utf8');
    console.log(`✅ articles/${a.slug}.html`);
  }

  console.log(`\n🎉 تم البناء! ${articles.length} مقالات.`);
}

main().catch(e => { console.error(e); process.exit(1); });
