/**
 * seedance.js
 *
 * Official Volcengine Ark Seedance 2.0 video generation service.
 * Supports:
 * - Text-to-video
 * - Reference-image/video multimodal video generation
 * - Reference-image video generation via Ark asset ID (asset://...)
 */

const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

function mapSeedanceModelName(modelId) {
    const mapping = {
        'seedance-2.0': 'doubao-seedance-2-0-260128',
        'seedance-2.0-fast': 'doubao-seedance-2-0-fast-260128',
        'seedance-2.0-mini': 'doubao-seedance-2-0-mini-260615'
    };

    return mapping[modelId] || mapping['seedance-2.0'];
}

function mapAspectRatio(aspectRatio) {
    const mapping = {
        'Auto': '16:9',
        '16:9': '16:9',
        '9:16': '9:16',
        '1:1': '1:1',
        '4:3': '4:3',
        '3:4': '3:4',
        '21:9': '21:9'
    };

    return mapping[aspectRatio] || '16:9';
}

function mapResolution(resolution) {
    const mapping = {
        'Auto': '720p',
        '512p': '480p',
        '480p': '480p',
        '768p': '720p',
        '720p': '720p',
        '1080p': '1080p',
        '4K': '4k',
        '4k': '4k'
    };

    return mapping[resolution] || '720p';
}

function mapDuration(duration) {
    if (duration === undefined || duration === null || duration === '' || duration === 'Auto') {
        return undefined;
    }

    const numeric = Number(duration);
    if (!Number.isFinite(numeric)) return undefined;
    return Math.max(4, Math.min(15, Math.round(numeric)));
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

function buildContent({ prompt, referenceImages, referenceAssetId }) {
    const content = [];
    const referenceUrls = [
        ...toArray(referenceImages),
        ...toArray(referenceAssetId).map(normalizeAssetId).filter(Boolean)
    ].slice(0, 9);

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
    generateAudio = true,
    modelId,
    apiKey
}) {
    if (!apiKey) {
        throw new Error('ARK_API_KEY not configured');
    }

    const model = mapSeedanceModelName(modelId);
    const mappedDuration = mapDuration(duration);
    const body = {
        model,
        content: buildContent({ prompt, referenceImages, referenceAssetId }),
        resolution: mapResolution(resolution),
        ratio: mapAspectRatio(aspectRatio),
        generate_audio: generateAudio,
        return_last_frame: true
    };

    if (mappedDuration !== undefined) {
        body.duration = mappedDuration;
    }

    console.log('[Seedance] Creating task with:', {
        model,
        duration: body.duration,
        resolution: body.resolution,
        ratio: body.ratio,
        generateAudio: body.generate_audio,
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
