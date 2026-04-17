const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const User = sequelize.define('User', {
  openid: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true,
    comment: '微信openId',
  },
  nickName: {
    type: DataTypes.STRING(64),

    comment: '昵称',
  },
  avatarUrl: {
    type: DataTypes.STRING(512),

    comment: '头像URL',
  },
  followCount: {
    type: DataTypes.INTEGER,

    defaultValue: 0,
    comment: '关注数',
  },
  fansCount: {
    type: DataTypes.INTEGER,

    defaultValue: 0,
    comment: '粉丝数',
  },
  likeCount: {
    type: DataTypes.INTEGER,

    defaultValue: 0,
    comment: '获赞数',
  },
}, {
  tableName: 'users',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = User;
