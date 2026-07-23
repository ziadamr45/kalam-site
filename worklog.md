# Worklog — kalaam-site bilingual (Arabic + English) build

---
Task ID: i18n-1
Agent: main
Task: Add full English language support to kalaam-site while preserving all existing Arabic content and features. Notion data is ready (new properties "العنوان EN", "المقتطف EN", and "English Version" toggle inside each article page). 3 current articles are already translated.

Work Log:
- Read generate-site.js (1947 lines) + src/style.css (956 lines) end-to-end to map existing architecture
- Verified Notion data via inspect-notion-en.js: all 3 articles have "العنوان EN" + "المقتطف EN" properties + "English Version" toggle with children (15-23 blocks each, heading_2 + paragraphs)
- Downloaded Latin fonts: Inter (UI, variable woff2 Latin + Latin-ext, 48KB + 85KB) + Source Serif 4 (article body, variable woff2 Latin + Latin-ext, 122KB + 100KB) — saved to src/fonts/
- Created locales/ar.json + locales/en.json with all UI strings extracted from current Arabic templates (nav, home, article, engagement, search, footer, category, levels, 404, about, start, admin)
- Updated src/style.css:
  - Added Inter + Source Serif 4 @font-face declarations (variable fonts, 2 files each)
  - Added --font-display-en + --font-body-en CSS vars; html[lang="en"] swaps --font-display + --font-body to Latin stacks
  - Converted all directional CSS (padding-right, margin-left, border-right, text-align:left, right:0, left:-6px, etc.) to CSS logical properties (padding-inline-start, margin-inline-end, border-inline-start, text-align:start/end, inset-inline-start/end)
  - Added .verse-en + .hadith-en blockquote styles (gold/green block-level quotes for English Quran verses + hadiths, LTR)
  - Added .lang-switch button styles (language switcher in header)
  - Added English typography tweaks (line-height, letter-spacing, font-size adjustments)

Stage Summary:
- Locales infrastructure ready (ar.json + en.json, ~10KB each, all UI strings extracted)
- Fonts ready: 4 Latin woff2 files in src/fonts/ (Inter + Source Serif 4, Latin + Latin-ext subsets)
- CSS ready: shared stylesheet works RTL + LTR via logical properties, English fonts swap in via [lang="en"]
- Next: refactor generate-site.js to (a) load locales, (b) extract English body from Notion "English Version" toggle, (c) generate /en/ pages, (d) add language switcher, hreflang, sitemap, RSS, JSON-LD inLanguage

---
Task ID: i18n-2
Agent: main
Task: Deploy + verify bilingual site live on kalaam-site.vercel.app

Work Log:
- Committed all i18n changes (generate-site.js, src/style.css, src/fonts/{inter,source-serif-4}-la*.woff2, locales/ar.json, locales/en.json)
- Pushed to GitHub (commit cadb27f)
- Triggered Vercel deploy hook → deployment completed
- Verified live URLs (all return 200):
  - https://kalaam-site.vercel.app/ (AR homepage, lang="ar" dir="rtl") — unchanged
  - https://kalaam-site.vercel.app/en/ (EN homepage, lang="en" dir="ltr") — NEW
  - https://kalaam-site.vercel.app/articles/forgiveness (AR article, hreflang to /en/articles/forgiveness)
  - https://kalaam-site.vercel.app/en/articles/forgiveness (EN article, hreflang to /articles/forgiveness)
  - https://kalaam-site.vercel.app/en/rss.xml (EN RSS, language=en, 3 items)
  - https://kalaam-site.vercel.app/en/search-index.json (EN search index, 3 translated articles)
  - https://kalaam-site.vercel.app/fonts/inter-la.woff2 (200, 48KB)
  - https://kalaam-site.vercel.app/fonts/source-serif-4-la.woff2 (200, 122KB)
- Verified lang switcher targets:
  - AR homepage → /en/
  - AR article → /en/articles/{slug} (when translated)
  - EN homepage → /
  - EN article → /articles/{slug}
- Verified hreflang alternate tags on both AR + EN pages (ar ↔ en ↔ x-default=ar)
- Verified JSON-LD inLanguage correct per page (ar / en)
- Verified EN article hides tashkeel button + exercises section (Arabic-only features)
- Verified EN verse-en/hadith-en blockquotes rendered correctly with <cite> for citations
- Verified EN article "Written by Ziad Amr" + "X min read" (English labels)
- Verified EN homepage shows only 3 translated articles (no broken links to untranslated)
- Verified EN category pages work (only categories with translated articles)

Stage Summary:
- Full bilingual site live: AR at / (unchanged), EN at /en/ (new)
- All 3 current articles translated and live in both languages
- Language switcher bidirectional with smart fallback (untranslated article → /en/ home)
- hreflang alternate tags + sitemap entries with xhtml:link alternates
- Per-language RSS feed + search index + JSON-LD inLanguage
- Self-hosted Inter + Source Serif 4 fonts on EN, Amiri + Tajawal on AR
- Shared CSS via logical properties (margin/padding/border/text-align inline-*) — works RTL + LTR
- App.js runtime localized via window.SITE_LANG + window.SITE_I18N
- New Notion articles auto-work: if "العنوان EN" + "English Version" toggle exist + published=true → EN pages generated automatically with same slug
