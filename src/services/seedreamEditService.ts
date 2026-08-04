export type SeedreamEditMode = 'mark' | 'coordinate';

export type SeedreamEditAnnotation =
  | { type: 'point'; x: number; y: number }
  | { type: 'bbox'; x1: number; y1: number; x2: number; y2: number };

export interface SeedreamEditParams {
  prompt: string;
  image: string;
  edit: {
    mode: SeedreamEditMode;
    annotations?: SeedreamEditAnnotation[];
  };
  size: { mode: 'resolution'; value: '1K' | '2K'; ratio: string } | { mode: 'pixels'; width: number; height: number };
  outputFormat: 'png' | 'jpeg';
  watermark: boolean;
  nodeId?: string;
}

export async function generateSeedreamEdit(params: SeedreamEditParams): Promise<string> {
  const response = await fetch('/api/seedream-edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || response.statusText || 'Seedream edit failed');
  }
  if (!data.resultUrl) {
    throw new Error('Seedream edit did not return an image URL');
  }

  return data.resultUrl;
}
