# TwitCanva Video Workflow

Node-based AI image and video workflow canvas, modified for the current Volcengine Ark workflow.

This version uses Volcengine Ark in the Beijing region for chat, image generation, storyboard generation, and video generation. Generated local videos can be uploaded to Volcengine TOS in the Shanghai region so they can be reused as public video references in later Seedance calls.

## Current Effective Model Calls

| Capability | Current model/service | Backend entry |
| --- | --- | --- |
| Chat and multimodal understanding | Seed 2.1 / Seed Evolving, `doubao-seed-2-1-pro-260628` | `POST /api/chat` |
| Storyboard text generation | Seed 2.1 / Seed Evolving, `doubao-seed-2-1-pro-260628` | `server/routes/storyboard.js` |
| Image generation | Seedream 5.0 Pro, `doubao-seedream-5-0-pro-260628` | `POST /api/generate-image` |
| Image-to-image and multi-image reference generation | Seedream 5.0 Pro | `POST /api/generate-image` |
| Interactive image editing | Seedream 5.0 Pro with mark/coordinate editing | `POST /api/seedream-edit` |
| Video generation | Seedance 2.0 / Fast / Mini | `POST /api/generate-video` |
| Video reference URL resolving | Volcengine TOS upload and public URL metadata | `GET /api/videos/tos-url` |

Ark API base URL:

```text
https://ark.cn-beijing.volces.com/api/v3
```

Current Seedance model mapping:

| Frontend option | Ark model |
| --- | --- |
| `seedance-2.0` | `doubao-seedance-2-0-260128` |
| `seedance-2.0-fast` | `doubao-seedance-2-0-fast-260128` |
| `seedance-2.0-mini` | `doubao-seedance-2-0-mini-260615` |

## Main Features

- Visual node canvas for image and video workflows.
- Seed 2.1 chat assistant with local image/video attachment support.
- Seedream 5.0 Pro text-to-image, single image-to-image, and multi-image reference generation.
- Seedream interactive edit modal with mark mode and coordinate mode.
- Seedance 2.0 text-to-video and reference-based video generation.
- Seedance ordered reference list, including connected image/video nodes and manual Ark asset IDs.
- Seedance duration options include `Auto`, `5`, `6`, `8`, `10`, `12`, and `15` seconds.
- Video references are sent as public URLs when the source is a generated local video.
- Generated Seedance videos are saved locally and uploaded to TOS when TOS credentials are configured.
- Storyboard generator uses Seed 2.1 for text and Seedream 5.0 Pro for composite images.
- Local workflow and asset persistence under `library/`.

## Project Structure

```text
.
├── src/                         # React + TypeScript frontend
│   ├── App.tsx                  # Canvas state and modal orchestration
│   ├── components/              # Canvas, node controls, chat, modals
│   ├── hooks/                   # Generation and panel state logic
│   └── services/                # Frontend API clients
├── server/                      # Express backend
│   ├── index.js                 # App entry and shared routes
│   ├── routes/                  # Generation and storyboard routes
│   └── services/                # Ark, Seedance, TOS helpers
├── library/                     # Local images, videos, assets, chats, workflows
├── seedream-draw-studio-demo/   # Reference project only, not the runtime app
├── start-dev.sh                 # Convenience local dev launcher
├── Dockerfile
└── docker-compose.yml
```

## Requirements

- Node.js 20+ recommended.
- npm.
- Volcengine Ark API key with access to Seed 2.1, Seedream 5.0 Pro, and Seedance 2.0 models.
- Optional but recommended: Volcengine TOS AK/SK if you want generated local videos to be reused as Seedance video references.

## Environment Variables

Create a `.env` file in the project root.

```env
# Required for current Ark model calls
ARK_API_KEY=your_ark_api_key

# Optional but recommended for Seedance video reference reuse
TOS_ACCESS_KEY_ID=your_tos_access_key_id
TOS_SECRET_ACCESS_KEY=your_tos_secret_access_key
TOS_REGION=cn-shanghai
TOS_ENDPOINT=tos-cn-shanghai.volces.com
TOS_BUCKET=arkclaw--tsaoyang
TOS_VIDEO_PREFIX=twitcanva/video
TOS_PUBLIC_BASE_URL=https://arkclaw--tsaoyang.tos-cn-shanghai.volces.com
```

Notes:

- `.env` is intentionally ignored by Git.
- Local generated assets in `library/` are part of this customized repository unless you choose to ignore them later.
- Legacy environment variables for Gemini, Kling, Hailuo, OpenAI, Fal, X, or TikTok may still exist in old code paths, but the current primary workflow uses `ARK_API_KEY` and optional TOS variables.

## Local Development

Install dependencies:

```bash
npm install
```

Start frontend and backend together:

```bash
./start-dev.sh
```

Equivalent npm command:

```bash
npm run dev
```

Default local URLs:

```text
Frontend: http://localhost:5173
Backend:  http://localhost:3001
```

Build frontend:

```bash
npm run build
```

Run backend only:

```bash
npm run server
```

## Docker

Build and run with Docker Compose:

```bash
docker compose up -d --build
```

App URL:

```text
http://localhost:3001
```

Stop:

```bash
docker compose down
```

Important: the current `docker-compose.yml` came from the original project and still lists several legacy provider variables. For the current Volcengine workflow, make sure the container receives at least:

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

The compose file mounts:

```text
./library:/app/library
```

so local generated assets persist outside the container.

## Using the Canvas

1. Open the app.
2. Create an image or video node from the canvas controls.
3. Select Seedream 5.0 Pro for image generation or Seedance 2.0 for video generation.
4. Connect image/video nodes to later nodes to use them as references.
5. For Seedance, adjust the reference order in the node controls when the prompt uses terms such as `image 1`, `image 2`, or video references.
6. For Ark asset library references, paste the asset ID into the Seedance asset ID field. The backend normalizes it to `asset://...`.

## Seedream Image Generation

Seedream 5.0 Pro supports:

- Text-to-image.
- Single image reference generation.
- Multi-image reference generation, up to 10 connected image references.
- Ordered reference inputs for prompts that refer to `image 1`, `image 2`, etc.
- Interactive edit mode from Seedream image nodes.

Interactive edit behavior:

- Clicking generate immediately creates a new loading Image node.
- Closing the edit modal only closes the modal.
- The background generation continues and updates the new node on success or failure.
- The source image node is preserved for comparison and rollback.

## Seedance Video Generation

Seedance 2.0 supports:

- Text-to-video.
- Image references.
- Video references.
- Mixed image and video references.
- Ark asset IDs as `asset://...` references.
- Reference ordering from the frontend.
- `Auto`, `720p`, and `1080p` resolution options.
- `Auto` duration or explicit duration up to 15 seconds.

For video references:

- Ark Seedance requires a web-accessible video URL.
- Local generated videos are uploaded to TOS when TOS credentials are configured.
- The resulting `tosPublicUrl` is stored in video metadata and reused for later video reference calls.

## Local Data

The app stores local data under `library/`:

```text
library/images/      # Generated and uploaded images
library/videos/      # Generated videos and video metadata
library/assets/      # Local app asset library
library/chats/       # Chat sessions
library/workflows/   # Saved workflows
```

Video metadata may include:

```json
{
  "tosPublicUrl": "https://arkclaw--tsaoyang.tos-cn-shanghai.volces.com/twitcanva/video/..."
}
```

## Git and Secrets

This customized repository is intended to include local code and local `library/` assets, but not secrets.

Keep ignored:

```text
.env
```

Do not commit real API keys, TOS AK/SK, or other private credentials.

## Troubleshooting

`ARK_API_KEY not configured`

- Add `ARK_API_KEY` to `.env`.
- Restart the backend after changing `.env`.

Seedance fails when using a local video reference

- Configure TOS variables.
- Make sure the source video has been uploaded and has a `tosPublicUrl`.
- Use the TOS public URL as the Seedance `reference_video` input.

TOS URL stays in resolving state

- Check TOS credentials and bucket access.
- Confirm the local video exists in `library/videos/`.
- Confirm the backend can write metadata JSON next to the video file.

GitHub large file warning

- GitHub warns for files larger than 50 MB.
- Files under 100 MB can still be pushed, but Git LFS is recommended for future large video assets.
