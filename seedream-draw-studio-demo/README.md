# Seedream50Pro Demo

基于 Seedream 5.0 Pro 的图片交互编辑演示。同一套服务端代码可以通过环境变量选择国内火山方舟或海外 BytePlus ModelArk，API Key 不会下发到浏览器。

官方资料：

- [图片生成 API 参数说明](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1541523?lang=zh)
- [图片生成快速入门](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1824121?lang=zh)
- [BytePlus 图片生成 API](https://docs.byteplus.com/en/docs/ModelArk/1541523)
- [BytePlus Base URL 与鉴权](https://docs.byteplus.com/en/docs/ModelArk/1298459)

## 环境与密钥

- Node.js `>= 22.13.0`
- npm
- 已开通对应服务的 Seedream 5.0 Pro API Key

复制 `.env.example` 为 `.env.local`，仅填写本地密钥：

```bash
ARK_PROVIDER=volcengine
ARK_API_KEY=当前服务的_API_Key
ARK_MODEL_ID=
RESULT_IMAGE_SIGNING_SECRET=独立随机签名密钥
ARK_TIMEOUT_MS=180000
```

`ARK_PROVIDER` 只支持 `volcengine` 或 `byteplus`。不填写 `ARK_MODEL_ID` 时，国内自动使用 `doubao-seedream-5-0-pro-260628`，海外自动使用 `dola-seedream-5-0-pro-260628`。`RESULT_IMAGE_SIGNING_SECRET` 必须与 API Key 不同，建议使用至少 32 个随机字节。不要提交 `.env.local`。

## 启动与验收

```bash
npm install
npm run dev
```

启动后访问终端显示的本地地址，通常为 `http://localhost:3000`。

```bash
npm run typecheck
npm run lint
npm test
```

`npm test` 会依次执行类型检查、Edge 构建和全部接口规范、路由、几何测试；测试入口会硬性阻止向火山方舟和 BytePlus 的真实域名发请求，避免误产生费用。真实冒烟应显式通过本地 `/api/generate` 执行。

## 本地完整审计

仅在 localhost 地址后添加精确的 `?debug=1` 才会启用完整审计，例如：

```text
http://localhost:3000/?debug=1
```

启用后，每次生成会在当前页面内存中保留一份 Trace，包含：

- 页面提交的完整请求对象和原始请求体 SHA-256。
- 实际选择的 Provider、服务地址和模型。
- 服务端实际发送给上游的 URL、方法、请求头、完整 body、字节数和 SHA-256。
- 上游状态码、响应头、原始响应正文、解析后对象、字节数和 SHA-256。
- 服务端最终返回给页面的状态码、响应头和 body。

审计面板支持逐段复制以及下载完整 `trace.json`。为了避免浏览器渲染大段 Base64，面板预览会折叠图片数据，但复制和下载内容保持完整；签名 URL 和上游原始响应也会完整保留，便于人工核验。

Trace 不写文件、不写日志、不上传存储，刷新或关闭页面后立即消失。API Key 和 Authorization 是唯一永不捕获的内容，只记录请求时已设置鉴权。以下任一情况都会完全关闭审计：缺少 `?debug=1`、参数值不是精确的 `1`、不是 localhost，或请求体未声明调试。生产域名即使带 `?debug=1` 也不会返回 Trace。

## 编辑能力

- **任意标记**：将涂鸦、圈选、箭头或点标记合成到原图，仅发送合成后的单张图片。
- **坐标定位**：保留原图，将点和框转换为官方 `0–999` 相对坐标提示；坐标随缩放、平移和窗口尺寸变化保持不变。
- 支持官方 `1K`、`2K` 清晰度模式，以及 `921600–4624220` 总像素、`1:16–16:1` 宽高比的精确尺寸。
- Seedream 5.0 Pro 提示词优化固定使用 `standard`，支持 PNG / JPEG 输出和水印开关。
- 上游结果以临时 URL 返回；页面根据 `created` 展示 24 小时失效时间，并保留实际格式、尺寸、模型和用量信息。

提示词按照官网建议尽量控制在 300 个中文字符或 600 个英文单词以内。该数值是效果建议，不是接口硬限制，因此服务端不会擅自截断用户内容。

## 请求参数规范

浏览器调用 `POST /api/generate`。服务端严格校验字段，不对非法值做静默降级：

```json
{
  "prompt": "将标注区域替换为一杯咖啡",
  "images": ["https://example.com/source.png"],
  "edit": { "mode": "mark" },
  "size": { "mode": "resolution", "value": "1K", "ratio": "1:1" },
  "outputFormat": "png",
  "watermark": false,
  "optimizeMode": "standard",
  "debug": false
}
```

坐标模式的 `edit` 示例：

```json
{
  "mode": "coordinate",
  "annotations": [
    { "type": "point", "x": 500, "y": 500 },
    { "type": "bbox", "x1": 100, "y1": 120, "x2": 700, "y2": 800 }
  ]
}
```

服务端向当前 Provider 只发送专业版支持的字段：`model`、`prompt`、`image`、`size`、`optimize_prompt_options`、`output_format`、`response_format=url`、`watermark`。不会发送专业版不支持的序列图、流式或工具字段。

## 边界与安全

- 当前 Provider 接口规范支持 1–10 张 HTTPS URL 或小写 Base64 data URL；每张解码后最大 30 MiB。
- 支持 JPEG、PNG、WebP、BMP、TIFF、GIF、HEIC、HEIF。当前画板上传入口只开放浏览器能稳定解码并再次绘制的 JPEG、PNG、WebP；服务端参数校验仍覆盖全部官方格式。
- 输入图宽高均需大于 14 像素、总像素不超过 3600 万、宽高比在 `1:16–16:1`。画板会在上传时检查；URL 输入最终由上游校验。
- 当前画板一次编辑一张图片。服务端可接收至多 10 个 URL；data URL 请求还受应用 48 MiB 总请求体保护限制。
- 401/403、429、上游 5xx、非 JSON 响应、单图错误、超时和客户端取消均有明确状态映射；异常日志不记录密钥、上游正文或底层错误消息。
- 完整审计只允许 localhost + `?debug=1` 显式开启；其他请求不创建、不缓存、不落盘任何 Trace。API Key 与 Authorization 始终排除。
- 上游临时 URL 约 24 小时后失效，需要长期保存时请及时下载或转存到对象存储。

## 项目结构

- `app/page.tsx`：画板、参数面板、上传与结果交互。
- `app/api/generate/route.ts`：服务端请求参数校验、Provider 调用、超时和错误映射。
- `lib/ark-provider.ts`：国内/海外服务地址、默认模型和环境变量解析。
- `lib/seedream-5-pro.ts`：Seedream 5.0 Pro 参数与响应纯函数。
- `lib/editor-geometry.ts`：画布坐标、尺寸与输入边界纯函数。
- `tests/`：接口规范、路由、几何和构建冒烟测试。
