'use client'

interface NativeToolInfo { electron: boolean; gmic: boolean; gegl: boolean; gmicVersion?: string; geglVersion?: string }
interface NativeApi {
  nativeTools?: {
    info(): Promise<NativeToolInfo>
    runGmic(payload: { image: string; args: string[] }): Promise<{ image: string; stderr?: string }>
    runGegl(payload: { image: string; operation: string; args?: string[] }): Promise<{ image: string; stderr?: string }>
  }
}

function api(): NativeApi['nativeTools'] | undefined {
  return (window as unknown as { chaysPhotoStudio?: NativeApi }).chaysPhotoStudio?.nativeTools
}

export async function nativeToolInfo(): Promise<NativeToolInfo> {
  const a = api()
  if (!a) return { electron: false, gmic: false, gegl: false }
  try { return await a.info() } catch { return { electron: true, gmic: false, gegl: false } }
}

export async function runNativeGmic(image: string, args: string[]): Promise<string> {
  const a = api()
  if (!a) throw new Error('Native G’MIC is only available in the Electron desktop build')
  const r = await a.runGmic({ image, args })
  return r.image
}

export async function runNativeGegl(image: string, operation: string, args: string[] = []): Promise<string> {
  const a = api()
  if (!a) throw new Error('Native GEGL is only available in the Electron desktop build')
  const r = await a.runGegl({ image, operation, args })
  return r.image
}
