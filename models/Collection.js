const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const Collection = sequelize.define('Collection', {
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
  tableName: 'collections',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { unique: true, fields: ['openid', 'recipeId'] },
  ],
});

module.exports = Collection;
