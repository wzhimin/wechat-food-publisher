const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const BrowseHistory = sequelize.define('BrowseHistory', {
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
  viewedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    comment: '浏览时间',
  },
}, {
  tableName: 'browse_history',
  timestamps: false,
  updatedAt: false,
  indexes: [
    { fields: ['openid', 'viewedAt'], name: 'idx_openid_time' },
    { fields: ['openid', 'recipeId'], name: 'idx_openid_recipe' },
  ],
});

module.exports = BrowseHistory;
