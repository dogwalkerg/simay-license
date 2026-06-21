# OSCAR Auth Code Manager - Vercel Edition

Cloudflare Workers KV 风格授权码管理系统，部署在 Vercel，使用 `@vercel/kv` 存储。

## 功能

- 管理后台（内嵌 HTML/CSS/JS）
- 创建/删除/批量/搜索/分页授权码
- 授权码验证 API（客户端调用）
- 在线状态追踪
- 检查间隔配置
- 5分钟无操作自动退出

## 部署步骤

### 1. 创建 KV 数据库

**方案 A（推荐 — Vercel Pro 自带 KV）：**
- 在 Vercel Dashboard 打开 Storage → Create → KV Database
- 记下生成的 `KV_URL` 等环境变量

**方案 B（免费 — 使用 Upstash Redis）：**
- 打开 https://console.upstash.com/
- 创建 Redis 数据库（免费版够用）
- 拿到 REST API URL 和 Token

### 2. 部署到 Vercel

1. 把此目录上传到 GitHub 仓库
2. 在 https://vercel.com 导入该仓库
3. 部署时添加环境变量：
   - `KV_URL`（或 `KV_REST_API_URL` + `KV_REST_API_TOKEN`）
   - `MASTER_KEY`（可选，默认 admin123）
4. 部署完成后，访问 `https://你的域名/?token=ko30re.916919.xyz`

### 3. 使用

- 打开管理后台，点击页面中的 `[Click to enter MasterKey]`
- 输入 MASTER_KEY（默认 admin123）
- 开始管理授权码

## API 文档

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api?action=validate | 验证授权码（无需认证） |
| POST | /api?action=logout | 标记离线（无需认证） |
| GET | /api?action=health | 健康检查 |
| GET | /api?action=list | 列出全部（需 X-Master-Key） |
| POST | /api?action=create | 创建/更新（需 X-Master-Key） |
| POST | /api?action=delete | 删除（需 X-Master-Key） |
| POST | /api?action=batch | 批量创建（需 X-Master-Key） |
| GET | /api?action=getConfig | 获取配置 |
| POST | /api?action=setConfig | 设置配置 |

### 调用示例

```bash
# 验证授权码
curl -X POST "https://your-domain/api?action=validate" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"OSCAR-xxxxxxxxxxxx\"}"

# 创建授权码（管理操作）
curl -X POST "https://your-domain/api?action=create" \
  -H "Content-Type: application/json" \
  -H "X-Master-Key: admin123" \
  -d "{\"code\":\"OSCAR-xxx\",\"expiresAt\":\"2027-12-31 23:59:59\"}"
```
