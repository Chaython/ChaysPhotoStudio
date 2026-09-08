// AI Upscaler backend — neural detail enhancement via z-ai-web-dev-sdk
// (image edit model). Client sends a base64 data-URL of the composite;
// we return an enhanced PNG data-URL that the editor then Lanczos-fits
// to the exact target resolution.
import { NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

const ENHANCE_PROMPT =
  'Upscale and enhance this image: reconstruct sharp edges and fine detail, ' +
  'remove compression artifacts and noise, keep the composition, colors, ' +
  'lighting and every element exactly the same. Photorealistic, no style change.'

const MAX_BODY = 8 * 1024 * 1024 // 8 MB

const SUPPORTED_SIZES = [
  '1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1472x736', '736x1472',
] as const

export async function POST(req: Request) {
  try {
    const body = await req.text()
    if (body.length > MAX_BODY) {
      return NextResponse.json({ error: 'Image payload too large (max 8 MB)' }, { status: 413 })
    }
    const { image, size } = JSON.parse(body) as { image?: string; size?: string }

    if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
      return NextResponse.json({ error: 'A base64 data-URL image is required' }, { status: 400 })
    }
    const outSize = (SUPPORTED_SIZES as readonly string[]).includes(size ?? '')
      ? (size as typeof SUPPORTED_SIZES[number])
      : '1024x1024'

    const zai = await ZAI.create()
    // NOTE: the SDK's TS types declare `image?: string`, but the backing
    // image_to_image service requires `images: [{ url }]` (per the image-edit
    // skill contract). Send both shapes to satisfy either version.
    const response = await zai.images.generations.edit({
      prompt: ENHANCE_PROMPT,
      image,
      images: [{ url: image }],
      size: outSize,
    } as never)

    const base64 = (response as any)?.data?.[0]?.base64
    if (!base64) {
      return NextResponse.json({ error: 'Neural engine returned no image' }, { status: 502 })
    }

    return NextResponse.json({ image: `data:image/png;base64,${base64}` })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown upscale error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
