/**
 * generationService.ts
 * 
 * Frontend service layer for AI content generation.
 * Proxies requests to backend API which handles multiple providers:
 * - Image: Gemini Pro, Kling AI
 * - Video: Veo 3.1, Kling AI
 */

export interface GenerateImageParams {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  imageBase64?: string | string[]; // Supports single image or array of images
  imageModel?: string; // Image model version (e.g., 'gemini-pro', 'kling-v2')
  nodeId?: string; // ID of the node initiating generation
  // Kling V1.5 reference settings
  klingReferenceMode?: 'subject' | 'face';
  klingFaceIntensity?: number; // 0-100
  klingSubjectIntensity?: number; // 0-100
}

export interface GenerateVideoParams {
  prompt: string;
  imageBase64?: string | string[]; // For Image-to-Video or Seedance reference images
  lastFrameBase64?: string; // For frame-to-frame interpolation (end frame)
  aspectRatio?: string;
  resolution?: string; // Add resolution to params
  duration?: number; // Video duration in seconds (e.g., 5, 6, 8, 10)
  videoModel?: string; // Video model version (e.g., 'veo-3.1', 'kling-v2-1')
  motionReferenceUrl?: string; // For Kling 2.6 motion control
  seedanceReferenceAssetId?: string; // For Seedance asset library reference
  seedanceReferenceInputs?: string[]; // Ordered Seedance reference images/assets
  seedanceTaskMode?: 'reference' | 'edit' | 'extend'; // Seedance 2.5 task mode
  seedanceSeed?: number; // Seedance random seed (>=0). Omit/-1 for random
  seedanceCameraFixed?: boolean; // Seedance: keep camera fixed (no camera motion)
  seedanceWatermark?: boolean; // Seedance: add watermark to output
  seedanceOutputFormat?: 'mp4' | 'mov'; // Seedance 2.5 output container format
  generateAudio?: boolean; // For Kling 2.6, Veo 3.1 and Seedance native audio (default: true)
  nodeId?: string; // ID of the node initiating generation
}

/**
 * Generates an image by calling the backend API
 */
export const generateImage = async (params: GenerateImageParams): Promise<string> => {
  try {
    const response = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || response.statusText);
    }

    const data = await response.json();
    if (!data.resultUrl) {
      throw new Error("No image data returned from server");
    }
    return data.resultUrl;

  } catch (error) {
    console.error("Image Generation Error:", error);
    throw error;
  }
};

/**
 * Generates a video by calling the backend API
 */
export interface GenerateVideoResult {
  resultUrl: string;
  tosPublicUrl?: string;
}

export const generateVideo = async (params: GenerateVideoParams): Promise<GenerateVideoResult> => {
  try {
    const response = await fetch('/api/generate-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || response.statusText);
    }

    const data = await response.json();
    if (!data.resultUrl) {
      throw new Error("No video data returned from server");
    }
    return {
      resultUrl: data.resultUrl,
      tosPublicUrl: data.tosPublicUrl
    };

  } catch (error) {
    console.error("Video Generation Error:", error);
    throw error;
  }
};
