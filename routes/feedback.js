const express = require('express');
const router = express.Router();
const Feedback = require('../models/Feedback');

// POST /api/feedback/add
router.post('/add', async (req, res) => {
  try {
    const { openid, type, content, contact } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: '请输入反馈内容' });
    }

    const feedback = await Feedback.create({
      openid: openid || null,
      type: ['bug', 'suggest', 'other'].includes(type) ? type : 'suggest',
      content: content.trim(),
      contact: contact ? contact.trim() : '',
    });

    res.json({ success: true, data: feedback });
  } catch (err) {
    console.error('[/api/feedback/add]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/feedback/list?openid=xxx
router.get('/list', async (req, res) => {
  try {
    const openid = req.query.openid || req.body.openid;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const list = await Feedback.findAll({
      where: { openid },
      order: [['created_at', 'DESC']],
      attributes: ['id', 'type', 'content', 'contact', 'status', 'created_at'],
    });

    res.json({ success: true, data: list });
  } catch (err) {
    console.error('[/api/feedback/list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
