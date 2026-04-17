#!/usr/bin/env node
/**
 * 清理 collection 表中 openid 为 null 的脏数据
 * 原因：历史记录是 openid=null 时写入的，新索引改为 (openid, recipeId) 复合唯一
 * 运行: node scripts/clean-collections-null-openid.js
 */

const https = require('https');

const API_BASE = process.env.API_BASE || 'https://express-yi42-246142-8-1421971309.sh.run.tcloudbase.com';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(path, API_BASE);
    const opts = {
      hostname: url.hostname,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  // 先用内侧接口查所有收藏（传 openid=all 会查全量，由后端内部逻辑决定）
  // collection/list 不强制 openid，这里用它来拉数据
  const res = await request('GET', '/api/collect/list');
  if (!res.success) {
    console.error('❌ 拉取失败:', res);
    return;
  }

  const nullOpenidItems = (res.data || []).filter(item => !item.openid);
  console.log(`📊 收藏总数: ${res.data.length}，其中 openid=null: ${nullOpenidItems.length}`);

  if (nullOpenidItems.length === 0) {
    console.log('✅ 没有 null openid 记录，无需清理');
    return;
  }

  // 删除这些记录（由于新索引是 (openid, recipeId)，
  // 删除后再用 header openid 收藏同一菜谱就能正常创建了）
  let deleted = 0;
  for (const item of nullOpenidItems) {
    try {
      // 删 recipeId + openid=null 的记录
      await request('POST', '/api/collect/remove', { recipeId: item.recipeId });
      deleted++;
      console.log(`  ✅ 已删除 recipeId=${item.recipeId}`);
    } catch (e) {
      console.log(`  ❌ 删除失败 recipeId=${item.recipeId}: ${e.message}`);
    }
  }

  console.log(`\n🎉 清理完成，共删除 ${deleted} 条`);
}

main().catch(console.error);
