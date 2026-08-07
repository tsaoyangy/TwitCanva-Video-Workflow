/**
 * useGeneration.ts
 * 
 * Custom hook for handling AI content generation (images and videos).
 * Manages generation state, API calls, and error handling.
 */

import { NodeData, NodeType, NodeStatus } from '../types';
import { generateImage, generateVideo } from '../services/generationService';
import { generateLocalImage } from '../services/localModelService';
import { extractVideoLastFrame } from '../utils/videoHelpers';

type SeedanceTaskMode = NonNullable<NodeData['seedanceTaskMode']>;

interface UseGenerationProps {
    nodes: NodeData[];
    updateNode: (id: string, updates: Partial<NodeData>) => void;
}

export const useGeneration = ({ nodes, updateNode }: UseGenerationProps) => {
    // ============================================================================
    // HELPERS
    // ============================================================================

    /**
     * Convert pixel dimensions to closest standard aspect ratio
     */
    const getClosestAspectRatio = (width: number, height: number): string => {
        const ratio = width / height;
        const standardRatios = [
            { label: '1:1', value: 1 },
            { label: '16:9', value: 16 / 9 },
            { label: '9:16', value: 9 / 16 },
            { label: '4:3', value: 4 / 3 },
            { label: '3:4', value: 3 / 4 },
            { label: '3:2', value: 3 / 2 },
            { label: '2:3', value: 2 / 3 },
            { label: '5:4', value: 5 / 4 },
            { label: '4:5', value: 4 / 5 },
            { label: '21:9', value: 21 / 9 }
        ];

        let closest = standardRatios[0];
        let minDiff = Math.abs(ratio - closest.value);

        for (const r of standardRatios) {
            const diff = Math.abs(ratio - r.value);
            if (diff < minDiff) {
                minDiff = diff;
                closest = r;
            }
        }

        return closest.label;
    };

    /**
     * Detect the actual aspect ratio of an image
     * @param imageUrl - URL or base64 of the image
     * @returns Promise with resultAspectRatio (exact) and aspectRatio (closest standard)
     */
    const getImageAspectRatio = (imageUrl: string): Promise<{ resultAspectRatio: string; aspectRatio: string }> => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const resultAspectRatio = `${img.naturalWidth}/${img.naturalHeight}`;
                const aspectRatio = getClosestAspectRatio(img.naturalWidth, img.naturalHeight);
                resolve({ resultAspectRatio, aspectRatio });
            };
            img.onerror = () => {
                resolve({ resultAspectRatio: '16/9', aspectRatio: '16:9' });
            };
            img.src = imageUrl;
        });
    };

    const isSeedanceVideoReferenceInput = (url: string) => {
        const normalized = url.trim().toLowerCase().split('?')[0];
        return normalized.startsWith('data:video/') ||
            normalized.endsWith('.mp4') ||
            normalized.endsWith('.mov') ||
            normalized.includes('/library/videos/');
    };

    const inferSeedanceTaskMode = (
        prompt: string,
        selectedMode: SeedanceTaskMode | undefined,
        referenceInputs: string[] | undefined
    ): SeedanceTaskMode | undefined => {
        if (selectedMode === 'edit' || selectedMode === 'extend') return selectedMode;
        if (!referenceInputs?.some(isSeedanceVideoReferenceInput)) return selectedMode;

        const text = prompt.trim().toLowerCase();
        if (/(向前|向后)?延长|延续|续写|extend|continue/.test(text)) return 'extend';
        if (/编辑视频|增加|加上|删除|去掉|修改|替换|改成|edit|remove|delete|replace|change|add/.test(text)) return 'edit';
        return selectedMode;
    };

    // ============================================================================
    // GENERATION HANDLER
    // ============================================================================

    /**
     * Handles content generation for a node
     * Supports image and video generation with parent node chaining
     * 
     * @param id - ID of the node to generate content for
     */
    const handleGenerate = async (id: string) => {
        const node = nodes.find(n => n.id === id);
        if (!node) return;

        // Get prompts from connected TEXT nodes (if any)
        const getTextNodePrompts = (): string[] => {
            if (!node.parentIds) return [];
            return node.parentIds
                .map(pid => nodes.find(n => n.id === pid))
                .filter(n => n?.type === NodeType.TEXT && n.prompt)
                .map(n => n!.prompt);
        };

        // Combine prompts: TEXT node prompts + node's own prompt
        const textNodePrompts = getTextNodePrompts();
        const combinedPrompt = [...textNodePrompts, node.prompt].filter(Boolean).join('\n\n');

        // Check if prompt is required
        // For Kling frame-to-frame with both start and end frames, prompt is optional
        const isKlingFrameToFrame =
            node.type === NodeType.VIDEO &&
            node.videoModel?.startsWith('kling-') &&
            (node.parentIds && node.parentIds.length >= 2);

        if (!combinedPrompt && !isKlingFrameToFrame) return;

        updateNode(id, { status: NodeStatus.LOADING, generationStartTime: Date.now() });

        try {
            if (node.type === NodeType.IMAGE || node.type === NodeType.IMAGE_EDITOR) {
                // Collect parent images for image-to-image generation.
                // Seedream 5.0 Pro supports up to 10 reference images.
                const imageBase64s: string[] = [];
                const maxReferenceImages = node.imageModel?.startsWith('seedream-') ? 10 : 14;
                const imageParentIds = node.parentIds?.filter(pid => {
                    const parent = nodes.find(n => n.id === pid);
                    return parent?.type !== NodeType.TEXT;
                }) || [];
                const orderedImageParentIds = (() => {
                    if (!node.imageModel?.startsWith('seedream-')) return imageParentIds;

                    const availableIds = new Set(imageParentIds);
                    const orderedIds = (node.seedreamReferenceOrder || [])
                        .map(item => item.id)
                        .filter(id => availableIds.has(id));
                    const missingIds = imageParentIds.filter(id => !orderedIds.includes(id));
                    return [...orderedIds, ...missingIds];
                })();

                // Get images from all direct parents (excluding TEXT nodes)
                if (orderedImageParentIds.length > 0) {
                    for (const parentId of orderedImageParentIds) {
                        let currentId: string | undefined = parentId;

                        // Traverse up the chain to find an image source (skip TEXT nodes)
                        while (currentId && imageBase64s.length < maxReferenceImages) {
                            const parent = nodes.find(n => n.id === currentId);
                            // Skip TEXT nodes - they provide prompts, not images
                            if (parent?.type === NodeType.TEXT) {
                                break;
                            }
                            const parentImageUrl = parent?.type === NodeType.VIDEO && parent.lastFrame
                                ? parent.lastFrame
                                : parent?.resultUrl;
                            if (parentImageUrl) {
                                imageBase64s.push(parentImageUrl);
                                break; // Found image for this parent chain
                            } else {
                                // Continue up this chain
                                currentId = parent?.parentIds?.[0];
                            }
                        }
                    }
                }

                // Add character reference URLs from storyboard nodes (for maintaining character consistency)
                if (node.characterReferenceUrls && node.characterReferenceUrls.length > 0) {
                    for (const charUrl of node.characterReferenceUrls) {
                        if (imageBase64s.length < maxReferenceImages) {
                            imageBase64s.push(charUrl);
                        }
                    }
                }

                // Generate image with all parent images and character references
                const rawResultUrl = await generateImage({
                    prompt: combinedPrompt,
                    aspectRatio: node.aspectRatio,
                    resolution: node.resolution,
                    imageBase64: imageBase64s.length > 0 ? imageBase64s : undefined,
                    imageModel: node.imageModel,
                    nodeId: id,
                    // Kling V1.5 reference settings
                    klingReferenceMode: node.klingReferenceMode,
                    klingFaceIntensity: node.klingFaceIntensity,
                    klingSubjectIntensity: node.klingSubjectIntensity
                });

                // Add cache-busting parameter to force browser to fetch new image
                // (Backend uses nodeId as filename, so URL is the same for regenerated images)
                const resultUrl = `${rawResultUrl}?t=${Date.now()}`;

                // Detect actual image dimensions (for display purposes only)
                const { resultAspectRatio } = await getImageAspectRatio(resultUrl);

                // Keep user's selected aspectRatio - don't overwrite it with detected ratio
                updateNode(id, {
                    status: NodeStatus.SUCCESS,
                    resultUrl,
                    resultAspectRatio,
                    // Note: aspectRatio is intentionally NOT updated to preserve user's selection
                    errorMessage: undefined
                });


            } else if (node.type === NodeType.LOCAL_IMAGE_MODEL) {
                // --- LOCAL MODEL GENERATION ---
                // Check if model is selected
                if (!node.localModelId && !node.localModelPath) {
                    updateNode(id, {
                        status: NodeStatus.ERROR,
                        errorMessage: 'No local model selected. Please select a model first.'
                    });
                    return;
                }

                // Get parent images if any
                const imageBase64s: string[] = [];
                if (node.parentIds && node.parentIds.length > 0) {
                    for (const parentId of node.parentIds) {
                        const parent = nodes.find(n => n.id === parentId);
                        if (parent?.type !== NodeType.TEXT && parent?.resultUrl) {
                            imageBase64s.push(parent.resultUrl);
                        }
                    }
                }

                // Call local generation API
                const result = await generateLocalImage({
                    modelId: node.localModelId,
                    modelPath: node.localModelPath,
                    prompt: combinedPrompt,
                    aspectRatio: node.aspectRatio,
                    resolution: node.resolution || '512'
                });

                if (result.success && result.resultUrl) {
                    // Add cache-busting parameter
                    const resultUrl = `${result.resultUrl}?t=${Date.now()}`;

                    // Detect actual image dimensions
                    const { resultAspectRatio } = await getImageAspectRatio(resultUrl);

                    updateNode(id, {
                        status: NodeStatus.SUCCESS,
                        resultUrl,
                        resultAspectRatio,
                        errorMessage: undefined
                    });
                } else {
                    throw new Error(result.error || 'Local generation failed');
                }

            } else if (node.type === NodeType.VIDEO) {
                // Get first parent image for video generation (start frame)
                let imageBase64: string | string[] | undefined;
                let lastFrameBase64: string | undefined;
                let seedanceReferenceInputs: string[] | undefined;
                const isSeedanceModel = node.videoModel?.startsWith('seedance-');

                // Get non-TEXT parent nodes (visual sources)
                const visualParentIds = node.parentIds?.filter(pid => {
                    const parent = nodes.find(n => n.id === pid);
                    return parent?.type !== NodeType.TEXT;
                }) || [];

                // Check for frame-to-frame mode (explicit or auto-detected from 2+ image parents)
                const hasMultipleInputs = visualParentIds.length >= 2;
                const hasExplicitFrameInputs = node.frameInputs && node.frameInputs.length >= 2;

                // Motion Reference logic (Kling 2.6)
                let motionReferenceUrl: string | undefined;
                let isMotionControl = false;
                if (node.videoModel === 'kling-v2-6') {
                    // Find a parent video node that has a result
                    const videoParent = node.parentIds
                        ?.map(pid => nodes.find(n => n.id === pid))
                        .find(n => n?.type === NodeType.VIDEO && n.resultUrl);

                    if (videoParent) {
                        motionReferenceUrl = videoParent.resultUrl;
                        isMotionControl = true;
                    }
                }

                // Only evaluate as frame-to-frame if NOT in motion control mode
                const isFrameToFrame = !isMotionControl && (node.videoMode === 'frame-to-frame' || hasMultipleInputs || hasExplicitFrameInputs);

                if (isSeedanceModel) {
                    const connectedReferences = visualParentIds
                        .map(parentId => nodes.find(n => n.id === parentId))
                        .filter(parent => (parent?.type === NodeType.IMAGE || parent?.type === NodeType.VIDEO) && parent.resultUrl)
                        .map(parent => ({
                            type: 'node' as const,
                            id: parent!.id,
                            url: parent!.type === NodeType.VIDEO && parent!.tosPublicUrl
                                ? parent!.tosPublicUrl
                                : parent!.resultUrl!
                        }));

                    const assetId = node.seedanceReferenceAssetId?.trim();
                    const availableReferences = [
                        ...connectedReferences,
                        ...(assetId ? [{
                            type: 'asset' as const,
                            id: assetId,
                            url: assetId.startsWith('asset://') ? assetId : `asset://${assetId}`
                        }] : [])
                    ];
                    const availableKeys = new Set(availableReferences.map(ref => `${ref.type}:${ref.id}`));
                    const orderedKeys = (node.seedanceReferenceOrder || [])
                        .map(item => `${item.type}:${item.id}`)
                        .filter(key => availableKeys.has(key));
                    const missingKeys = availableReferences
                        .map(ref => `${ref.type}:${ref.id}`)
                        .filter(key => !orderedKeys.includes(key));
                    const finalKeys = [...orderedKeys, ...missingKeys];

                    const seedanceReferenceLimit = node.videoModel === 'seedance-2.5' ? 30 : 9;

                    seedanceReferenceInputs = finalKeys
                        .map(key => availableReferences.find(ref => `${ref.type}:${ref.id}` === key)?.url)
                        .filter((url): url is string => Boolean(url))
                        .slice(0, seedanceReferenceLimit);

                    imageBase64 = undefined;
                    lastFrameBase64 = undefined;
                } else if (isFrameToFrame && visualParentIds.length >= 2) {
                    // Get start and end frames from frameInputs (if user reordered) or default order
                    const parent1 = nodes.find(n => n.id === visualParentIds[0]);
                    const parent2 = nodes.find(n => n.id === visualParentIds[1]);

                    // Check if user has explicitly set frame order
                    if (node.frameInputs && node.frameInputs.length >= 2) {
                        const startFrameInput = node.frameInputs.find(f => f.order === 'start');
                        const endFrameInput = node.frameInputs.find(f => f.order === 'end');

                        if (startFrameInput) {
                            const startNode = nodes.find(n => n.id === startFrameInput.nodeId);
                            if (startNode?.resultUrl) {
                                imageBase64 = startNode.resultUrl;
                            }
                        }

                        if (endFrameInput) {
                            const endNode = nodes.find(n => n.id === endFrameInput.nodeId);
                            if (endNode?.resultUrl) {
                                lastFrameBase64 = endNode.resultUrl;
                            }
                        }
                    } else {
                        // Default: first parent = start, second parent = end
                        if (parent1?.resultUrl) imageBase64 = parent1.resultUrl;
                        if (parent2?.resultUrl) lastFrameBase64 = parent2.resultUrl;
                    }
                } else if (visualParentIds.length > 0) {
                    // Standard mode or Motion Control: get character reference or first parent image
                    if (isMotionControl) {
                        // For Motion Control, look specifically for an IMAGE parent as character reference
                        const characterParent = node.parentIds
                            ?.map(pid => nodes.find(n => n.id === pid))
                            .find(n => n?.type === NodeType.IMAGE && n.resultUrl);

                        if (characterParent?.resultUrl) {
                            imageBase64 = characterParent.resultUrl;
                        }
                    } else {
                        // Standard mode: get first parent image or video last frame
                        // Use visualParentIds (filtered to exclude TEXT nodes) instead of raw parentIds
                        const parent = nodes.find(n => n.id === visualParentIds[0]);

                        if (parent?.type === NodeType.VIDEO && parent.lastFrame) {
                            // Use last frame from parent video
                            imageBase64 = parent.lastFrame;
                        } else if (parent?.resultUrl) {
                            // Use parent image directly
                            imageBase64 = parent.resultUrl;
                        }
                    }
                }

                // Generate video
                const seedanceRequestTaskMode = node.videoModel === 'seedance-2.5'
                    ? inferSeedanceTaskMode(combinedPrompt, node.seedanceTaskMode, seedanceReferenceInputs)
                    : node.seedanceTaskMode;
                const seedanceRequiresAdaptive = seedanceRequestTaskMode === 'edit' || seedanceRequestTaskMode === 'extend';
                const requestAspectRatio = isSeedanceModel && seedanceRequiresAdaptive ? 'adaptive' : node.aspectRatio;
                const requestDuration = isSeedanceModel && seedanceRequestTaskMode === 'edit' ? -1 : node.videoDuration;

                const videoResult = await generateVideo({
                    prompt: combinedPrompt,
                    imageBase64,
                    lastFrameBase64,
                    aspectRatio: requestAspectRatio,
                    resolution: node.resolution,
                    duration: requestDuration,
                    videoModel: node.videoModel,
                    motionReferenceUrl,
                    seedanceReferenceAssetId: node.seedanceReferenceAssetId,
                    seedanceReferenceInputs,
                    seedanceTaskMode: seedanceRequestTaskMode,
                    seedanceSeed: node.seedanceSeed,
                    seedanceCameraFixed: node.seedanceCameraFixed,
                    seedanceWatermark: node.seedanceWatermark,
                    seedanceOutputFormat: node.seedanceOutputFormat,
                    generateAudio: node.generateAudio, // For Kling 2.6, Veo 3.1 and Seedance native audio
                    nodeId: id
                });

                // Add cache-busting parameter to force browser to fetch new video
                // (Backend uses nodeId as filename, so URL is the same for regenerated videos)
                const resultUrl = `${videoResult.resultUrl}?t=${Date.now()}`;

                // Extract last frame for chaining
                const lastFrame = await extractVideoLastFrame(resultUrl);

                // Detect video aspect ratio
                let resultAspectRatio: string | undefined;
                let aspectRatio: string | undefined;
                try {
                    const video = document.createElement('video');
                    await new Promise<void>((resolve) => {
                        video.onloadedmetadata = () => {
                            resultAspectRatio = `${video.videoWidth}/${video.videoHeight}`;
                            aspectRatio = getClosestAspectRatio(video.videoWidth, video.videoHeight);
                            resolve();
                        };
                        video.onerror = () => resolve();
                        video.src = resultUrl;
                    });
                } catch (e) {
                    // Ignore errors, use undefined aspect ratio
                }

                updateNode(id, {
                    status: NodeStatus.SUCCESS,
                    resultUrl,
                    tosPublicUrl: videoResult.tosPublicUrl,
                    resultAspectRatio,
                    aspectRatio,
                    lastFrame,
                    errorMessage: undefined // Clear any previous error
                });


            }
        } catch (error: any) {
            // Handle errors
            const msg = error.toString().toLowerCase();
            let errorMessage = error.message || 'Generation failed';

            if (msg.includes('permission_denied') || msg.includes('403')) {
                errorMessage = 'Permission denied. Check API Key configuration.';
            } else if (msg.includes('unable to process input image') || msg.includes('invalid_argument')) {
                errorMessage = '⚠️ Input image incompatible. Veo requires: JPEG format, 16:9 or 9:16 aspect ratio. Try a different image or generate without input.';
            }

            updateNode(id, { status: NodeStatus.ERROR, errorMessage });
            console.error('Generation failed:', error);
        }
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        handleGenerate
    };
};
