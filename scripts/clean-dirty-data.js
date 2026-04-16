#!/usr/bin/env node
/**
 * 清理脏数据 - 删除非菜谱的记录
 * 判断逻辑：ingredients 和 steps 都为空的记录 = 不是菜
 * 运行: node scripts/clean-dirty-data.js
 */

const https = require('https');

// 用云端 API 来清理
const API_BASE = process.env.API_BASE || 'https://express-yi42-246142-8-1421971309.sh.run.tcloudbase.com';

function get(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(data); } });
    }).on('error', reject);
  });
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(path, API_BASE);
    const opts = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(data); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('📦 拉取全量菜谱...');
  const res = await get('/api/recipe/list?page=1&pageSize=200');
  if (!res.success) {
    console.error('❌ 拉取失败:', res);
    return;
  }
  const recipes = res.data;
  console.log(`📊 共 ${res.total} 条记录\n`);

  const dirty = [];
  for (const r of recipes) {
    const hasIngredients = r.ingredients && r.ingredients !== '[]' && r.ingredients !== '[""]';
    const hasSteps = r.steps && r.steps !== '[]' && r.steps !== '[""]';
    const looksLikeRecipe = hasIngredients || hasSteps;
    
    if (!looksLikeRecipe) {
      dirty.push(r);
      console.log(`🗑  id=${r.id} title="${r.title}" ingredients=${r.ingredients} steps=${(r.steps || '').substring(0, 50)}`);
    }
  }

  console.log(`\n📋 发现 ${dirty.length} 条脏数据`);
  
  if (dirty.length === 0) {
    console.log('✅ 数据干净，无需清理');
    return;
  }

  console.log('\n开始删除...');
  let deleted = 0;
  for (const r of dirty) {
    try {
      await post('/api/recipe/delete', { id: r.id });
      deleted++;
      console.log(`  ✅ 已删除 id=${r.id} "${r.title}"`);
    } catch (e) {
      console.log(`  ❌ 删除失败 id=${r.id}: ${e.message}`);
    }
  }
  console.log(`\n🎉 清理完成，共删除 ${deleted} 条脏数据`);
}

main().catch(console.error);
