const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const RecipeLike = sequelize.define('RecipeLike', {
  openid: {
    type: DataTypes.STRING(64),
    allowNull: false,
    comment: '用户openid',
  },
  recipeId: {
    type: DataTypes.INTEGER,
    allowNull: false,

    comment: '菜谱ID',
  },
}, {
  tableName: 'recipe_likes',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  // 唯一索引通过数据库迁移创建，避免 alter safe 时字段不存在报错
});

module.exports = RecipeLike;
