import OpenAI from 'openai';

export const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
export const DEFAULT_SEED_MODEL = 'doubao-seed-evolving';
export const DEFAULT_SEEDREAM_MODEL = 'doubao-seedream-5-0-pro-260628';

export function getArkClient(apiKey) {
    return new OpenAI({
        apiKey,
        baseURL: ARK_BASE_URL
    });
}

export function ensureImageDataUrl(image) {
    if (!image || typeof image !== 'string') return image;
    if (image.startsWith('data:image/')) return image;
    if (image.startsWith('data:')) {
        const [, base64 = ''] = image.split(',');
        return `data:image/png;base64,${base64 || image}`;
    }
    return `data:image/png;base64,${image}`;
}

export function partsToArkContent(parts = []) {
    return parts.map((part) => {
        if (typeof part === 'string') {
            return { type: 'text', text: part };
        }
        if (part?.inlineData?.data) {
            return {
                type: 'image_url',
                image_url: {
                    url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
                }
            };
        }
        if (part?.text) {
            return { type: 'text', text: part.text };
        }
        return part;
    });
}

export async function createSeedChatCompletion({
    apiKey,
    messages,
    model = DEFAULT_SEED_MODEL,
    temperature = 0.7,
    maxTokens = 2048,
    responseFormat
}) {
    const client = getArkClient(apiKey);

    const completion = await client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        response_format: responseFormat,
        extra_body: {
            thinking: {
                type: 'disabled'
            }
        }
    });

    return {
        text: completion.choices?.[0]?.message?.content || '',
        raw: completion
    };
}

function buildSeedreamSize(resolution = '1K', aspectRatio = 'Auto') {
    const ratio = aspectRatio === 'Auto' ? '1:1' : aspectRatio;
    const sizeMap = {
        '1K': {
            '1:1': '1024x1024',
            '16:9': '1536x864',
            '9:16': '864x1536',
            '4:3': '1365x1024',
            '3:4': '1024x1365',
            '3:2': '1536x1024',
            '2:3': '1024x1536',
            '21:9': '1792x768'
        },
        '2K': {
            '1:1': '2048x2048',
            '16:9': '2048x1152',
            '9:16': '1152x2048',
            '4:3': '2048x1536',
            '3:4': '1536x2048',
            '3:2': '2048x1365',
            '2:3': '1365x2048',
            '21:9': '2048x878'
        }
    };

    return sizeMap[resolution]?.[ratio] || sizeMap['1K']['1:1'];
}

export async function generateSeedreamImage({
    prompt,
    imageBase64Array,
    aspectRatio,
    resolution,
    apiKey,
    model = DEFAULT_SEEDREAM_MODEL
}) {
    const client = getArkClient(apiKey);
    const size = buildSeedreamSize(resolution, aspectRatio);

    const payload = {
        model,
        prompt,
        size,
        response_format: 'b64_json'
    };

    if (imageBase64Array && imageBase64Array.length > 0) {
        const images = imageBase64Array
            .map(ensureImageDataUrl)
            .filter(Boolean)
            .slice(0, 10);
        payload.image = images.length === 1 ? images[0] : images;
    }

    const response = await client.images.generate(payload);
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) {
        throw new Error('Seedream did not return image data');
    }

    return Buffer.from(b64, 'base64');
}

export function extractJsonFromText(text = '') {
    const fenced = text.match(/```json\s*([\s\S]*?)```/i);
    const raw = fenced ? fenced[1] : text;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('No JSON object found in model response');
    }
    return JSON.parse(raw.slice(start, end + 1));
}
