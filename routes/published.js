const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PublishedArticle = require('../models/PublishedArticle');

// 管理员认证（复用 admin.js 的 TOKENS）
// 已在 index.js 中通过 require('./routes/admin') 获取 TOKENS 并导出
let _TOKENS = null;
function setTokens(tokens) { _TOKENS = tokens; }

// 内部认证函数（由 initAuth 调用）
function _verifyAdmin(req, res, next) {
  const token = req.query.token || req.body.token ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ success: false, error: '未登录' });
  if (!_TOKENS) return res.status(500).json({ success: false, error: '认证模块未初始化' });
  const info = _TOKENS.get(token);
  if (!info) return res.status(403).json({ success: false, error: '无权限' });
  if (Date.now() > info.expires) {
    _TOKENS.delete(token);
    return res.status(403).json({ success: false, error: '登录已过期，请重新登录' });
  }
  next();
}

// 从外部注入 TOKENS（由 index.js 调用）
function initAuth(TOKENS) {
  _TOKENS = TOKENS;
}

module.exports = router;
module.exports.initAuth = initAuth;
module.exports.verifyAdmin = _verifyAdmin;

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

// ============================================================
// GET /api/published/list
// 查询已发布文章列表（后台管理用）
// ============================================================
router.get('/list', _verifyAdmin, async (req, res) => {
  try {
    const articles = await PublishedArticle.findAll({
      order: [['published_at', 'DESC']],
    });
    res.json({ success: true, articles });
  } catch (e) {
    console.error('[published/list]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// GET /api/published/topics
// 查询所有已发布过的选题（用于发布前避免重复）
// 发布端 cron 任务调用，无需认证
// ============================================================
router.get('/topics', async (req, res) => {
  try {
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
router.post('/record', _verifyAdmin, async (req, res) => {
  const { title, topic, draft_id, published_at } = req.body;

  if (!title) {
    return res.json({ success: false, error: 'title 必填' });
  }

  const content = `${title}|${topic || ''}`;
  const article_md5 = crypto.createHash('md5').update(content).digest('hex');

  try {
    const existing = await PublishedArticle.findOne({ where: { article_md5 } });
    if (existing) {
      return res.json({ success: true, skipped: true, source: 'server' });
    }

    await PublishedArticle.create({
      title,
      topic: topic || '',
      draft_id: draft_id || '',
      article_md5,
      published_at: published_at ? new Date(published_at) : new Date(),
    });

    console.log(`[published] 记录成功: ${title}`);
    res.json({ success: true, skipped: false, source: 'server' });
  } catch (e) {
    console.error('[published/record]', e.message);
    try {
      const recordFile = path.join(LOCAL_ARTICLES_DIR, '版权记录.md');
      const entry = `\n## ${new Date().toLocaleDateString('zh-CN')} - ${title}\n`;
      fs.appendFileSync(recordFile, entry, 'utf-8');
    } catch (e2) { /* 忽略 */ }
    res.json({ success: false, error: e.message });
  }
});

// ============================================================
// DELETE /api/published/:id
// 删除一条记录（后台管理用）
// ============================================================
router.delete('/:id', _verifyAdmin, async (req, res) => {
  try {
    await PublishedArticle.destroy({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) {
    console.error('[published/delete]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});