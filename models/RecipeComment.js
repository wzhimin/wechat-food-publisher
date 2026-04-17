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
    field: 'recipe_id',
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
    field: 'reply_to',
    comment: '回复的评论ID',
  },
}, {
  tableName: 'recipe_comments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['recipe_id', 'created_at'], name: 'idx_recipe_time' },
  ],
});

module.exports = RecipeComment;
