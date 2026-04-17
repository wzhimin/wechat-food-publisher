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
  indexes: [
    { unique: true, fields: ['openid', 'recipe_id'], name: 'uk_like' },
  ],
});

module.exports = RecipeLike;
