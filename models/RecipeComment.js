const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const RecipeComment = sequelize.define('RecipeComment', {
  openid: {
    type: DataTypes.STRING(64),
    allowNull: false,
    comment: '评论者openid',
  },
  recipeId: {
    type: DataTypes.INTEGER,
    allowNull: false,

    comment: '菜谱ID',
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: '评论内容',
  },
  replyTo: {
    type: DataTypes.INTEGER,
    allowNull: true,

    comment: '回复的评论ID',
  },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected'),
    defaultValue: 'pending',
    comment: '审核状态',
  },
}, {
  tableName: 'recipe_comments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  // 索引通过数据库迁移或手动创建
});

module.exports = RecipeComment;
