const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const RecipeNote = sequelize.define('RecipeNote', {
  openid: {
    type: DataTypes.STRING(64),
    allowNull: false,
    comment: '用户openid',
  },
  title: {
    type: DataTypes.STRING(128),
    defaultValue: '',
    comment: '笔记标题',
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: '笔记正文',
  },
  coverUrl: {
    type: DataTypes.STRING(512),

    defaultValue: '',
    comment: '封面图URL',
  },
  tags: {
    type: DataTypes.STRING(256),
    defaultValue: '',
    comment: '标签，逗号分隔',
  },
}, {
  tableName: 'recipe_notes',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['openid', 'created_at'], name: 'idx_openid_time' },
  ],
});

module.exports = RecipeNote;
