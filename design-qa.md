# 设置控制中心：设计 QA

## Evidence

- Source visual truth: `文档/参考/设计思路/桌宠设置/01-MonAgent设置-控制中心.png`
- Rendered implementation: `.artifacts/design-qa/settings-implementation-final-v2-1586x992.png`
- Full-view comparison: `.artifacts/design-qa/settings-final-v2-comparison-full.png`
- Focused left/preview comparison: `.artifacts/design-qa/settings-final-v2-comparison-left.png`
- Focused right/control comparison: `.artifacts/design-qa/settings-final-v2-comparison-right.png`
- Viewport: 1586 × 992 logical pixels; Electron capture is 3172 × 1984 physical pixels at device pixel ratio 2.
- State: desktop, light theme, `桌宠` section selected, character scale displayed at 100%, real default assistant loaded, save state settled at `已保存`.
- Capture method: running Electron renderer inspected through its Chromium debugging endpoint; the reference and rendered capture were normalized and placed together in every comparison image.

## Findings

- No actionable P0, P1, or P2 mismatch remains in the final comparison.
- [P3] Character artwork is intentionally different from the generated concept.
  Location: desktop preview and assistant avatar.
  Evidence: the source mock uses a concept character; the implementation uses the current Core assistant's real standee and avatar.
  Impact: subject silhouette and apparent scale differ, but the screen now represents the selected assistant accurately.
  Resolution: accepted as dynamic product content. A generated transparent fallback is used only when the Core asset is unavailable.
- [P3] Product-backed controls differ from the concept copy.
  Location: right settings panel.
  Evidence: the concept includes startup and tray behavior and a 50–200% range; the implementation exposes supported settings (`窗口置顶`, `透明背景`, `显示聊天框`) and the existing 70–140% product range.
  Impact: labels and slider marks do not match pixel-for-pixel.
  Resolution: accepted as an intentional functional constraint; no non-working switches were introduced.
- [P3] The footer uses the existing navy MonAgent logo rather than the orange concept mark.
  Location: sidebar footer.
  Resolution: accepted because the implementation must preserve the real brand asset.

## Required Fidelity Surfaces

- Fonts and typography: the implementation follows the source's neutral Chinese sans-serif hierarchy with the project's existing `Helvetica Neue`/Arial/system fallbacks. Heading, section label, secondary text, weight, line-height, truncation, and wrapping remain visually coherent at the target and tested narrow widths.
- Spacing and layout rhythm: target header is about 100px and implementation is 99.2px; target sidebar is about 272px and implementation is 272px. The main card is at x=304, y=131.2, width=1250, height=798, versus the source's approximate x=306, y=134 and 797px height. Grid split, 16px card radius, borders, section rhythm, and control alignment are visually matched.
- Colors and visual tokens: warm orange accent, stone foregrounds, white panels, subtle stone borders, cream preview background, green saved state, and disabled opacity map consistently to project tokens (`#d97706`, `#292524`, `#ffffff`, `#e7e5e4`, `#f5f5f4`). Contrast remains legible.
- Image quality and asset fidelity: the assistant uses the real Core raster asset at native aspect ratio with no stretch or CSS drawing. The fallback is a purpose-generated transparent PNG. Icons use the project's existing Lucide icon library; the footer uses the actual `/favicon-256.png` product asset. No emoji, placeholder box, handcrafted SVG, or CSS illustration substitutes visible assets.
- Copy and content: navigation and section labels follow the concept. Dynamic assistant name/status comes from live data. Unsupported concept settings were replaced by real, persisted product controls rather than fake interactions.
- Icons and surfaces: icon stroke family, active orange treatment, card borders, divider weight, radii, range affordance, toggle states, and window controls remain consistent across the screen.
- Responsiveness: measured at 1586×992, 960×500, 800×600, and 640×600. In every case `document.scrollWidth === viewport width`; there is no horizontal overflow. At narrow width the sidebar becomes a compact icon rail and the content area scrolls vertically.
- Accessibility: navigation and toggle controls expose pressed/checked semantics, window controls have accessible labels, range inputs have labels, images have alt text, disabled modes are represented as disabled, keyboard focus is visible, and reduced-motion behavior follows the existing motion setup.

## Functional Verification

- Navigated between `桌宠`, `窗口与交互`, and `输入框`; headings and content changed correctly.
- Toggled `窗口置顶` off and on, then restored the original state.
- Changed character scale for capture and restored the original 95% persisted value after capture.
- Triggered `更换助手` and verified its product notice.
- Verified the save indicator settles at `已保存`.
- Checked responsive layout metrics at four viewport sizes.
- Runtime exceptions checked: 0.
- Console errors checked: 0.
- Static verification: targeted oxlint passed with 0 warnings/errors; TypeScript typecheck passed; Electron main process syntax check passed; production web build passed.

## Comparison History

### Iteration 1

- Earlier P2 findings: native title chrome did not match the frameless source; preview artwork was undersized; main card proportions and header grid drifted.
- Fixes: enabled the frameless settings window, added working custom window controls, enlarged the preview slot, and aligned the header/sidebar/card geometry to the measured source.
- Post-fix evidence: `.artifacts/design-qa/settings-implementation-v3.png` and the next combined comparison showed the correct frameless composition and improved major-region proportions.

### Iteration 2

- Earlier P2 findings: increasing preview scale caused character cropping; sidebar/footer alignment, panel split, and window-control widths remained visibly off.
- Fixes: bound artwork scale to the persisted pet scale, capped the target desktop card at 798px, adjusted the left/right grid split and control widths, and aligned navigation/footer spacing.
- Post-fix evidence: `.artifacts/design-qa/settings-final-comparison-full.png`, `.artifacts/design-qa/settings-final-comparison-left.png`, and `.artifacts/design-qa/settings-final-comparison-right.png` showed the corrected crop and alignment.

### Iteration 3

- Earlier P2 finding: after removing Electron minimum dimensions, a sufficiently narrow window could hide the control panel.
- Fix: below the desktop breakpoint the sidebar collapses to a 72px icon rail and the main settings content uses vertical scrolling without horizontal overflow.
- Post-fix evidence: latest responsive metrics plus `.artifacts/design-qa/settings-final-v2-comparison-full.png`, `.artifacts/design-qa/settings-final-v2-comparison-left.png`, and `.artifacts/design-qa/settings-final-v2-comparison-right.png`. Desktop geometry remains unchanged after the responsive fix.

## Implementation Checklist

- [x] Match the control-center header, sidebar, preview card, and settings panel.
- [x] Use real assistant and brand assets with a high-quality fallback.
- [x] Keep all visible core controls functional and persisted.
- [x] Support proportional full-work-area settings window sizing without minimum dimensions.
- [x] Handle narrow windows without horizontal clipping.
- [x] Validate Electron interactions, console output, type safety, lint, and production build.

## Follow-up Polish

- If product requirements later add real startup and minimize-to-tray preferences, those controls can replace the current product-backed rows without changing the page structure.

final result: passed

---

# 实时语音转写输入框：设计 QA

## Evidence

- Source visual truth: `文档/参考/设计思路/桌宠语音输入/02-实时转写.png`
- Implementation target: `frontend/web/src/components/ChatInput.tsx`
- Viewport: intended desktop chat composer at the application's current proportional window size.
- State: microphone connecting, recording/live transcription, and finalizing transcription.
- Rendered implementation screenshot: unavailable in the current tool session; the already-running Electron process was preserved rather than starting a duplicate window.
- Full-view comparison evidence: blocked because no browser-rendered recording-state capture is available.
- Focused region comparison evidence: blocked for the same reason.

## Findings

- [P2] Visual comparison is not yet evidenced.
  Location: chat-page bottom composer while recording.
  Evidence: the source image is available and the implementation builds, but the current tool session cannot open or capture the live microphone state from the existing Electron renderer.
  Impact: spacing, live transcript wrapping, and action alignment have not been visually certified at runtime.
  Fix: activate microphone input in the existing MonAgent chat window, capture the composer at its normal viewport, and compare that capture beside the source image.

## Required Fidelity Surfaces

- Fonts and typography: implemented with the existing application type stack and proportional `vh` sizing; runtime wrapping remains to be visually checked.
- Spacing and layout rhythm: implemented as a 26% / flexible / 23% three-region grid with proportional spacing; runtime capture remains required.
- Colors and visual tokens: uses existing `accent`, `text`, `text-muted`, `border`, `bg`, and `card` tokens.
- Image quality and asset fidelity: the design contains no raster content. UI icons use the project's existing Lucide icon set.
- Copy and content: includes `正在转写`, elapsed time, live transcript, `取消`, and `完成`.

## Functional Verification

- TypeScript typecheck: passed.
- Production Vite build: passed.
- Git whitespace validation: passed.
- Implemented states: connecting, live recording level, elapsed time, incremental transcript, cancel-and-restore, finalizing, and completion.
- Browser-rendered interaction test: blocked by unavailable browser/capture tooling for the existing Electron renderer.
- Console error check: blocked for the same reason.

## Implementation Checklist

- [x] Replace the normal composer while microphone input is active.
- [x] Show live transcript and elapsed recording time.
- [x] Keep cancel and complete actions separate.
- [x] Restore the pre-recording input when cancelled.
- [x] Preserve the transcript after completion.
- [ ] Capture and compare the live Electron recording state.

## Comparison History

- No visual iteration has been completed because the implementation screenshot is unavailable.

final result: blocked

---

# 桌宠轻量悬浮气泡：设计 QA

## Evidence

- Source visual truth: `文档/参考/设计思路/桌宠交互/01-轻量悬浮气泡.png`
- Rendered implementation: `.artifacts/design-qa-pet-chat/desktop-implementation-expanded-v4.png`
- Focused side-by-side comparison: `.artifacts/design-qa-pet-chat/pet-chat-comparison-v4.png`
- Viewport: 1920 × 1080, Linux X11/Cinnamon desktop.
- State: real desktop, real assistant conversation, bubble expanded, no pending permission request.
- Primary interaction tested: collapsed bubble click, expand, close affordance, input focus region, and cross-application hit behavior above VS Code.

## Findings

- No actionable P0, P1, or P2 mismatch remains for the normal expanded-chat state.
- [P3] The implementation surface is darker than the source because the persisted dialogue opacity is 100%; the source visually represents a lower-opacity example. This is accepted because opacity is user-controlled and the component preserves the selected setting.
- [P3] The reference places the desktop pet on the right, while the capture uses the user's persisted left-side coordinates. This is accepted dynamic placement rather than layout drift.
- [P3] The source includes an active permission request. The implementation hides the permission strip when no request exists and renders it only for real pending permission/question state. The live capture had no pending request; the implemented strip follows the same separate dark bar, orange primary action, and neutral rejection action.

## Required Fidelity Surfaces

- Fonts and typography: neutral system Chinese sans-serif, compact 14–19px equivalent scale, two-line truncation for long live responses, readable 1.5 line height, and persisted font scaling supported.
- Spacing and layout rhythm: compact rounded conversation panel, three recent segments, stable composer row, separate attention strip, and close action aligned at the top-right.
- Colors and visual tokens: charcoal translucent surface, white/stone text, subtle white borders, and MonAgent orange for the user bubble and send/allow actions.
- Image quality and asset fidelity: the real Core avatar is used when available; the real standing image is cropped as a circular fallback. Lucide icons provide the close, smile, info, loading, and send affordances.
- Copy and content: live conversation replaces mock copy; placeholders and permission labels match the source intent.

## Functional Verification

- A single development login is now serialized across the main, character, and bubble renderers; later windows reuse the stored token.
- Bubble collapse and expansion change the native Electron bubble bounds without overlapping the click-through character window.
- Enter sends, Shift+Enter remains available to the normal composer, and IME composition Enter is ignored by the compact bubble.
- Permission and question actions call the existing runtime reply handlers.
- Targeted oxlint: 0 errors.
- TypeScript typecheck: passed.
- Production Vite build: passed.
- Electron main-process syntax check: passed.
- Runtime console: no application exception after the authentication serialization fix; Electron emitted only known X11 atom-cache diagnostics.

## Comparison History

### Iteration 1

- P1: simultaneous development logins invalidated sibling-window tokens and could replace the bubble with a login screen.
- Fix: serialized bootstrap login with the Web Locks API and reused the first valid token.

### Iteration 2

- P2: live long responses produced oversized text and crowded the panel.
- Fix: reduced the proportional base type size, limited each recent segment to two lines, and retained three recent segments.

### Iteration 3

- P2: the composer lacked the source's outlined input hierarchy and the disabled send action lost the orange identity.
- Fix: added the rounded outlined composer, smile affordance, and persistent orange circular send action.

## Follow-up Polish

- Capture a real pending-permission state in a later runtime test to compare the dynamic confirmation strip pixel-for-pixel.

final result: passed
