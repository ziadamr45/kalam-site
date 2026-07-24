/* ============================================================
   generate-site-v2.js — Redesign v2 (editorial, calm, premium)
   Reuses Notion data fetch + locale + backend API contracts.
   Outputs new HTML/CSS to site/.
   ============================================================ */

try { require('dotenv').config(); } catch (_) {}

const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

if (!process.env.NOTION_TOKEN || !process.env.NOTION_DATABASE_ID) {
  console.error('❌ NOTION_TOKEN and NOTION_DATABASE_ID are required.');
  process.exit(1);
}

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_DATABASE_ID;
const SITE_URL = (process.env.SITE_URL || 'https://kalaam-site.vercel.app').replace(/\/$/, '');

// ── Locales ────────────────────────────────────────────────
const LOCALES = {
  ar: JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', 'ar.json'), 'utf8')),
  en: JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', 'en.json'), 'utf8')),
};
function t(lang, key, params) {
  const parts = key.split('.');
  let v = LOCALES[lang];
  for (const p of parts) {
    if (v && typeof v === 'object' && p in v) v = v[p];
    else { v = undefined; break; }
  }
  if (typeof v !== 'string') return '';
  if (params) for (const k of Object.keys(params)) v = v.replace(new RegExp('\\{' + k + '\\}', 'g'), String(params[k]));
  return v;
}
function fmtNum(lang, n) {
  if (lang === 'ar') return toArabicDigits(n);
  return String(n);
}
function localizeTag(lang, tag) {
  if (!tag) return '';
  if (lang === 'ar') return tag;
  return t('en', 'categories.' + tag) || tag;
}
function localizeLevel(lang, level) {
  if (!level) return '';
  if (lang === 'ar') return level;
  return t('en', 'levels.' + level) || level;
}
function localizeDate(lang, date) {
  const d = new Date(date);
  if (lang === 'en') return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ── Helpers ────────────────────────────────────────────────
function readingTime(html) {
  const words = html.replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}
function toArabicDigits(n) {
  return String(n).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
}
function escAttr(s) { return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escXml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
function slugifyArabicTag(tag) {
  return String(tag || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\u0600-\u06FFa-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'uncategorized';
}
function isoDate(d) { return new Date(d).toISOString(); }
function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── CSS ────────────────────────────────────────────────────
const CSS_SOURCE = fs.readFileSync(path.join(__dirname, 'src', 'style-v2.css'), 'utf8');

// ── Inline SVG icons (clean, 1px stroke, geometric) ───────
const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  sun:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
  moon:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  clock:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
  heart:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  comment:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  arrowR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  arrowL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
  globe:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
};

// ── Notion block fetch + render (copied from v1, unchanged data logic) ────
async function fetchBlockTree(blockId) {
  const out = [];
  let cursor;
  do {
    const resp = await notion.blocks.children.list({
      block_id: blockId, start_cursor: cursor, page_size: 100,
    });
    for (const b of resp.results) {
      const block = { ...b, _children: [] };
      if (b.has_children) block._children = await fetchBlockTree(b.id);
      out.push(block);
    }
    cursor = resp.has_more ? resp.next_cursor : null;
  } while (cursor);
  return out;
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

// Render Arabic blocks — verse/hadith tags, closing, ornaments
function renderBlocks(blocks) {
  let html = '';
  let i = 0;
  const transforms = (s) => s
    .replace(/﴿([^﴾]+)﴾/g, '<span class="verse-inline">﴿$1﴾</span>')
    .replace(/«([^»]+)»/g, '<span class="hadith-inline">«$1»</span>')
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
        html += `<li>${transforms(renderRichText(getBlockRichText(blocks[i])))}</li>`;
        i++;
      }
      html += '</ol>';
      continue;
    }

    const text = transforms(renderRichText(getBlockRichText(b)));
    switch (t) {
      case 'heading_1': html += `<h2 id="h-${i}">${text}</h2>`; break;
      case 'heading_2': html += `<h2 id="h-${i}">${text}</h2>`; break;
      case 'heading_3': html += `<h3 id="h-${i}">${text}</h3>`; break;
      case 'paragraph': html += text ? `<p>${text}</p>` : ''; break;
      case 'divider': html += '<hr>'; break;
      case 'quote': html += `<blockquote>${text}</blockquote>`; break;
      case 'callout': html += `<div class="callout">${text}</div>`; break;
      case 'toggle': html += `<details class="toggle"><summary>${text}</summary>${renderBlocks(b._children || [])}</details>`; break;
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
      default: html += text ? `<p>${text}</p>` : '';
    }
    i++;
  }
  html = html.replace(/<p>\s*<\/p>/g, '');
  return html;
}

// Render English blocks — verse/hadith detection from quote+citation pattern
function renderBlocksEn(blocks) {
  const blockList = blocks.filter(b => {
    const text = getBlockPlainText(b).trim();
    if (b.type === 'toggle' && (text === 'النسخة المشكولة' || text === 'English Version')) return false;
    if (b.type === 'heading_2' && text === 'تدريبات') return false;
    return true;
  });

  let lastParagraphIdx = -1;
  for (let i = blockList.length - 1; i >= 0; i--) {
    if (blockList[i].type === 'paragraph') { lastParagraphIdx = i; break; }
  }

  let html = '';
  let i = 0;
  while (i < blockList.length) {
    const b = blockList[i];
    const t = b.type;

    if (t === 'bulleted_list_item') {
      html += '<ul>';
      while (i < blockList.length && blockList[i].type === 'bulleted_list_item') {
        html += `<li>${renderRichText(getBlockRichText(blockList[i]))}</li>`;
        i++;
      }
      html += '</ul>';
      continue;
    }
    if (t === 'numbered_list_item') {
      html += '<ol>';
      while (i < blockList.length && blockList[i].type === 'numbered_list_item') {
        html += `<li>${renderRichText(getBlockRichText(blockList[i]))}</li>`;
        i++;
      }
      html += '</ol>';
      continue;
    }

    const text = renderRichText(getBlockRichText(b));
    switch (t) {
      case 'heading_1': html += `<h2 id="h-${i}">${text}</h2>`; break;
      case 'heading_2': html += `<h2 id="h-${i}">${text}</h2>`; break;
      case 'heading_3': html += `<h3 id="h-${i}">${text}</h3>`; break;
      case 'paragraph':
        if (!text) { i++; break; }
        if (i === lastParagraphIdx) html += `<div class="closing">${text}</div>`;
        else html += transformEnglishQuoteParagraph(text);
        break;
      case 'divider': html += '<hr>'; break;
      case 'quote': html += `<blockquote>${text}</blockquote>`; break;
      case 'callout': html += `<div class="callout">${text}</div>`; break;
      case 'toggle': html += `<details class="toggle"><summary>${text}</summary>${renderBlocksEn(b._children || [])}</details>`; break;
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
      default: html += text ? `<p>${text}</p>` : '';
    }
    i++;
  }
  html = html.replace(/<p>\s*<\/p>/g, '');
  return html;
}

function transformEnglishQuoteParagraph(paragraphHtml) {
  const re = /([""]([^""]{8,400})[""]|'([^']{8,400})')\s*(\[[A-Za-z][A-Za-z\s\d:.\-'’]+?\])/g;
  re.lastIndex = 0;
  const matches = [];
  let m;
  while ((m = re.exec(paragraphHtml)) !== null) {
    matches.push({ full: m[0], quote: m[2] || m[3], citation: m[4], index: m.index, end: m.index + m[0].length });
  }
  if (matches.length === 0) return `<p>${paragraphHtml}</p>`;
  let result = '';
  let lastEnd = 0;
  for (const mt of matches) {
    const before = paragraphHtml.slice(lastEnd, mt.index).trim();
    if (before) {
      const cleaned = before.replace(/^[\s:;,.—–-]+/, '').trim();
      if (cleaned) result += `<p>${cleaned}</p>`;
    }
    const hadithKeywords = /Muslim|Bukhari|Agreed|Tirmidhi|Abu Dawud|Ibn Majah|Nasai|Ahmad|Tabari|Bayhaqi|Malik|Prophet|Messenger|ﷺ|hadith/i;
    const verseKeywords = /Quran|Surah|Al-|An-|Verse|Ayah|Allah said|Allah says|Allah revealed/i;
    const contextText = (paragraphHtml.slice(Math.max(0, mt.index - 100), mt.index)) + ' ' + mt.citation;
    const isHadith = hadithKeywords.test(contextText) && !verseKeywords.test(mt.citation);
    const isVerse = verseKeywords.test(mt.citation) || (!isHadith && /Allah|revealed|verse/i.test(contextText));
    const cls = isHadith ? 'hadith-en' : (isVerse ? 'verse-en' : 'hadith-en');
    result += `<blockquote class="${cls}"><p>${escapeHtml(mt.quote)}</p><span class="citation">${escapeHtml(mt.citation)}</span></blockquote>`;
    lastEnd = mt.end;
  }
  const after = paragraphHtml.slice(lastEnd).trim();
  if (after) {
    const cleaned = after.replace(/^[\s:;,.—–-]+/, '').trim();
    if (cleaned) result += `<p>${cleaned}</p>`;
  }
  return result || `<p>${paragraphHtml}</p>`;
}

// ── Exercise parser + renderer (Arabic-only) ───────────────
function parseExercises(blocks) {
  const sections = [];
  let currentSection = null;
  for (const b of blocks) {
    const text = getBlockPlainText(b).trim();
    if (b.type === 'heading_2' && text === 'تدريبات') continue;
    if (b.type === 'toggle' && text === 'English Version') continue;
    if (b.type === 'heading_3') {
      const isI3rab = /إعراب/.test(text);
      currentSection = { type: isI3rab ? 'i3rab' : 'mcq', title: text, questions: [], items: [] };
      sections.push(currentSection);
      continue;
    }
    if (b.type === 'numbered_list_item' && (b._children || []).length) {
      const opts = (b._children || []).filter(c => c.type === 'bulleted_list_item').map(c => {
        const rt = getBlockRichText(c);
        return { html: renderRichText(rt), isCorrect: rt.some(r => r.annotations?.bold) };
      });
      if (!currentSection) { currentSection = { type: 'mcq', title: 'أسئلة', questions: [], items: [] }; sections.push(currentSection); }
      if (currentSection.type !== 'mcq') { currentSection = { type: 'mcq', title: 'أسئلة', questions: [], items: [] }; sections.push(currentSection); }
      currentSection.questions.push({ questionHtml: renderRichText(getBlockRichText(b)), options: opts });
      continue;
    }
    if (b.type === 'toggle' && /^إعراب/.test(text)) {
      if (!currentSection || currentSection.type !== 'i3rab') {
        currentSection = { type: 'i3rab', title: 'تدريبات الإعراب', questions: [], items: [] };
        sections.push(currentSection);
      }
      const answerItems = (b._children || []).filter(c => c.type === 'bulleted_list_item').map(c => `<li>${renderRichText(getBlockRichText(c))}</li>`).join('');
      currentSection.items.push({ questionHtml: renderRichText(getBlockRichText(b)), answerHtml: `<ul>${answerItems}</ul>` });
      continue;
    }
  }
  return sections;
}

function renderExercises(sections, lang) {
  if (!sections || !sections.length) return '';
  const L = LOCALES[lang].article;
  let html = `<section class="exercises" id="exercises" aria-label="${escAttr(L.exercisesAria)}">`;
  html += `<div class="exercises__head"><h2 class="exercises__title">${escapeHtml(L.exercises)}</h2></div>`;
  let qNum = 0;
  for (const s of sections) {
    html += `<div class="exercises__section">`;
    html += `<h3>${escapeHtml(s.title)}</h3>`;
    if (s.type === 'mcq') {
      for (const q of s.questions) {
        qNum++;
        html += `<div class="exercise" data-q="${qNum}">`;
        html += `<p class="exercise__prompt"><span class="exercise__num">${toArabicDigits(qNum)}.</span> ${q.questionHtml}</p>`;
        html += `<ul class="exercise__choices" role="radiogroup" aria-label="${escAttr(L.question)} ${toArabicDigits(qNum)}">`;
        q.options.forEach((opt, idx) => {
          const letter = 'أبتثجحخدذرزسشصضطظعغفقكلمنهوي'[idx] || String.fromCharCode(65 + idx);
          html += `<li><button class="exercise__choice" data-correct="${opt.isCorrect ? '1' : '0'}" type="button" role="radio" aria-checked="false"><span class="exercise__marker">${letter}</span><span class="exercise__choice-text">${opt.html}</span></button></li>`;
        });
        html += `</ul><div class="exercise__feedback" role="status" aria-live="polite"></div>`;
        html += `</div>`;
      }
    } else if (s.type === 'i3rab') {
      let iNum = 0;
      for (const item of s.items) {
        iNum++;
        html += `<div class="exercise" data-i3rab="${iNum}">`;
        html += `<p class="exercise__prompt"><span class="exercise__num">${toArabicDigits(iNum)}.</span> ${item.questionHtml}</p>`;
        html += `<button class="exercise__reveal" type="button" aria-expanded="false">${escapeHtml(L.showAnswer)} <span aria-hidden="true">▾</span></button>`;
        html += `<div class="exercise__answer" hidden>${item.answerHtml}</div>`;
        html += `</div>`;
      }
    }
    html += `</div>`;
  }
  html += '</section>';
  return html;
}

// ── Plain text for copy button + teacher mode ──────────────
function blocksToPlainText(blocks) {
  let out = '';
  for (const b of blocks) {
    const t = b.type;
    const text = getBlockPlainText(b);
    if (t === 'heading_1' || t === 'heading_2' || t === 'heading_3') {
      out += '\n\n' + text + '\n\n';
    } else if (t === 'bulleted_list_item' || t === 'numbered_list_item') {
      out += '  • ' + text + '\n';
    } else if (t === 'quote') {
      out += '\n  ' + text + '\n\n';
    } else if (t === 'image' || t === 'divider') {
      // skip
    } else {
      out += text + '\n\n';
    }
  }
  return out.trim();
}

async function getArticleData(pageId) {
  const allBlocks = await fetchBlockTree(pageId);
  let mainBlocks = [];
  let voweledBlocks = null;
  let exerciseBlocks = [];
  let englishBlocks = null;
  let inExercises = false;
  for (const b of allBlocks) {
    const text = getBlockPlainText(b).trim();
    if (b.type === 'toggle' && text === 'النسخة المشكولة') { voweledBlocks = b._children || []; continue; }
    if (b.type === 'toggle' && text === 'English Version') { englishBlocks = b._children || []; continue; }
    if (b.type === 'heading_2' && text === 'تدريبات') { inExercises = true; exerciseBlocks.push(b); continue; }
    if (inExercises) exerciseBlocks.push(b);
    else mainBlocks.push(b);
  }
  const mainHtml = renderBlocks(mainBlocks).trim();
  const voweledHtml = voweledBlocks && voweledBlocks.length ? renderBlocks(voweledBlocks).trim() : null;
  const exercises = parseExercises(exerciseBlocks);
  const exercisesHtml = renderExercises(exercises, 'ar');
  const plainText = blocksToPlainText(mainBlocks);
  const englishHtml = englishBlocks && englishBlocks.length ? renderBlocksEn(englishBlocks).trim() : null;
  const englishPlainText = englishBlocks && englishBlocks.length ? blocksToPlainText(englishBlocks) : '';
  return { mainHtml, voweledHtml, exercisesHtml, exercises, plainText, englishHtml, englishPlainText, hasEnglish: !!(englishBlocks && englishBlocks.length) };
}

// ── Build TOC from h2 headings in the article HTML ────────
function buildToc(html) {
  const matches = [...html.matchAll(/<h([23])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)];
  if (matches.length < 2) return null; // not enough headings for a TOC
  return matches.map(m => ({ level: parseInt(m[1]), id: m[2], text: m[3].replace(/<[^>]+>/g, '') }));
}

module.exports = {
  LOCALES, t, fmtNum, localizeTag, localizeLevel, localizeDate,
  readingTime, toArabicDigits, escAttr, escXml, slugifyArabicTag, isoDate, escapeHtml,
  renderBlocks, renderBlocksEn, parseExercises, renderExercises, blocksToPlainText,
  getArticleData, fetchBlockTree, renderRichText, getBlockRichText, getBlockPlainText,
  buildToc, ICONS, CSS_SOURCE, SITE_URL, notion, DB_ID,
};
