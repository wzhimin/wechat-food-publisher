const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const Recipe = sequelize.define('Recipe', {
  title: {
    type: DataTypes.STRING(128),
    allowNull: false,
    comment: '菜名',
  },
  cover: {
    type: DataTypes.STRING(512),
    comment: '封面图URL',
  },
  difficulty: {
    type: DataTypes.TINYINT,
    defaultValue: 2,
    comment: '难度 1-3',
  },
  duration: {
    type: DataTypes.STRING(32),
    comment: '烹饪时长，如"30分钟"',
  },
  tags: {
    type: DataTypes.STRING(256),
    comment: '标签，逗号分隔：下饭菜,家常菜',
  },
  season: {
    type: DataTypes.STRING(64),
    comment: '时令：春季,清明',
  },
  ingredients: {
    type: DataTypes.TEXT,
    comment: '食材JSON数组：["五花肉500g","冰糖30g"]',
  },
  steps: {
    type: DataTypes.TEXT,
    comment: '步骤JSON数组：["第1步...","第2步..."]',
  },
  tips: {
    type: DataTypes.TEXT,
    comment: '小贴士',
  },
  articleId: {
    type: DataTypes.STRING(64),
    field: 'article_id',
    comment: '公众号文章素材ID',
  },
  publishedAt: {
    type: DataTypes.DATE,
    field: 'published_at',
    comment: '公众号发布时间',
  },
  authorOpenid: {
    type: DataTypes.STRING(64),
    field: 'author_openid',
    defaultValue: 'system',
    comment: '发布者openid，system表示系统导入',
  },
  likeCount: {
    type: DataTypes.INTEGER,
    field: 'like_count',
    defaultValue: 0,
    comment: '点赞数',
  },
  commentCount: {
    type: DataTypes.INTEGER,
    field: 'comment_count',
    defaultValue: 0,
    comment: '评论数',
  },
  viewCount: {
    type: DataTypes.INTEGER,
    field: 'view_count',
    defaultValue: 0,
    comment: '浏览数',
  },
}, {
  tableName: 'recipes',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Recipe;
