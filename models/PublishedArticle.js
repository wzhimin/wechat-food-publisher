const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const PublishedArticle = sequelize.define('PublishedArticle', {
  title: {
    type: DataTypes.STRING(256),
    allowNull: false,
    comment: '文章标题',
  },
  topic: {
    type: DataTypes.STRING(512),
    comment: '文章主题/选题描述，如"8道春季养生汤"',
  },
  draft_id: {
    type: DataTypes.STRING(64),
    comment: '公众号草稿 MediaId',
  },
  article_md5: {
    type: DataTypes.STRING(32),
    comment: '文章内容MD5，用于去重',
  },
  published_at: {
    type: DataTypes.DATE,
    comment: '发布时间',
  },
}, {
  tableName: 'published_articles',
  comment: '公众号已发布文章历史记录',
  timestamps: true,
});

module.exports = PublishedArticle;
