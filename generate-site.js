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

// ── CSS (inline to keep single-file simplicity) ───────────────────────────────
const CSS = fs.readFileSync(path.join(__dirname, 'src', 'style.css'), 'utf8');

// ── HTML shell ────────────────────────────────────────────────────────────────
function shell({ title, metaDesc, bodyClass, head = '', body }) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${metaDesc}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${metaDesc}">
  <meta property="og:type" content="website">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=Tajawal:wght@300;400;500;700&display=swap" rel="stylesheet">
  <style>${CSS}</style>
  ${head}
</head>
<body class="${bodyClass}">
  <header class="site-header">
    <a href="/" class="brand"><span class="brand-icon">✍️</span><span class="brand-name">كلام له لازمه</span></a>
    <a href="https://ziadamrme.vercel.app" target="_blank" rel="noopener" class="btn-personal">موقعي الشخصي ↗</a>
  </header>
  <div class="progress-bar" id="progress"></div>
  ${body}
  <footer class="site-footer">
    <span>© كلام له لازمه — بقلم <a href="https://ziadamrme.vercel.app" target="_blank" rel="noopener">زياد عمرو</a></span>
  </footer>
  <script>
    const bar = document.getElementById('progress');
    if (bar) {
      window.addEventListener('scroll', () => {
        const pct = window.scrollY / (document.body.scrollHeight - window.innerHeight) * 100;
        bar.style.width = pct + '%';
      });
    }
  </script>
</body>
</html>`;
}

// ── article card ──────────────────────────────────────────────────────────────
function card(a) {
  return `
    <article class="card">
      <div class="card-head">
        <span class="tag">${a.tag}</span>
        <span class="card-icon">${a.icon}</span>
      </div>
      <h2 class="card-title"><a href="/articles/${a.slug}.html">${a.title}</a></h2>
      <p class="card-excerpt">${a.excerpt}</p>
      <div class="card-foot">
        <span class="reading-time">${toArabicDigits(a.readingTime)} دقائق قراءة</span>
        <a href="/articles/${a.slug}.html" class="read-link">اقرأ المقال →</a>
      </div>
    </article>`;
}

// ── index page ────────────────────────────────────────────────────────────────
function buildIndex(articles) {
  const cards = articles.map(card).join('\n');
  const body = `
  <main>
    <section class="hero">
      <div class="hero-quote-mark">❝</div>
      <h1 class="hero-title">كلام له لازمه.</h1>
      <p class="hero-sub">مش كل كلام لازم يتقال… لكن فيه كلام لازم يتقال.<br>مقالات هادية في الوعي والقيم والأخلاق، مكتوبة بلغة قريبة من القلب.</p>
      <div class="hero-divider"><span class="orn">✦</span></div>
    </section>
    <section class="articles-section">
      <div class="section-header">
        <h2 class="section-title">المقالات</h2>
        <span class="count-badge">${toArabicDigits(articles.length)} مقالات</span>
      </div>
      <div class="cards-grid">
        ${cards}
      </div>
    </section>
  </main>`;
  return shell({
    title: 'كلام له لازمه — مقالات في الوعي والقيم',
    metaDesc: 'مقالات هادية في الوعي والقيم والأخلاق، مكتوبة بلغة قريبة من القلب.',
    bodyClass: 'page-home',
    body
  });
}

// ── article page ──────────────────────────────────────────────────────────────
function buildArticle(a, allArticles) {
  const others = allArticles.filter(x => x.slug !== a.slug).slice(0, 2);
  const otherCards = others.map(card).join('\n');
  const body = `
  <main class="article-main">
    <div class="article-nav">
      <a href="/" class="back-link">← كل المقالات</a>
    </div>
    <article class="article">
      <header class="article-header">
        <span class="tag">${a.tag}</span>
        <h1 class="article-title">${a.title}</h1>
        <div class="article-meta">
          <span>بقلم <strong class="author">زياد عمرو</strong></span>
          <span class="sep">•</span>
          <span>${toArabicDigits(a.readingTime)} دقائق قراءة</span>
        </div>
        ${a.excerpt ? `<blockquote class="article-lede"><span class="lede-icon">${a.icon}</span>${a.excerpt}</blockquote>` : ''}
      </header>
      <div class="article-body">
        ${a.html}
      </div>
      <div class="author-card">
        <div class="author-avatar">ز</div>
        <div class="author-info">
          <p class="author-label">المؤلف</p>
          <p class="author-name">زياد عمرو</p>
          <a href="https://ziadamrme.vercel.app" target="_blank" rel="noopener" class="btn-site">ziadamrme.vercel.app ↗</a>
        </div>
      </div>
    </article>
    ${others.length ? `
    <section class="more-section">
      <h2 class="more-title">اقرأ كمان</h2>
      <div class="cards-grid cards-grid--narrow">${otherCards}</div>
    </section>` : ''}
  </main>`;
  return shell({
    title: `${a.title} — كلام له لازمه`,
    metaDesc: a.excerpt || '',
    bodyClass: 'page-article',
    body
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
  // closing block
  md = md.replace(/<closing>([\s\S]*?)<\/closing>/g, '<div class="closing">$1</div>');

  // Convert markdown to HTML
  let html = marked.parse(md);

  // Add accent bar to h2
  html = html.replace(/<h2>/g, '<h2 class="section-h2">');

  return html;
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
