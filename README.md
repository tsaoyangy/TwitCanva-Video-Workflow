# TwitCanva Video Workflow

这是一个基于节点画布的 AI 图片与视频生成工作流应用。当前版本已经按本项目的实际调用链路改造为火山引擎 Ark 工作流，主要使用 Seed 2.1、Seedream 5.0 Pro、Seedance 2.0 和火山引擎 TOS。

当前应用使用火山引擎 Ark 北京区域接口完成对话、图片生成、故事板文本生成和视频生成。Seedance 生成的视频会保存到本地；配置 TOS 后，视频也会上传到上海区域 TOS，并记录公开 URL，后续作为 Seedance 视频参考输入时优先使用这个公网 URL。

## 当前有效调用

| 能力 | 当前模型 / 服务 | 后端入口 |
| --- | --- | --- |
| 右侧对话与多模态理解 | Seed 2.1 / Seed Evolving | `POST /api/chat` |
| Storyboard 文本生成 | Seed 2.1 / Seed Evolving | `server/routes/storyboard.js` |
| 文生图 | Seedream 5.0 Pro | `POST /api/generate-image` |
| 单图 / 多图参考生图 | Seedream 5.0 Pro | `POST /api/generate-image` |
| 交互式图片编辑 | Seedream 5.0 Pro，支持标记编辑和坐标编辑 | `POST /api/seedream-edit` |
| 文生视频 / 参考图视频 / 参考视频生成 | Seedance 2.0 系列 | `POST /api/generate-video` |
| 本地视频 TOS 公网 URL 解析 | 火山引擎 TOS 上传与元数据记录 | `GET /api/videos/tos-url` |

Ark API 地址：

```text
https://ark.cn-beijing.volces.com/api/v3
```

## 主要功能

- 节点式画布，支持图片和视频工作流编排。
- 右侧 Chat 使用 Seed 2.1，并支持拖入画布中的图片 / 视频素材作为上下文。
- Seedream 5.0 Pro 支持文生图、单图参考生图、多图参考生图。
- Seedream 交互式编辑支持标记模式和坐标模式。
- Seedream 编辑生成时会立即创建一个新的 loading 图片节点，原图节点会保留。
- Seedance 2.0 支持文生视频、图片参考、视频参考、图片和视频混合参考。
- Seedance 参考输入支持前端手动排序，适合提示词中使用“图 1 / 图 2”这类描述。
- Seedance 支持手动输入火山 Ark 素材库 asset ID。
- Seedance 时长支持 `Auto`、`5`、`6`、`8`、`10`、`12`、`15` 秒。
- 本地生成视频可上传到 TOS，后续作为视频参考时使用公网 URL。
- Storyboard Generator 已改为 Seed 2.1 生成文本，Seedream 5.0 Pro 生成合成图。
- 本地素材、聊天和工作流数据保存在 `library/` 目录。

## 项目结构

```text
.
├── src/                         # React + TypeScript 前端
│   ├── App.tsx                  # 画布状态与弹窗编排
│   ├── components/              # 画布、节点控制、Chat、弹窗
│   ├── hooks/                   # 生成逻辑与面板状态
│   └── services/                # 前端 API 调用封装
├── server/                      # Express 后端
│   ├── index.js                 # 应用入口和通用路由
│   ├── routes/                  # 生成与 Storyboard 路由
│   └── services/                # Ark、Seedance、TOS 服务封装
├── library/                     # 本地图片、视频、素材、聊天、工作流数据
├── seedream-draw-studio-demo/   # Seedream 编辑能力参考项目，不是当前运行入口
├── start-dev.sh                 # 本地一键启动脚本
├── Dockerfile
└── docker-compose.yml
```

## 环境要求

- 推荐 Node.js 20+。
- npm。
- 火山引擎 Ark API Key，需要具备 Seed 2.1、Seedream 5.0 Pro、Seedance 2.0 系列模型调用权限。
- 可选但推荐：火山引擎 TOS AK/SK，用于把本地生成视频上传为公网 URL，方便后续作为 Seedance 视频参考输入。

## 环境变量

在项目根目录创建 `.env` 文件：

```env
# 当前 Ark 模型调用必需
ARK_API_KEY=your_ark_api_key

# 可选但推荐：用于 Seedance 视频参考复用
TOS_ACCESS_KEY_ID=your_tos_access_key_id
TOS_SECRET_ACCESS_KEY=your_tos_secret_access_key
TOS_REGION=cn-shanghai
TOS_ENDPOINT=tos-cn-shanghai.volces.com
TOS_BUCKET=arkclaw--tsaoyang
TOS_VIDEO_PREFIX=twitcanva/video
TOS_PUBLIC_BASE_URL=https://arkclaw--tsaoyang.tos-cn-shanghai.volces.com
```

说明：

- `.env` 已被 Git 忽略，不应提交真实密钥。
- 当前主调用链路主要依赖 `ARK_API_KEY`，视频参考复用依赖 TOS 配置。
- 原项目中可能仍保留 Gemini、Kling、Hailuo、OpenAI、Fal、X、TikTok 等旧变量或旧代码路径，但当前核心工作流不依赖这些变量。
- 本项目当前约定是保留并提交 `library/` 中的本地素材；如后续不想提交素材，可再调整 `.gitignore`。

## 本地启动

安装依赖：

```bash
npm install
```

一键启动前端和后端：

```bash
./start-dev.sh
```

等价 npm 命令：

```bash
npm run dev
```

默认访问地址：

```text
前端：http://localhost:5173
后端：http://localhost:3001
```

只启动后端：

```bash
npm run server
```

构建前端：

```bash
npm run build
```

## Docker 启动

构建并启动容器：

```bash
docker compose up -d --build
```

访问地址：

```text
http://localhost:3001
```

停止容器：

```bash
docker compose down
```

注意：当前 `docker-compose.yml` 仍保留了一些原项目的旧模型服务环境变量。使用当前火山引擎工作流时，请确保容器至少能拿到以下变量：

```env
ARK_API_KEY=...
TOS_ACCESS_KEY_ID=...
TOS_SECRET_ACCESS_KEY=...
TOS_REGION=cn-shanghai
TOS_ENDPOINT=tos-cn-shanghai.volces.com
TOS_BUCKET=arkclaw--tsaoyang
TOS_VIDEO_PREFIX=twitcanva/video
TOS_PUBLIC_BASE_URL=https://arkclaw--tsaoyang.tos-cn-shanghai.volces.com
```

Compose 会挂载本地素材目录：

```text
./library:/app/library
```

因此容器重启后，本地生成的图片、视频、工作流等数据仍会保留。

## 画布使用说明

1. 打开应用。
2. 在画布中创建图片节点或视频节点。
3. 图片节点选择 Seedream 5.0 Pro，视频节点选择 Seedance 2.0 系列。
4. 将图片或视频节点连接到后续节点，即可作为参考输入。
5. 如果 Seedance 提示词中包含“图 1”“图 2”等顺序描述，需要在节点控制面板里调整参考输入顺序。
6. 如果要引用火山 Ark 素材库中的素材，直接在 Seedance 节点里填写 asset ID；后端会自动按 `asset://...` 形式处理。

## Seedream 图片生成与编辑

Seedream 5.0 Pro 当前支持：

- 文生图。
- 单图参考生图。
- 多图参考生图，最多使用 10 张连接进来的图片参考。
- 参考图顺序调整，适合提示词中使用“图 1 / 图 2”。
- 从 Seedream 图片节点打开交互式编辑弹窗。

交互式编辑逻辑：

- 点击生成后，会立即在画布上创建一个新的 loading 图片节点。
- 关闭编辑弹窗只会关闭页面，不会取消后台生成任务。
- 生成成功后，新节点会更新为成功状态并展示结果图。
- 生成失败后，新节点会更新为错误状态并展示错误信息。
- 原图节点不会被覆盖，便于对比和回退。

## Seedance 视频生成

Seedance 2.0 当前支持：

- 文生视频。
- 图片参考生成视频。
- 视频参考生成视频。
- 图片和视频混合参考生成视频。
- 引用火山 Ark 素材库 asset ID。
- 前端手动调整参考输入顺序。
- 分辨率支持 `Auto`、`720p`、`1080p`。
- 时长支持 `Auto` 或最高 15 秒的显式时长。

视频参考注意事项：

- Ark Seedance 的视频参考输入需要公网可访问 URL。
- 本地生成视频会先保存在 `library/videos/`。
- 配置 TOS 后，本地视频会上传到 TOS，并把 `tosPublicUrl` 写入视频元数据。
- 后续该视频作为 Seedance 参考输入时，会优先使用 `tosPublicUrl`。

## 本地数据目录

应用本地数据保存在 `library/`：

```text
library/images/      # 生成或上传的图片
library/videos/      # 生成视频和视频元数据
library/assets/      # 应用内本地素材库
library/chats/       # Chat 会话
library/workflows/   # 保存的工作流
```

## Git 与密钥

当前仓库可以提交代码和 `library/` 中的本地素材，但不要提交真实密钥。

必须保持忽略：

```text
.env
```

不要把 Ark API Key、TOS AK/SK 或其他私密凭证写入代码或 README。

## 常见问题

`ARK_API_KEY not configured`

- 检查 `.env` 是否配置了 `ARK_API_KEY`。
- 修改 `.env` 后需要重启后端。

本地视频作为 Seedance 参考时报错

- 检查 TOS 相关环境变量是否完整。
- 确认本地视频文件存在于 `library/videos/`。
- 确认该视频元数据里已经写入 `tosPublicUrl`。
- Seedance 视频参考应使用 TOS 公网 URL，而不是本地路径。

TOS URL 一直显示 resolving

- 检查 TOS AK/SK、bucket、endpoint、public base URL 是否正确。
- 检查后端是否有权限读取本地视频并写入元数据 JSON。
- 检查 TOS bucket 中目标文件是否能通过公网 URL 访问。

GitHub 大文件警告

- GitHub 对超过 50 MB 的文件会给出警告。
- 低于 100 MB 的文件仍可推送，但后续大量视频素材建议使用 Git LFS 或外部对象存储。
