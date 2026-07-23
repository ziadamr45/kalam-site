// Debug: check what getArticleData returns for forgiveness article
require('dotenv').config();
const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_DATABASE_ID;

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

function getBlockRichText(b) {
  const t = b.type;
  return (b[t] && b[t].rich_text) ? b[t].rich_text : [];
}
function getBlockPlainText(b) {
  return getBlockRichText(b).map(r => r.plain_text || '').join('');
}

async function main() {
  const resp = await notion.databases.query({
    database_id: DB_ID,
    filter: { property: 'منشور', checkbox: { equals: true } },
  });
  const page = resp.results[0];
  console.log(`Inspecting: ${page.id} (${page.properties['العنوان'].title[0].plain_text})`);

  const blocks = await fetchBlockTree(page.id);
  console.log(`\nTotal top-level blocks: ${blocks.length}`);

  let voweledCount = 0;
  let exercisesCount = 0;
  let mainCount = 0;
  let inEx = false;

  for (const b of blocks) {
    const text = getBlockPlainText(b).trim();
    let category = 'main';

    if (b.type === 'toggle' && text === 'النسخة المشكولة') {
      category = 'VOWELED';
      voweledCount = (b._children || []).length;
    } else if (b.type === 'toggle' && text === 'English Version') {
      category = 'ENGLISH (skipped)';
    } else if (b.type === 'heading_2' && text === 'تدريبات') {
      inEx = true;
      category = 'EXERCISES_START';
      exercisesCount++;
    } else if (inEx) {
      category = 'exercise';
      exercisesCount++;
    } else {
      mainCount++;
    }
    console.log(`  [${category}] ${b.type}: "${text.slice(0, 60)}"`);
  }
  console.log(`\nSummary: main=${mainCount}, voweled children=${voweledCount}, exercise blocks=${exercisesCount}`);
}
main().catch(e => { console.error(e); process.exit(1); });
