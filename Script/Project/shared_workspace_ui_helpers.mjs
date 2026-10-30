export async function selectSharingMode(page, mode) {
  const selector = '[role="switch"][aria-label="云主机共享"]'
  const checked = String(mode === 'cloud')
  await page.waitForFunction(selector => {
    const control = document.querySelector(selector)
    return control && !control.disabled
  }, selector)
  const control = page.getByRole('switch', { name: '云主机共享', exact: true })
  if (await control.getAttribute('aria-checked') !== checked) await control.click()
  await page.waitForFunction(({ selector, checked }) => {
    const control = document.querySelector(selector)
    return control?.getAttribute('aria-checked') === checked && !control.disabled
  }, { selector, checked })
}
