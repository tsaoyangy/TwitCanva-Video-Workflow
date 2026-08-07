/**
 * seedance.js
 *
 * Official Volcengine Ark Seedance video generation service.
 * Supports Seedance 2.0 (2.0 / Fast / Mini) and Seedance 2.5.
 * Capabilities:
 * - Text-to-video
 * - Reference-image/video multimodal video generation
 * - Reference-image video generation via Ark asset ID (asset://...)
 *
 * Seedance 2.5 specifics (doubao-seedance-2-5-260628):
 * - Resolution limited to 480p / 720p
 * - Duration 4~30s (-1 = auto)
 * - Ratio supports adaptive
 * - Optional: seed / camera_fixed / watermark / output_format (mp4|mov)
 */

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

const SEEDANCE_MODEL_MAP = {
    'seedance-2.0': 'doubao-seedance-2-0-260128',
    'seedance-2.0-fast': 'doubao-seedance-2-0-fast-260128',
    'seedance-2.0-mini': 'doubao-seedance-2-0-mini-260615',
    'seedance-2.5': 'doubao-seedance-2-5-260628'
};

function mapSeedanceModelName(modelId) {
    return SEEDANCE_MODEL_MAP[modelId] || SEEDANCE_MODEL_MAP['seedance-2.0'];
}

function isSeedance25(modelId) {
    return modelId === 'seedance-2.5';
}

function mapAspectRatio(aspectRatio, { isV25 = false } = {}) {
    const value = (aspectRatio || '').trim().toLowerCase();

    if (value === 'adaptive') {
        // Adaptive only supported by Seedance 2.5; fall back to 16:9 otherwise.
        return isV25 ? 'adaptive' : '16:9';
    }

    const mapping = {
        'auto': '16:9',
        '16:9': '16:9',
        '9:16': '9:16',
        '1:1': '1:1',
        '4:3': '4:3',
        '3:4': '3:4',
        '21:9': '21:9'
    };

    return mapping[value] || '16:9';
}

function mapResolution(resolution, { isV25 = false } = {}) {
    const value = (resolution || '').trim().toLowerCase();

    if (isV25) {
        // Seedance 2.5 only supports 480p / 720p.
        const mapping25 = {
            'auto': '720p',
            '512p': '480p',
            '480p': '480p',
            '768p': '720p',
            '720p': '720p',
            '1080p': '720p',
            '4k': '720p'
        };
        return mapping25[value] || '720p';
    }

    const mapping = {
        'auto': '720p',
        '512p': '480p',
        '480p': '480p',
        '768p': '720p',
        '720p': '720p',
        '1080p': '1080p',
        '4k': '4k'
    };

    return mapping[value] || '720p';
}

function mapDuration(duration, { isV25 = false } = {}) {
    if (duration === undefined || duration === null || duration === '' || duration === 'Auto') {
        return undefined;
    }

    const numeric = Number(duration);
    if (!Number.isFinite(numeric)) return undefined;

    // -1 requests automatic duration (supported by Seedance 2.5).
    if (numeric === -1) {
        return isV25 ? -1 : undefined;
    }

    const maxDuration = isV25 ? 30 : 15;
    return Math.max(4, Math.min(maxDuration, Math.round(numeric)));
}

function normalizeTaskMode(taskMode) {
    const value = (taskMode || '').trim().toLowerCase();
    if (value === 'edit' || value === 'extend') return value;
    return 'reference';
}

function hasVideoReference(referenceImages, referenceAssetId) {
    const referenceUrls = [
        ...toArray(referenceImages),
        ...toArray(referenceAssetId).map(normalizeAssetId).filter(Boolean)
    ];
    return referenceUrls.some(isVideoReference);
}

function buildPromptForTaskMode(prompt, taskMode) {
    const trimmed = (prompt || '').trim();
    if (taskMode === 'edit') {
        return trimmed.startsWith('编辑视频') ? trimmed : `编辑视频：${trimmed}`;
    }
    if (taskMode === 'extend') {
        return trimmed.startsWith('向后延长') || trimmed.startsWith('延续') || trimmed.startsWith('续写')
            ? trimmed
            : `向后延长视频：${trimmed}`;
    }
    return trimmed;
}

function normalizeOutputFormat(outputFormat, { isV25 = false } = {}) {
    if (!isV25) return undefined;
    const value = (outputFormat || '').trim().toLowerCase();
    if (value === 'mp4' || value === 'mov') return value;
    return undefined;
}

function normalizeAssetId(assetId) {
    if (!assetId || typeof assetId !== 'string') return null;

    const trimmed = assetId.trim();
    if (!trimmed) return null;

    return trimmed.startsWith('asset://') ? trimmed : `asset://${trimmed}`;
}

async function parseJsonResponse(response) {
    const text = await response.text();

    try {
        return JSON.parse(text);
    } catch (error) {
        if (!response.ok) {
            throw new Error(`Seedance API returned ${response.status}: ${text.substring(0, 200)}`);
        }
        throw new Error(`Seedance API returned invalid JSON: ${text.substring(0, 200)}`);
    }
}

function toArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function isVideoReference(url) {
    if (!url || typeof url !== 'string') return false;
    const normalized = url.trim().toLowerCase().split('?')[0];
    return normalized.startsWith('data:video/') ||
        normalized.endsWith('.mp4') ||
        normalized.endsWith('.mov') ||
        normalized.includes('/library/videos/');
}

function buildContent({ prompt, referenceImages, referenceAssetId, maxReferences = 9 }) {
    const content = [];
    const referenceUrls = [
        ...toArray(referenceImages),
        ...toArray(referenceAssetId).map(normalizeAssetId).filter(Boolean)
    ].slice(0, maxReferences);

    if (prompt && prompt.trim()) {
        content.push({
            type: 'text',
            text: prompt.trim()
        });
    }

    for (const url of referenceUrls) {
        if (isVideoReference(url)) {
            content.push({
                type: 'video_url',
                role: 'reference_video',
                video_url: {
                    url
                }
            });
        } else {
            content.push({
                type: 'image_url',
                role: 'reference_image',
                image_url: {
                    url
                }
            });
        }
    }

    return content;
}

async function pollSeedanceTask(taskId, apiKey, maxWaitMs = 10 * 60 * 1000) {
    const startTime = Date.now();
    const pollInterval = 5000;

    while (Date.now() - startTime < maxWaitMs) {
        const response = await fetch(`${ARK_BASE_URL}/contents/generations/tasks/${taskId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        const result = await parseJsonResponse(response);

        if (!response.ok) {
            const message = result?.error?.message || result?.message || `HTTP ${response.status}`;
            throw new Error(`Seedance status query failed: ${message}`);
        }

        const status = result?.status;
        console.log(`[Seedance] Task ${taskId} status: ${status}`);

        if (status === 'succeeded') {
            const videoUrl = result?.content?.video_url;
            if (!videoUrl) {
                throw new Error('Seedance generation succeeded but no video URL was returned.');
            }
            return videoUrl;
        }

        if (status === 'failed' || status === 'cancelled' || status === 'expired') {
            const message = result?.error?.message || 'Seedance generation failed.';
            throw new Error(message);
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('Seedance generation timed out.');
}

export async function generateSeedanceVideo({
    prompt,
    referenceImages,
    referenceAssetId,
    aspectRatio,
    resolution,
    duration,
    taskMode,
    generateAudio = true,
    seed,
    cameraFixed,
    watermark,
    outputFormat,
    modelId,
    apiKey
}) {
    if (!apiKey) {
        throw new Error('ARK_API_KEY not configured');
    }

    const isV25 = isSeedance25(modelId);
    const model = mapSeedanceModelName(modelId);
    const normalizedTaskMode = isV25 ? normalizeTaskMode(taskMode) : 'reference';
    const effectivePrompt = buildPromptForTaskMode(prompt, normalizedTaskMode);
    const effectiveAspectRatio = normalizedTaskMode === 'reference' ? aspectRatio : 'adaptive';
    const effectiveDuration = normalizedTaskMode === 'edit' ? -1 : duration;
    const mappedDuration = mapDuration(effectiveDuration, { isV25 });
    // Seedance 2.5 accepts up to 30 reference images; 2.0 series caps at 9.
    const maxReferences = isV25 ? 30 : 9;

    if (normalizedTaskMode !== 'reference' && !hasVideoReference(referenceImages, referenceAssetId)) {
        throw new Error('Seedance video edit/extend requires at least one video reference. Connect a generated video node with a TOS/public URL.');
    }

    const body = {
        model,
        content: buildContent({ prompt: effectivePrompt, referenceImages, referenceAssetId, maxReferences }),
        resolution: mapResolution(resolution, { isV25 }),
        ratio: mapAspectRatio(effectiveAspectRatio, { isV25 }),
        generate_audio: generateAudio,
        return_last_frame: true
    };

    if (mappedDuration !== undefined) {
        body.duration = mappedDuration;
    }

    if (typeof cameraFixed === 'boolean') {
        body.camera_fixed = cameraFixed;
    }

    if (typeof watermark === 'boolean') {
        body.watermark = watermark;
    }

    // Seed: -1 (or empty) means random; only forward finite integers.
    if (seed !== undefined && seed !== null && seed !== '') {
        const numericSeed = Number(seed);
        if (Number.isFinite(numericSeed) && numericSeed >= 0) {
            body.seed = Math.round(numericSeed);
        }
    }

    const normalizedOutputFormat = normalizeOutputFormat(outputFormat, { isV25 });
    if (normalizedOutputFormat) {
        body.output_format = normalizedOutputFormat;
    }

    console.log('[Seedance] Creating task with:', {
        model,
        taskMode: normalizedTaskMode,
        duration: body.duration,
        resolution: body.resolution,
        ratio: body.ratio,
        generateAudio: body.generate_audio,
        cameraFixed: body.camera_fixed,
        watermark: body.watermark,
        seed: body.seed,
        outputFormat: body.output_format,
        referenceImageCount: toArray(referenceImages).length,
        hasReferenceAssetId: !!normalizeAssetId(referenceAssetId)
    });

    const response = await fetch(`${ARK_BASE_URL}/contents/generations/tasks`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    const result = await parseJsonResponse(response);

    if (!response.ok) {
        const message = result?.error?.message || result?.message || `HTTP ${response.status}`;
        throw new Error(`Seedance task creation failed: ${message}`);
    }

    const taskId = result?.id;
    if (!taskId) {
        throw new Error('Seedance API did not return a task ID.');
    }

    console.log(`[Seedance] Task created: ${taskId}`);
    return pollSeedanceTask(taskId, apiKey);
}
