const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PublishedArticle = require('../models/PublishedArticle');

// 腾讯云托管上的接口地址（开放接口服务，无需 token）
const BASE_URL = 'https://express-yi42-246142-8-1421971309.sh.run.tcloudbase.com';

// 本地历史文章目录（降级用）
const LOCAL_ARTICLES_DIR = path.resolve(
  process.env.HOME,
  'Desktop/wzmmaven/weikou/articles'
);

/**
 * 从服务器查询已发布选题（优先）
 * @returns {string[]} 已发布过的标题列表
 */
async function fetchServerTopics() {
  try {
    const res = require('axios').get(`${BASE_URL}/api/published/topics`, { timeout: 8000 });
    const data = (await res).data;
    if (Array.isArray(data.topics)) {
      console.log(`[published] 服务器获取选题成功，共 ${data.topics.length} 条`);
      return data.topics;
    }
  } catch (e) {
    console.warn(`[published] 服务器查询失败，降级本地: ${e.message}`);
  }
  return null;
}

/**
 * 从本地目录扫描历史选题（降级方案）
 * @returns {string[]} 已发布过的标题列表
 */
async function fetchLocalTopics() {
  const topics = [];
  try {
    const files = (fs.readdirSync(LOCAL_ARTICLES_DIR) || [])
      .filter(f => f.endsWith('.md') && !f.includes('_cover') && !f.includes('版权记录'));

    for (const file of files) {
      const content = fs.readFileSync(path.join(LOCAL_ARTICLES_DIR, file), 'utf-8');
      // 提取 front matter 中的 title
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (match) {
        const fm = match[1];
        const titleMatch = fm.match(/title:\s*["']?(.*?)["']?\s*$/m);
        if (titleMatch) {
          topics.push(titleMatch[1].trim());
        }
      }
    }
    console.log(`[published] 本地扫描选题成功，共 ${topics.length} 条`);
  } catch (e) {
    console.warn(`[published] 本地扫描失败: ${e.message}`);
  }
  return topics;
}

/**
 * 合并服务器 + 本地选题，去重返回
 */
async function getAllTopics() {
  const [serverTopics, localTopics] = await Promise.all([
    fetchServerTopics(),
    fetchLocalTopics(),
  ]);

  const map = new Map();
  if (serverTopics) {
    serverTopics.forEach(t => map.set(t, 'server'));
  }
  if (localTopics) {
    localTopics.forEach(t => map.set(t, 'local'));
  }
  return map;
}

// ============================================================
// GET /api/published/topics
// 查询所有已发布过的选题（用于发布前避免重复）
// ============================================================
router.get('/topics', async (req, res) => {
  try {
    // 先查服务器，失败降级本地
    const serverTopics = await fetchServerTopics();
    const topics = serverTopics || await fetchLocalTopics();
    res.json({ success: true, topics: topics || [], source: serverTopics ? 'server' : 'local' });
  } catch (e) {
    console.error('[published/topics]', e.message);
    res.json({ success: false, topics: [], source: 'error' });
  }
});

// ============================================================
// POST /api/published/record
// 记录一篇已发布的文章（发布成功后调用）
// ============================================================
router.post('/record', async (req, res) => {
  const { title, topic, draft_id } = req.body;

  if (!title) {
    return res.json({ success: false, error: 'title 必填' });
  }

  // 计算内容 MD5（用标题+主题作为 proxy）
  const content = `${title}|${topic || ''}`;
  const article_md5 = crypto.createHash('md5').update(content).digest('hex');

  try {
    // 先尝试在服务器上查重
    const existing = await PublishedArticle.findOne({ where: { article_md5 } });
    if (existing) {
      console.log(`[published] 选题已存在，跳过记录: ${title}`);
      return res.json({ success: true, skipped: true, source: 'server' });
    }

    // 写入本地数据库
    await PublishedArticle.create({
      title,
      topic: topic || '',
      draft_id: draft_id || '',
      article_md5,
      published_at: new Date(),
    });

    console.log(`[published] 记录成功: ${title}`);
    res.json({ success: true, skipped: false, source: 'server' });
  } catch (e) {
    console.error('[published/record]', e.message);
    // 数据库写入失败时只记录到本地文件，不阻塞发布流程
    try {
      const recordFile = path.join(LOCAL_ARTICLES_DIR, '版权记录.md');
      const entry = `\n## ${new Date().toLocaleDateString('zh-CN')} - ${title}\n`;
      fs.appendFileSync(recordFile, entry, 'utf-8');
    } catch (e2) { /* 忽略 */ }
    res.json({ success: false, error: e.message });
  }
});

module.exports = router;
