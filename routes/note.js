const express = require('express');
const router = express.Router();
const RecipeNote = require('../models/RecipeNote');

// GET /api/note/list?openid=xxx
router.get('/list', async (req, res) => {
  try {
    const openid = req.query.openid || req.body.openid;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const list = await RecipeNote.findAll({
      where: { openid },
      order: [['created_at', 'DESC']],
    });
    res.json({ success: true, data: list });
  } catch (err) {
    console.error('[/api/note/list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/note/add
router.post('/add', async (req, res) => {
  try {
    const { openid, title, content, coverUrl, tags } = req.body;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });
    if (!content || !content.trim()) return res.status(400).json({ error: '请输入笔记内容' });

    const note = await RecipeNote.create({
      openid,
      title: title ? title.trim() : '',
      content: content.trim(),
      coverUrl: coverUrl || '',
      tags: tags || '',
    });
    res.json({ success: true, data: note });
  } catch (err) {
    console.error('[/api/note/add]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/note/update/:id
router.put('/update/:id', async (req, res) => {
  try {
    const { openid, title, content, coverUrl, tags } = req.body;
    const { id } = req.params;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const note = await RecipeNote.findOne({ where: { id, openid } });
    if (!note) return res.status(404).json({ error: '笔记不存在' });

    const updates = {};
    if (title !== undefined) updates.title = title.trim();
    if (content !== undefined) updates.content = content.trim();
    if (coverUrl !== undefined) updates.coverUrl = coverUrl;
    if (tags !== undefined) updates.tags = tags;

    await note.update(updates);
    res.json({ success: true, data: note });
  } catch (err) {
    console.error('[/api/note/update]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/note/delete/:id
router.delete('/delete/:id', async (req, res) => {
  try {
    const { openid } = req.body;
    const { id } = req.params;
    if (!openid) return res.status(400).json({ error: '缺少 openid' });

    const note = await RecipeNote.findOne({ where: { id, openid } });
    if (!note) return res.status(404).json({ error: '笔记不存在' });

    await note.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('[/api/note/delete]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
