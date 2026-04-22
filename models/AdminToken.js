const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const AdminToken = sequelize.define('AdminToken', {
  token: {
    type: DataTypes.STRING(80),
    allowNull: false,
    unique: true,
    comment: '管理员登录 token',
  },
  username: {
    type: DataTypes.STRING(64),
    allowNull: false,
    comment: '管理员账号',
  },
  name: {
    type: DataTypes.STRING(64),
    comment: '管理员姓名',
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: 'token 过期时间',
  },
}, {
  tableName: 'admin_tokens',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = AdminToken;
