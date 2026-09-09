/** A bounded replacement hunk, preserving common leading/trailing lines; no quadratic diff allocation. */
export function replacementDiff(before: string, after: string) {
  const left = before.split('\n'), right = after.split('\n')
  let prefix = 0, suffix = 0
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - suffix - 1] === right[right.length - suffix - 1]) suffix++
  return { changed: before !== after, startLine: prefix + 1, removed: left.slice(prefix, left.length - suffix),
    added: right.slice(prefix, right.length - suffix), unchangedPrefixLines: prefix, unchangedSuffixLines: suffix }
}
