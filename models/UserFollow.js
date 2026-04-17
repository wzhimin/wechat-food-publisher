const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const UserFollow = sequelize.define('UserFollow', {
  followerOpenid: {
    type: DataTypes.STRING(64),
    allowNull: false,
    comment: '关注者openid',
  },
  followingOpenid: {
    type: DataTypes.STRING(64),
    allowNull: false,
    comment: '被关注者openid',
  },
}, {
  tableName: 'user_follows',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = UserFollow;