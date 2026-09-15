# 搭话口袋 DeepSeek 后端

这是一个 Cloudflare Worker API。真实的 `DEEPSEEK_API_KEY` 只保存在托管平台的 Secret 中，不会进入网页或 GitHub 仓库。

## 接口

- `GET /health`：检查服务是否运行以及密钥是否已配置，不泄露密钥。
- `POST /api/generate`：校验场景数据、限流并调用 DeepSeek，返回结构化搭话建议。

## 配置与部署

1. 安装或临时运行 Wrangler，并登录 Cloudflare。
2. 在 `backend` 目录执行 `npx wrangler secret put DEEPSEEK_API_KEY`，按提示安全输入密钥。
3. 执行 `npx wrangler deploy`。
4. 得到 Worker 地址后，把前端请求地址改为该 Worker 的 `/api/generate`。

请勿创建包含真实密钥的 `.dev.vars` 提交；本仓库仅提供 `.dev.vars.example`。
