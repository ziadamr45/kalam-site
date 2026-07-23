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
