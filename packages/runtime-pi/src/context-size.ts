/** Conservative text budgeting; provider framing and image accounting are not exact locally. */
export function contextSize(value: unknown): number {
  let images = 0
  const text = JSON.stringify(value, (_key, item) => {
    if (item?.type === 'image' && typeof item.data === 'string' && item.data.length >= 4
      && item.data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) {
      images++; return { type: 'image', mimeType: item.mimeType }
    }
    return item
  }) ?? ''
  let wide = 0
  for (const character of text) if (/[\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff]/u.test(character)) wide++
  return wide + Math.ceil((text.length - wide) / 3) + images * 8192
}
