/**
 * generation.js
 * 
 * Routes for AI image and video generation.
 * Supports Gemini, Veo, Kling AI, Hailuo AI, and OpenAI GPT Image providers.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { generateKlingVideo, generateKlingImage, generateKlingMultiImage } from '../services/kling.js';
import { generateGeminiImage, generateVeoVideo } from '../services/gemini.js';
import { generateHailuoVideo } from '../services/hailuo.js';
import { generateOpenAIImage } from '../services/openai.js';
import { generateSeedanceVideo } from '../services/seedance.js';
import { generateSeedreamImage } from '../services/ark.js';
import { ensureTosConfigured, uploadLibraryVideoToTos, uploadVideoFileToTos } from '../services/tos.js';
import { resolveImageToBase64, saveBufferToFile } from '../utils/imageHelpers.js';

const router = express.Router();

function resolveImagesToBase64(input) {
    if (!input) return [];
    const values = Array.isArray(input) ? input : [input];
    return values.map(item => resolveImageToBase64(item)).filter(Boolean);
}

function normalizeSeedreamEditSize(size = {}) {
    if (size.mode === 'pixels') {
        const width = Number(size.width);
        const height = Number(size.height);
        if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
            throw new Error('Invalid pixel size for Seedream edit');
        }
        return `${width}x${height}`;
    }

    const value = size.value === '2K' ? '2K' : '1K';
    return value;
}

function serializeSeedreamEditAnnotation(annotation = {}) {
    if (annotation.type === 'point') {
        return `图1<point>${annotation.x} ${annotation.y}</point>`;
    }
    if (annotation.type === 'bbox') {
        return `图1<bbox>${annotation.x1} ${annotation.y1} ${annotation.x2} ${annotation.y2}</bbox>`;
    }
    return '';
}

function buildSeedreamEditPrompt({ prompt, edit, size }) {
    const ratioInstruction = size?.mode === 'resolution' && size.ratio
        ? `输出图片比例为 ${size.ratio}。`
        : '';

    if (edit?.mode === 'coordinate') {
        const annotations = Array.isArray(edit.annotations)
            ? edit.annotations.map(serializeSeedreamEditAnnotation).filter(Boolean).join('；')
            : '';
        if (!annotations) {
            throw new Error('Coordinate edit requires at least one annotation');
        }
        return `请根据图1完成精准图片编辑。交互坐标定位（相对于图1，坐标范围0至999）：${annotations}。请严格以这些坐标定位编辑目标。用户要求：${prompt}。${ratioInstruction}仅修改坐标所指区域；保持构图、人物身份和未指定区域与原图一致，使结果自然融合。`;
    }

    return `请根据图1中的手绘草图、涂鸦、圈选、箭头或标记区域进行图片编辑。用户要求：${prompt}。${ratioInstruction}仅修改标记所指区域；移除所有草图和标记线条；保持构图、人物身份和未标记区域与原图一致，使结果自然融合。`;
}

async function resolveSeedanceReferenceInputs(input, { videosDir }) {
    if (!input) return [];
    const values = Array.isArray(input) ? input : [input];
    const resolved = [];

    for (const item of values) {
        if (!item || typeof item !== 'string') continue;

        const trimmed = item.trim();
        if (trimmed.startsWith('asset://')) {
            resolved.push(trimmed);
            continue;
        }

        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            resolved.push(trimmed);
            continue;
        }

        if (trimmed.startsWith('/library/videos/') || trimmed.includes('/library/videos/')) {
            const tosPublicUrl = await uploadLibraryVideoToTos(trimmed, { videosDir });
            if (tosPublicUrl) {
                resolved.push(tosPublicUrl);
                continue;
            }
        }

        resolved.push(resolveImageToBase64(trimmed));
    }

    return resolved.filter(Boolean);
}

// ============================================================================
// IMAGE GENERATION
// ============================================================================

router.post('/generate-image', async (req, res) => {
    try {
        const { nodeId, prompt, aspectRatio, resolution, imageBase64: rawImageBase64, imageModel, klingReferenceMode, klingFaceIntensity, klingSubjectIntensity } = req.body;
        const { GEMINI_API_KEY, ARK_API_KEY, KLING_ACCESS_KEY, KLING_SECRET_KEY, OPENAI_API_KEY, IMAGES_DIR } = req.app.locals;
        const normalizedImageModel = imageModel === 'gemini-pro' ? 'seedream-5.0-pro' : imageModel;

        // Determine provider
        const isKlingModel = normalizedImageModel && normalizedImageModel.startsWith('kling-');
        const isOpenAIModel = normalizedImageModel && normalizedImageModel.startsWith('gpt-image-');

        let imageBuffer;
        let imageFormat = 'png';

        if (isKlingModel) {
            // --- KLING AI IMAGE GENERATION ---
            if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
                return res.status(500).json({
                    error: "Kling API credentials not configured. Add KLING_ACCESS_KEY and KLING_SECRET_KEY to .env"
                });
            }

            console.log(`Using Kling AI model for image: ${normalizedImageModel}`);

            // Resolve images if provided
            let resolvedImages = null;
            if (rawImageBase64) {
                const rawImages = Array.isArray(rawImageBase64) ? rawImageBase64 : [rawImageBase64];
                resolvedImages = rawImages.map(img => resolveImageToBase64(img)).filter(Boolean);
            }

            let klingImageUrl;

            // Determine which API to use based on model and reference images:
            // - kling-v1-5: Uses standard API with image_reference parameter
            // - kling-v2, kling-v2-1: Use Multi-Image API (image_reference not supported)
            const isV2Model = normalizedImageModel === 'kling-v2' || normalizedImageModel === 'kling-v2-1' || normalizedImageModel === 'kling-v2-new';
            const hasReferenceImages = resolvedImages && resolvedImages.length > 0;

            if (hasReferenceImages && isV2Model) {
                // V2 models: Use Multi-Image API for image-to-image
                console.log(`Using Kling Multi-Image API for ${normalizedImageModel} with ${resolvedImages.length} subject image(s)`);
                klingImageUrl = await generateKlingMultiImage({
                    prompt,
                    subjectImages: resolvedImages,
                    modelId: normalizedImageModel,
                    aspectRatio,
                    resolution,
                    accessKey: KLING_ACCESS_KEY,
                    secretKey: KLING_SECRET_KEY
                });
            } else if (hasReferenceImages && resolvedImages.length > 1) {
                // Multiple images with non-V2 model: Use Multi-Image API
                console.log(`Using Kling Multi-Image API with ${resolvedImages.length} subject images`);
                klingImageUrl = await generateKlingMultiImage({
                    prompt,
                    subjectImages: resolvedImages,
                    modelId: normalizedImageModel,
                    aspectRatio,
                    resolution,
                    accessKey: KLING_ACCESS_KEY,
                    secretKey: KLING_SECRET_KEY
                });
            } else {
                // V1.5 or text-to-image: Use standard API (V1.5 supports image_reference)
                klingImageUrl = await generateKlingImage({
                    prompt,
                    imageBase64: resolvedImages,
                    modelId: normalizedImageModel,
                    aspectRatio,
                    resolution,
                    klingReferenceMode,
                    klingFaceIntensity,
                    klingSubjectIntensity,
                    accessKey: KLING_ACCESS_KEY,
                    secretKey: KLING_SECRET_KEY
                });
            }

            // Download from Kling's URL
            const imageResponse = await fetch(klingImageUrl);
            if (!imageResponse.ok) {
                throw new Error('Failed to download image from Kling');
            }
            imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

            if (klingImageUrl.includes('.jpg') || klingImageUrl.includes('.jpeg')) {
                imageFormat = 'jpg';
            }

        } else if (isOpenAIModel) {
            // --- OPENAI GPT IMAGE GENERATION ---
            if (!OPENAI_API_KEY) {
                return res.status(500).json({
                    error: "OpenAI API key not configured. Add OPENAI_API_KEY to .env"
                });
            }

            console.log(`Using OpenAI GPT Image model: ${normalizedImageModel}`);

            // Resolve images if provided
            let imageBase64Array = null;
            if (rawImageBase64) {
                const rawImages = Array.isArray(rawImageBase64) ? rawImageBase64 : [rawImageBase64];
                imageBase64Array = rawImages.map(img => resolveImageToBase64(img)).filter(Boolean);
            }

            imageBuffer = await generateOpenAIImage({
                prompt,
                imageBase64Array,
                aspectRatio,
                resolution,
                apiKey: OPENAI_API_KEY
            });

        } else {
            // --- SEEDREAM IMAGE GENERATION (Default) ---
            if (!ARK_API_KEY) {
                return res.status(500).json({ error: "ARK_API_KEY not configured. Add ARK_API_KEY to .env" });
            }

            let imageBase64Array = null;
            if (rawImageBase64) {
                const rawImages = Array.isArray(rawImageBase64) ? rawImageBase64 : [rawImageBase64];
                imageBase64Array = rawImages.map(img => resolveImageToBase64(img)).filter(Boolean);
            }

            imageBuffer = await generateSeedreamImage({
                prompt,
                imageBase64Array,
                aspectRatio,
                resolution,
                apiKey: ARK_API_KEY
            });
        }

        // Save to library - use unique filename to preserve previous generations
        const saved = saveBufferToFile(imageBuffer, IMAGES_DIR, 'img', imageFormat);

        // Determine metadata ID: use nodeId for recovery if available, otherwise use file ID
        const metadataId = nodeId || saved.id;

        // Save metadata (id must match the metadata filename for delete to work)
        const metadata = {
            id: metadataId,  // Must match the filename for delete API to find it
            filename: saved.filename,
            prompt: prompt,
            model: normalizedImageModel || 'seedream-5.0-pro',
            createdAt: new Date().toISOString(),
            type: 'images'
        };
        fs.writeFileSync(path.join(IMAGES_DIR, `${metadataId}.json`), JSON.stringify(metadata, null, 2));

        console.log(`Image saved: ${saved.url} (model: ${normalizedImageModel || 'seedream-5.0-pro'})`);
        return res.json({ resultUrl: saved.url });

    } catch (error) {
        console.error("Server Image Gen Error:", error);
        res.status(500).json({ error: error.message || "Image generation failed" });
    }
});

router.post('/seedream-edit', async (req, res) => {
    try {
        const {
            prompt,
            image,
            edit,
            size,
            outputFormat = 'png',
            watermark = false,
            nodeId
        } = req.body;
        const { ARK_API_KEY, IMAGES_DIR } = req.app.locals;

        if (!ARK_API_KEY) {
            return res.status(500).json({ error: "ARK_API_KEY not configured. Add ARK_API_KEY to .env" });
        }
        if (!prompt || typeof prompt !== 'string') {
            return res.status(400).json({ error: 'Missing prompt' });
        }
        if (!image || typeof image !== 'string') {
            return res.status(400).json({ error: 'Missing image' });
        }
        if (outputFormat !== 'png' && outputFormat !== 'jpeg') {
            return res.status(400).json({ error: 'outputFormat must be png or jpeg' });
        }

        const resolvedImage = resolveImageToBase64(image);
        if (!resolvedImage || !resolvedImage.startsWith('data:image/')) {
            return res.status(400).json({ error: 'Seedream edit requires an image input' });
        }

        const requestPrompt = buildSeedreamEditPrompt({ prompt: prompt.trim(), edit, size });
        const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${ARK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'doubao-seedream-5-0-pro-260628',
                prompt: requestPrompt,
                image: [resolvedImage],
                size: normalizeSeedreamEditSize(size),
                optimize_prompt_options: { mode: 'standard' },
                output_format: outputFormat,
                response_format: 'b64_json',
                watermark: Boolean(watermark)
            })
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
            const message = data?.error?.message || data?.message || `Seedream edit failed (${response.status})`;
            throw new Error(message);
        }

        const b64 = data?.data?.[0]?.b64_json;
        if (!b64) {
            throw new Error('Seedream edit did not return image data');
        }

        const imageFormat = outputFormat === 'jpeg' ? 'jpg' : 'png';
        const saved = saveBufferToFile(Buffer.from(b64, 'base64'), IMAGES_DIR, 'img', imageFormat);
        const metadataId = nodeId || saved.id;
        fs.writeFileSync(path.join(IMAGES_DIR, `${metadataId}.json`), JSON.stringify({
            id: metadataId,
            filename: saved.filename,
            prompt,
            editMode: edit?.mode || 'mark',
            model: 'seedream-5.0-pro',
            createdAt: new Date().toISOString(),
            type: 'images'
        }, null, 2));

        return res.json({ resultUrl: saved.url });
    } catch (error) {
        console.error("Seedream Edit Error:", error);
        res.status(500).json({ error: error.message || 'Seedream edit failed' });
    }
});

// ============================================================================
// VIDEO GENERATION
// ============================================================================

router.post('/generate-video', async (req, res) => {
    try {
        const { nodeId, prompt, imageBase64: rawImageBase64, lastFrameBase64: rawLastFrameBase64, motionReferenceUrl: rawMotionReferenceUrl, aspectRatio, resolution, duration, videoModel, seedanceReferenceAssetId, seedanceReferenceInputs, seedanceSeed, seedanceCameraFixed, seedanceWatermark, seedanceOutputFormat } = req.body;
        const { GEMINI_API_KEY, ARK_API_KEY, KLING_ACCESS_KEY, KLING_SECRET_KEY, HAILUO_API_KEY, VIDEOS_DIR } = req.app.locals;

        // Resolve file URLs to base64
        const imageBase64 = Array.isArray(rawImageBase64)
            ? resolveImagesToBase64(rawImageBase64)
            : resolveImageToBase64(rawImageBase64);
        const lastFrameBase64 = resolveImageToBase64(rawLastFrameBase64);
        const motionReferenceUrl = resolveImageToBase64(rawMotionReferenceUrl);

        // Determine provider
        const isKlingModel = videoModel && videoModel.startsWith('kling-');
        const isHailuoModel = videoModel && videoModel.startsWith('hailuo-');
        const isSeedanceModel = videoModel && videoModel.startsWith('seedance-');

        let videoBuffer;

        if (isSeedanceModel) {
            if (!ARK_API_KEY) {
                return res.status(500).json({
                    error: "ARK_API_KEY not configured. Add ARK_API_KEY to .env"
                });
            }
            ensureTosConfigured();

            const seedanceVideoUrl = await generateSeedanceVideo({
                prompt,
                referenceImages: seedanceReferenceInputs
                    ? await resolveSeedanceReferenceInputs(seedanceReferenceInputs, { videosDir: VIDEOS_DIR })
                    : resolveImagesToBase64(rawImageBase64),
                referenceAssetId: seedanceReferenceInputs ? undefined : seedanceReferenceAssetId,
                aspectRatio,
                resolution,
                duration,
                generateAudio: req.body.generateAudio !== false,
                seed: seedanceSeed,
                cameraFixed: seedanceCameraFixed,
                watermark: seedanceWatermark,
                outputFormat: seedanceOutputFormat,
                modelId: videoModel,
                apiKey: ARK_API_KEY
            });

            const videoResponse = await fetch(seedanceVideoUrl);
            if (!videoResponse.ok) {
                throw new Error('Failed to download generated video from Seedance');
            }
            videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
        } else if (isKlingModel) {
            // --- KLING AI VIDEO GENERATION ---

            // Check if this is a Kling 2.6 model (route to Fal.ai - official API doesn't support v2.6)
            const isKling26 = videoModel === 'kling-v2-6';
            // Check if this is a motion control request (kling-v2-6 with motion reference)
            const isMotionControl = isKling26 && motionReferenceUrl;

            let resultVideoUrl;

            if (isKling26) {
                // --- KLING 2.6 VIA FAL.AI ---
                // Official Kling API doesn't support v2.6, use fal.ai instead
                const { FAL_API_KEY } = req.app.locals;

                if (!FAL_API_KEY) {
                    return res.status(500).json({
                        error: "FAL_API_KEY not configured. Add FAL_API_KEY to .env for Kling 2.6."
                    });
                }

                if (isMotionControl) {
                    // Motion Control mode
                    console.log(`\n[Route] Kling 2.6 Motion Control detected - routing to fal.ai`);
                    console.log(`[Route] Motion Reference: ${motionReferenceUrl ? 'YES (' + Math.round(motionReferenceUrl.length / 1024) + ' KB)' : 'NO'}`);
                    console.log(`[Route] Character Image: ${imageBase64 ? 'YES (' + Math.round(imageBase64.length / 1024) + ' KB)' : 'NO'}`);
                    console.log(`[Route] Prompt: ${prompt ? prompt.substring(0, 50) + '...' : '(none)'}`);

                    const { generateFalMotionControl } = await import('../services/fal.js');

                    resultVideoUrl = await generateFalMotionControl({
                        prompt,
                        characterImageBase64: imageBase64,
                        motionVideoBase64: motionReferenceUrl,
                        characterOrientation: 'video',
                        apiKey: FAL_API_KEY
                    });
                } else {
                    // Standard Image-to-Video mode
                    console.log(`\n[Route] Kling 2.6 Image-to-Video - routing to fal.ai`);
                    console.log(`[Route] Image: ${imageBase64 ? 'YES (' + Math.round(imageBase64.length / 1024) + ' KB)' : 'NO'}`);
                    console.log(`[Route] Duration: ${duration || 5}s`);
                    console.log(`[Route] Generate Audio: ${req.body.generateAudio !== false}`);

                    const { generateFalImageToVideo } = await import('../services/fal.js');

                    resultVideoUrl = await generateFalImageToVideo({
                        prompt,
                        imageBase64,
                        duration: String(duration || 5),
                        generateAudio: req.body.generateAudio !== false, // Default to true
                        apiKey: FAL_API_KEY
                    });
                }
            } else {
                // --- STANDARD KLING VIDEO GENERATION ---
                if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
                    return res.status(500).json({
                        error: "Kling API credentials not configured. Add KLING_ACCESS_KEY and KLING_SECRET_KEY to .env"
                    });
                }

                console.log(`Using Kling AI model: ${videoModel}, duration: ${duration || 5}s`);

                resultVideoUrl = await generateKlingVideo({
                    prompt,
                    imageBase64,
                    lastFrameBase64,
                    modelId: videoModel,
                    aspectRatio,
                    duration: duration || 5,
                    motionReferenceUrl,
                    accessKey: KLING_ACCESS_KEY,
                    secretKey: KLING_SECRET_KEY
                });
            }

            // Download from the result URL
            const videoResponse = await fetch(resultVideoUrl);
            if (!videoResponse.ok) {
                throw new Error('Failed to download generated video');
            }
            videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

        } else if (isHailuoModel) {
            // --- HAILUO AI VIDEO GENERATION ---
            if (!HAILUO_API_KEY) {
                return res.status(500).json({
                    error: "Hailuo API key not configured. Add HAILUO_API_KEY to .env"
                });
            }

            console.log(`Using Hailuo AI model: ${videoModel}, duration: ${duration || 6}s`);

            const hailuoVideoUrl = await generateHailuoVideo({
                prompt,
                imageBase64,
                lastFrameBase64,
                modelId: videoModel,
                aspectRatio,
                resolution,
                duration: duration || 6,
                apiKey: HAILUO_API_KEY
            });

            // Download from Hailuo's URL
            const videoResponse = await fetch(hailuoVideoUrl);
            if (!videoResponse.ok) {
                throw new Error('Failed to download video from Hailuo');
            }
            videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

        } else {
            // --- VEO VIDEO GENERATION (Default) ---
            if (!GEMINI_API_KEY) {
                return res.status(500).json({ error: "Server missing API Key config" });
            }

            console.log(`Using Veo model: ${videoModel || 'veo-3.1'}, duration: ${duration || 8}s, generateAudio: ${req.body.generateAudio !== false}`);

            videoBuffer = await generateVeoVideo({
                prompt,
                imageBase64,
                lastFrameBase64,
                aspectRatio,
                resolution,
                duration: duration || 8,
                generateAudio: req.body.generateAudio !== false, // Default to true
                apiKey: GEMINI_API_KEY
            });
        }

        // Save to library - use unique filename to preserve previous generations
        const saved = saveBufferToFile(videoBuffer, VIDEOS_DIR, 'vid', 'mp4');
        let tosUploadResult = null;

        if (isSeedanceModel) {
            tosUploadResult = await uploadVideoFileToTos(saved.path, { filename: saved.filename });
            console.log(`Seedance video uploaded to TOS: ${tosUploadResult.tosPublicUrl}`);
        }

        // Determine metadata ID: use nodeId for recovery if available, otherwise use file ID
        const metadataId = nodeId || saved.id;

        // Save metadata (id must match the metadata filename for delete to work)
        const metadata = {
            id: metadataId,  // Must match the filename for delete API to find it
            filename: saved.filename,
            prompt: prompt,
            model: videoModel || 'veo-3.1',
            aspectRatio: aspectRatio || 'Auto',
            resolution: resolution || 'Auto',
            createdAt: new Date().toISOString(),
            type: 'videos',
            ...(tosUploadResult || {})
        };
        fs.writeFileSync(path.join(VIDEOS_DIR, `${metadataId}.json`), JSON.stringify(metadata, null, 2));

        console.log(`Video saved: ${saved.url} (model: ${videoModel || 'veo-3.1'})`);
        return res.json({ resultUrl: saved.url, tosPublicUrl: tosUploadResult?.tosPublicUrl });

    } catch (error) {
        console.error("Server Video Gen Error:", error);
        res.status(500).json({ error: error.message || "Video generation failed" });
    }
});

// ============================================================================
// GENERATION STATUS / RECOVERY
// ============================================================================

/**
 * Check if a generation has finished for a specific nodeId.
 * Returns the resultUrl if it exists.
 */
router.get('/generation-status/:nodeId', async (req, res) => {
    try {
        const { nodeId } = req.params;
        const { IMAGES_DIR, VIDEOS_DIR } = req.app.locals;

        // Check images metadata
        const imageMetaPath = path.join(IMAGES_DIR, `${nodeId}.json`);
        if (fs.existsSync(imageMetaPath)) {
            const meta = JSON.parse(fs.readFileSync(imageMetaPath, 'utf8'));
            return res.json({ status: 'success', resultUrl: `/library/images/${meta.filename}`, type: 'image', createdAt: meta.createdAt });
        }

        // Check videos metadata
        const videoMetaPath = path.join(VIDEOS_DIR, `${nodeId}.json`);
        if (fs.existsSync(videoMetaPath)) {
            const meta = JSON.parse(fs.readFileSync(videoMetaPath, 'utf8'));
            return res.json({ status: 'success', resultUrl: `/library/videos/${meta.filename}`, type: 'video', createdAt: meta.createdAt });
        }

        res.json({ status: 'pending' });
    } catch (error) {
        console.error("Status Check Error:", error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/videos/tos-url', async (req, res) => {
    try {
        const { url } = req.query;
        const { VIDEOS_DIR } = req.app.locals;

        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'Missing url' });
        }

        const tosPublicUrl = await uploadLibraryVideoToTos(url, { videosDir: VIDEOS_DIR });
        if (!tosPublicUrl) {
            return res.status(404).json({ error: 'TOS URL not found' });
        }

        res.json({ tosPublicUrl });
    } catch (error) {
        console.error("TOS URL Resolve Error:", error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
