const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const Collection = sequelize.define('Collection', {
  openid: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: '用户openid（可选，不传时表示无用户收藏）',
  },
  recipeId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '菜谱ID',
  },
}, {
  tableName: 'collections',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = Collection;
