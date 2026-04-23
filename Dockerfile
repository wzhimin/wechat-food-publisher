# 基于 alpine:3.13，手动安装 Node.js 18
# (旧方案，经过生产验证，微信登录正常)
FROM alpine:3.13

# 容器默认时区为UTC，如需使用上海时间请启用以下时区设置命令
# RUN apk add tzdata && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && echo Asia/Shanghai > /etc/timezone

# 安装 CA 证书（HTTPS 请求必须，解决容器内微信 API 调用失败）
RUN apk add --update --no-cache ca-certificates && update-ca-certificates

# 安装 Node.js 18.20.4 LTS（sharp 要求 >=18.17.0）
RUN apk add --update --no-cache curl && \
    curl -fsSL https://unofficial-builds.nodejs.org/download/release/v18.20.4/node-v18.20.4-linux-x64-musl.tar.gz | tar -xz -C /usr/local --strip-components=1 && \
    npm install -g npm

# 指定工作目录
WORKDIR /app

# 拷贝包管理文件
COPY package*.json /app/

# npm 源，选用国内镜像源以提高下载速度
RUN npm config set registry https://mirrors.cloud.tencent.com/npm/
# RUN npm config set registry https://registry.npm.taobao.org/

# npm 安装依赖
RUN npm install

COPY . /app

# 执行启动命令
# 写多行独立的CMD命令是错误写法！只有最后一行CMD命令会被执行，之前的都会被忽略，导致业务报错。
# 请参考[Docker官方文档之CMD命令](https://docs.docker.com/engine/reference/builder/#cmd)
CMD ["npm", "start"]
