#!/usr/bin/env node
/**
 * 一次性脚本：将本地 articles 目录的历史选题批量写入服务器数据库
 * 用法: node scripts/migrate-published-articles.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const ARTICLES_DIR = path.resolve(process.env.HOME, 'Desktop/wzmmaven/weikou/articles');
const BASE_URL = 'express-yi42-246142-8-1421971309.sh.run.tcloudbase.com';

/**
 * 提取文件名中的日期
 */
function extractDate(filename) {
  const m = filename.match(/^(\d{4}-\d{2}-\d{2})_/);
  return m ? m[1] : null;
}

/**
 * 解析 front matter 中的 title
 */
function extractTitle(content) {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const m = fm[1].match(/title:\s*["']?(.*?)["']?\s*$/m);
  return m ? m[1].trim() : null;
}

/**
 * 提取文章主题（从标题推断）
 */
function extractTopic(title) {
  // 从标题中提取主题关键词
  const topic = title
    .replace(/这\d+道|仅限春天|\d+道|绝了|这\d+道|🔥|😱|😂/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return topic.slice(0, 200);
}

/**
 * 扫描本地文章文件
 */
function scanLocalArticles() {
  const files = fs.readdirSync(ARTICLES_DIR).filter(f =>
    f.endsWith('.md') &&
    !f.includes('_cover') &&
    !f.includes('版权记录') &&
    !f.includes('SKILL') &&
    !f.includes('AI配图') &&
    !f.includes('with_cover') &&
    !f.includes('正确版') &&
    !f.includes('测试对比')
  );

  const articles = [];
  for (const file of files) {
    const filePath = path.join(ARTICLES_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const title = extractTitle(content);
    const date = extractDate(file);

    if (title && date) {
      articles.push({ title, date, topic: extractTopic(title), filename: file });
    } else {
      console.warn(`⚠️ 跳过（无法解析标题/日期）: ${file}`);
    }
  }

  // 按日期排序
  articles.sort((a, b) => a.date.localeCompare(b.date));
  return articles;
}

/**
 * 发送 HTTP 请求
 */
function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: BASE_URL,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve({ raw });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 开始补录历史选题...\n');
  const articles = scanLocalArticles();
  console.log(`📋 共扫描 ${articles.length} 篇文章\n`);

  let success = 0, skipped = 0, failed = 0;

  for (const article of articles) {
    try {
      const resp = await httpPost('/api/published/record', {
        title: article.title,
        topic: article.topic,
        draft_id: '',
        published_at: article.date,
      });

      if (resp.success) {
        if (resp.skipped) {
          console.log(`⏭️  已存在，跳过: ${article.date} - ${article.title}`);
          skipped++;
        } else {
          console.log(`✅ 录入成功: ${article.date} - ${article.title}`);
          success++;
        }
      } else {
        console.warn(`❌ 录入失败: ${article.date} - ${article.title} | ${resp.error}`);
        failed++;
      }
    } catch (e) {
      console.warn(`❌ 网络错误: ${article.date} - ${article.title} | ${e.message}`);
      failed++;
    }

    // 限速，防止请求过于密集
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n📊 汇总: 成功 ${success} | 已存在 ${skipped} | 失败 ${failed}`);
}

main().catch(console.error);
