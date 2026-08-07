# TwitCanva Video Workflow

TwitCanva Video Workflow 是一个基于节点画布的 AI 图片与视频生成应用。用户可以在画布中创建图片节点、视频节点和故事板节点，通过节点连接组织参考图、参考视频、提示词和生成结果，形成可迭代的视觉创作工作流。

项目由 React + Vite 前端和 Express 后端组成，生成能力主要接入火山引擎 Ark，包括 Seed Evolving、Seedream 5.0 Pro 和 Seedance（2.5 / 2.0 系列）。生成素材和工作流数据默认保存在本地 `library/` 目录；配置火山引擎 TOS 后，生成视频可以同步上传到对象存储，并在后续视频参考生成中使用公网 URL。

## 功能概览

- 节点式画布：支持图片、视频、故事板等节点的创建、连接、拖拽和编排。
- 右侧 Chat：支持文字对话，也支持拖入画布中的图片或视频作为上下文。
- 图片生成：支持 Seedream 5.0 Pro 文生图、单图参考生图、多图参考生图。
- 交互式图片编辑：支持基于原图的标记编辑和坐标编辑，生成结果会创建为新的图片节点。
- 视频生成：支持 Seedance 2.5 / 2.0 文生视频、参考图视频、参考视频视频，以及图像和视频混合参考。
- 参考顺序控制：图片和视频参考可以在前端手动排序，适合提示词中使用“图 1 / 图 2”这类描述。
- Ark 素材库引用：Seedance 节点支持手动填写火山 Ark 素材库 asset ID。
- Storyboard Generator：支持故事构思、分镜脚本、合成分镜图和批量分镜视频生成。
- 本地素材库：支持保存和复用本地图片、视频、工作流、聊天记录和素材资产。

## 模型与服务

| 能力 | 模型或服务 | 说明 |
| --- | --- | --- |
| Chat 与多模态理解 | `doubao-seed-evolving` | 右侧 Chat、图片/视频理解、提示词辅助 |
| Storyboard 文本生成 | `doubao-seed-evolving` | 故事构思、分镜脚本、故事优化 |
| 图片生成 | `doubao-seedream-5-0-pro-260628` | 文生图、图生图、多图参考生图 |
| 交互式图片编辑 | Seedream 5.0 Pro | 标记编辑、坐标编辑 |
| 视频生成 | Seedance 2.5 (`doubao-seedance-2-5-260628`) / 2.0 系列 | 文生视频、参考图/视频生成视频 |
| 视频存储与公网引用 | 火山引擎 TOS | 生成视频上传、公开 URL 记录 |

Ark API 默认使用北京区域：

```text
https://ark.cn-beijing.volces.com/api/v3
```

## 项目结构

```text
.
├── src/                         # React + TypeScript 前端
│   ├── App.tsx                  # 画布状态、节点编排、弹窗入口
│   ├── components/              # 画布、节点控制、Chat、弹窗组件
│   ├── hooks/                   # 生成流程、工作流、面板状态
│   └── services/                # 前端 API 调用封装
├── server/                      # Express 后端
│   ├── index.js                 # 服务入口和通用 API
│   ├── routes/                  # 生成、Storyboard、本地模型等路由
│   ├── services/                # Ark、Seedance、TOS、第三方服务封装
│   └── agent/                   # Chat Agent 和系统提示词
├── library/                     # 本地图片、视频、素材、聊天和工作流数据
├── seedream-draw-studio-demo/   # Seedream 交互编辑参考代码
├── start-dev.sh                 # 本地一键启动脚本
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 环境要求

- Node.js 20 或更高版本。
- npm。
- 火山引擎 Ark API Key，并确保账号具备所需模型调用权限。
- 可选：火山引擎 TOS AK/SK，用于将本地视频上传为公网 URL。

## 环境变量

在项目根目录创建 `.env` 文件，并填写运行所需配置：

```env
ARK_API_KEY=your_ark_api_key

TOS_ACCESS_KEY_ID=your_tos_access_key_id
TOS_SECRET_ACCESS_KEY=your_tos_secret_access_key
TOS_REGION=cn-shanghai
TOS_ENDPOINT=tos-cn-shanghai.volces.com
TOS_BUCKET=your_bucket_name
TOS_VIDEO_PREFIX=twitcanva/video
TOS_PUBLIC_BASE_URL=https://your_bucket_name.tos-cn-shanghai.volces.com
```

说明：

- `ARK_API_KEY` 用于 Seed Evolving、Seedream 和 Seedance 调用。
- TOS 配置用于生成视频上传和视频参考复用。
- 未配置 TOS 时，视频仍会保存到本地，但后续作为 Seedance 视频参考时可能缺少公网 URL。
- 启动日志中出现 Gemini、Kling、Hailuo、OpenAI、Fal 等旧模型的 key warning，不影响 Ark 主流程。

## 本地启动

安装依赖：

```bash
npm install
```

启动前端和后端：

```bash
./start-dev.sh
```

等价命令：

```bash
npm run dev
```

默认地址：

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

## 云服务器运行

开发模式下，Vite 默认只暴露本机访问。如果要在云服务器上通过公网 IP 访问前端，需要让 Vite 监听外部网卡：

```bash
npm run dev -- --host 0.0.0.0
```

或者将 `package.json` 中的 `dev` 命令调整为：

```json
{
  "scripts": {
    "dev": "concurrently \"npm run server\" \"vite --host 0.0.0.0\""
  }
}
```

访问时使用：

```text
http://服务器公网IP:5173/
```

如果仍无法访问，检查云厂商安全组和服务器防火墙是否放行 `5173` 端口。

## Docker 启动

构建并启动：

```bash
docker compose up -d --build
```

停止：

```bash
docker compose down
```

Compose 会挂载本地数据目录：

```text
./library:/app/library
```

因此容器重启后，生成的图片、视频、工作流和素材数据会保留在宿主机的 `library/` 目录中。

## 使用说明

1. 打开前端页面。
2. 在画布中创建图片节点、视频节点或 Storyboard。
3. 图片节点选择 Seedream 5.0 Pro，视频节点选择 Seedance 2.5 或 2.0 系列。
4. 将图片或视频节点连接到后续节点，即可作为参考输入。
5. 如提示词中使用“图 1 / 图 2”，在节点控制面板中调整参考顺序。
6. 如需引用火山 Ark 素材库素材，在 Seedance 节点中填写 asset ID。
7. 生成结果会保存到 `library/images/` 或 `library/videos/`。

## Storyboard

Storyboard Generator 支持以下流程：

- 根据故事想法和参考图生成故事梗概。
- 生成分镜脚本，包含画面描述、镜头、运动、光线和氛围。
- 使用 Seedream 生成合成分镜图。
- 将合成分镜拆成图片节点。
- 批量生成分镜视频。

分镜视频生成选择 Seedance 2.5 或 2.0 时，会把当前分镜图作为主要参考图，并可结合其他分镜图保持角色、场景和风格一致。

## Seedream 图片生成与编辑

Seedream 5.0 Pro 支持：

- 文生图。
- 单图参考生图。
- 多图参考生图。
- 参考图顺序调整。
- 打开交互式编辑弹窗进行局部编辑。

交互式编辑生成时会创建新的图片节点，不会覆盖原图节点。关闭编辑弹窗只关闭界面，不会取消已经提交的后台生成任务。

## Seedance 视频生成

Seedance 2.5 / 2.0 支持：

- 文生视频。
- 图片参考生成视频。
- 视频参考生成视频。
- 图片和视频混合参考。
- Ark asset ID 引用。
- 参考输入顺序调整。
- 原生音频、镜头固定、水印开关。
- 自定义随机种子（Seed），留空表示随机。

不同版本的可选参数范围：

| 参数 | Seedance 2.5 | Seedance 2.0 系列 |
| --- | --- | --- |
| 模型 ID | `doubao-seedance-2-5-260628` | `doubao-seedance-2-0-260128` 等 |
| 分辨率 | `Auto`、`480p`、`720p` | `Auto`、`720p`、`1080p` |
| 时长 | `Auto`（-1 自动）或 4~30 秒 | `Auto` 或 4~15 秒 |
| 画面比例 | `16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`21:9`、`adaptive` | `16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`21:9` |
| 参考图数量 | 最多 30 张 | 最多 9 张 |
| 输出格式 | `mp4` / `mov` | `mp4` |

在视频节点的 Advanced Settings 中，可以调整音频、镜头固定、水印、随机种子；选择 Seedance 2.5 时还可以选择输出格式。分辨率、画面比例、时长在节点控制面板顶部选择。

视频参考需要公网可访问 URL。配置 TOS 后，本地生成视频会上传到 TOS，并在后续作为 Seedance 参考视频时优先使用 TOS 公网 URL。

## 本地数据目录

```text
library/images/      # 生成或上传的图片
library/videos/      # 生成视频和视频元数据
library/assets/      # 本地素材库
library/chats/       # Chat 会话
library/workflows/   # 保存的工作流
```

## 常见问题

### `ARK_API_KEY not configured`

检查 `.env` 中是否填写了 `ARK_API_KEY`。修改 `.env` 后需要重启后端。

### 终端打印启动日志后不继续输出

这是正常现象。`npm run dev` 会启动常驻开发服务，终端会停留在运行状态并等待前端页面请求或后端 API 请求。

### 云服务器访问 `5173` 没响应

确认 Vite 是否使用了 `--host 0.0.0.0`，并检查安全组或防火墙是否放行 `5173`。

### 本地视频作为 Seedance 参考时报错

Seedance 视频参考需要公网 URL。检查 TOS 配置是否完整，确认视频是否已经上传并写入 `tosPublicUrl`。

### TOS URL 一直显示 resolving

检查 TOS AK/SK、bucket、endpoint、public base URL 是否正确，并确认后端有权限读取本地视频和写入元数据 JSON。
