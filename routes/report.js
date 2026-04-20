/**
 * 举报 API（小程序端）
 */

const express = require('express');
const router = express.Router();
const Report = require('../models/Report');
const Recipe = require('../models/Recipe');
const RecipeComment = require('../models/RecipeComment');
const User = require('../models/User');

// POST /api/report/add
// Body: { type: 'recipe'|'comment', target_id, reason, detail? }
router.post('/add', async (req, res) => {
  try {
    const openid = req.body.openid || req.query.openid;
    const { type, target_id, reason, detail } = req.body;

    if (!openid) {
      return res.status(400).json({ error: '缺少用户身份' });
    }

    if (!['recipe', 'comment'].includes(type)) {
      return res.status(400).json({ error: '举报类型无效' });
    }

    if (!target_id) {
      return res.status(400).json({ error: '缺少举报目标' });
    }

    if (!reason) {
      return res.status(400).json({ error: '请选择举报原因' });
    }

    // 检查目标是否存在
    if (type === 'recipe') {
      const recipe = await Recipe.findByPk(target_id);
      if (!recipe) {
        return res.status(404).json({ error: '菜谱不存在' });
      }
    } else {
      const comment = await RecipeComment.findByPk(target_id);
      if (!comment) {
        return res.status(404).json({ error: '评论不存在' });
      }
    }

    // 检查是否已经举报过
    const existing = await Report.findOne({
      where: { openid, type, target_id },
    });

    if (existing) {
      return res.status(400).json({ error: '您已举报过该内容' });
    }

    // 创建举报记录
    const report = await Report.create({
      openid,
      type,
      target_id,
      reason,
      detail: detail || '',
      status: 'pending',
    });

    res.json({ success: true, data: { reportId: report.id } });
  } catch (err) {
    console.error('[/api/report/add]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
