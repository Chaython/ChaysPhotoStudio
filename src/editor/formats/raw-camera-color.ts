/** Camera-specific RAW settings passed through to LibRaw's sensor pipeline.
 * No sRGB pixel-space RGB gain is substituted for sensor white balance.
 * Matrix selection uses LibRaw's own DNG/file matrix extraction, not a bundled
 * DCP/ICC calibration database. Output remains display-referred sRGB.
 */
export type RawCameraMatrix = 'embedded' | 'built-in'
export type RawWhiteBalance = 'camera' | 'auto' | 'daylight' | 'custom'
export type RawWbMultipliers = [number,number,number,number]
export const DEFAULT_WB_MULTIPLIERS:RawWbMultipliers=[1,1,1,1]
export const DEFAULT_CAMERA_MATRIX:RawCameraMatrix='embedded'

const range=(v:unknown,min:number,max:number,fallback:number)=>{
  return typeof v==='number' && Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback
}
/** Guard stale/invalid Smart Object recipes against NaNs and impossible gains. */
export function normalizeWbMultipliers(raw:unknown):RawWbMultipliers {
  if(!Array.isArray(raw)||raw.length!==4)return [...DEFAULT_WB_MULTIPLIERS]
  return raw.map((value,i)=>range(value,0.1,16,DEFAULT_WB_MULTIPLIERS[i])) as RawWbMultipliers
}
export function normalizeCameraMatrix(raw:unknown):RawCameraMatrix {
  return raw==='built-in'?'built-in':'embedded'
}
export function normalizeWhiteBalance(raw:unknown):RawWhiteBalance {
  return raw==='auto'||raw==='daylight'||raw==='custom'?raw:'camera'
}
/** libraw-wasm accepts camera matrix policy 3 (prefer file data for all WB
 * modes) or 0 (use its built-in camera transform, where available).
 * 'custom' is a sensor-multiplier mode: camera/auto WB must both be off.
 */
export function rawCameraColorOptions(settings:{
  whiteBalance:RawWhiteBalance
  cameraMatrix:RawCameraMatrix
  whiteBalanceMultipliers:RawWbMultipliers
}){
  const whiteBalance=normalizeWhiteBalance(settings.whiteBalance)
  const custom=whiteBalance==='custom'
  return {
    useCameraWb:whiteBalance==='camera',
    useAutoWb:whiteBalance==='auto',
    useCameraMatrix:normalizeCameraMatrix(settings.cameraMatrix)==='embedded'?3:0,
    ...(custom?{userMul:normalizeWbMultipliers(settings.whiteBalanceMultipliers)}:{}),
  }
}
