/**
 * 统一认证模块（唯一事实来源）
 * 所有路由的 token 验证走这里，禁止在其他 route 文件里重复 auth 逻辑
 */
const { seq } = require('../db');
let AdminToken;

async function initAdminToken() {
  if (AdminToken) return;
  try {
    AdminToken = require('../models/AdminToken');
    await AdminToken.sync();
  } catch (e) {
    AdminToken = null;
  }
}

// 先初始化（模块加载时）
initAdminToken();

const TOKENS_MAP = new Map();

/**
 * 验证 token：优先查数据库（token 持久化），表不存在时降级到内存 Map
 * @returns {Promise<{username,name}|null>}
 */
async function verifyToken(token) {
  if (!token) return null;

  if (AdminToken) {
    try {
      const record = await AdminToken.findOne({ where: { token } });
      if (!record) return null;
      if (new Date(record.expires_at) < new Date()) {
        await record.destroy();
        return null;
      }
      return { username: record.username, name: record.name };
    } catch (e) {
      if (e.original && e.original.code === 'ER_NO_SUCH_TABLE') {
        // 表不存在，降级到内存 Map
      } else {
        console.error('[verifyToken] DB 错误（非表不存在）:', e.message);
        return null;
      }
    }
  }

  // 降级：查内存 Map
  const info = TOKENS_MAP.get(token);
  if (!info) return null;
  if (Date.now() > info.expires) {
    TOKENS_MAP.delete(token);
    return null;
  }
  return info;
}

/**
 * Express 中间件：提取 token → verifyToken → 设置 req.adminUser
 */
function checkAuth(req, res, next) {
  const token = req.query.token || req.body.token || req.headers['x-admin-token'];
  verifyToken(token).then(info => {
    if (!info) return res.status(401).json({ error: '未登录或 token 已过期' });
    req.adminUser = info;
    next();
  }).catch(() => {
    res.status(401).json({ error: '未登录或 token 已过期' });
  });
}

module.exports = { verifyToken, checkAuth, TOKENS_MAP };
