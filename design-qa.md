# 设置控制中心：设计 QA

> 历史证据说明（2026-08-19）：本文件汇总的是界面设计迭代记录，其中标注“Python server”“Python AgentCore chain”或旧 REST 路由的运行结果均发生在全 Rust 迁移之前，只能作为视觉/交互历史基线，不能证明当前 Rust Server 已通过验收。当前运行时事实、迁移状态和待复验项分别以 `文档/技术/MonAgent 全 Rust 完整功能迁移计划.md`、`文档/技术/MonAgent 归档行为验收矩阵.md` 为准；收到明确“构建”指令后，相关界面必须重新对 Rust JSON-RPC 链路执行验证。

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

# 助手切换名册：设计 QA

## Evidence

- Source visual truth: `[LOCAL_HOME]/.codex/generated_images/019f6487-6371-7d90-b30b-eab4d14bfe85/exec-97e52746-1f4e-46f6-be47-6a2409a9695b.png`
- Rendered implementation: `.artifacts/design-qa/assistant-switcher-implementation.png`
- Full side-by-side comparison: `.artifacts/design-qa/assistant-switcher-comparison-full.png`
- Focused sidebar comparison: `.artifacts/design-qa/assistant-switcher-comparison-left.png`
- Viewport: Electron full work area 1920 × 1000, captured at 1920 × 1080 with the 80px operating-system panel removed for comparison; source 1672 × 941 was aspect-padded before normalization.
- State: authenticated desktop settings window, real assistant list loaded, non-default assistant selected, switch action available, current default restored to `莉莉安` after the end-to-end test.

## Findings

- No actionable P0, P1, or P2 mismatch remains in the final comparison.
- [P3] The selected assistant, avatar, standee, model and personality copy differ from the generated concept because the implementation renders live Core data. The information hierarchy, selection treatment and image slot match the source.
- [P3] The source uses a slightly denser paper texture. The implementation intentionally keeps the generated raster texture at low opacity so live standees and longer Chinese descriptions remain legible.
- [P3] Real assistant descriptions vary in length. The primary summary is constrained to one line with a native title affordance, and secondary rows truncate rather than shifting the action area.

## Required Fidelity Surfaces

- Typography and hierarchy: custom MonAgent title bar, serif display names, neutral Chinese interface text, muted metadata and orange current/selected accents follow the source.
- Layout: 28% assistant sidebar, back/search header, recent/all sections, selected leading rule, information table, notice card, primary action, secondary settings link and right-aligned full-body standee match the source composition.
- Assets: avatars and standees come from the actual Core assistant records. The background is a generated raster paper asset; Lucide supplies all visible interface icons.
- Interaction and accessibility: search is labeled, assistant rows expose listbox/option semantics, selected state is announced, window controls have accessible names, focus states are visible and the switch action reports loading, success and error states.

## Functional Verification

- Loaded four real assistants through `GET /api/assistants/` with avatars/standees and selected each row without losing current conversation history.
- Entered a live search query and verified the assistant list updates to the empty-result state.
- Switched the default assistant to `伊芙`; desktop bridge log confirmed `PATCH /api/assistants/4/ -> 200`.
- Switched the default assistant back to `莉莉安`; desktop bridge log confirmed `PATCH /api/assistants/3/ -> 200`.
- TypeScript typecheck: passed.
- Frontend unit tests: 16 passed.
- Production Vite build: passed; only the existing large-chunk advisory remains.
- Electron main-process syntax check: passed.
- Git whitespace validation: passed.

## Comparison History

### Iteration 1

- P2: the first implementation reused a ruled diary texture, omitted the custom title bar and placed the standee too close to the information table.
- Fix: added the working frameless title bar, generated a dedicated paper texture and repositioned the real standee.

### Iteration 2

- P2: Core personality/setting fields rendered as `[object Object]`, and the full-strength texture reduced text contrast.
- Fix: added structured text extraction with a literal-object guard, moved the texture to a low-opacity image layer and constrained information widths.

### Iteration 3

- P2: long live descriptions wrapped and shifted the primary action vertically.
- Fix: constrained the main summary to one line with truncation/title disclosure while retaining the complete live data for semantic access.

## Implementation Checklist

- [x] Match the selected first design direction with real MonAgent visual tokens.
- [x] Connect settings `更换` to a dedicated assistant-switcher page.
- [x] Load, search and select live assistant records.
- [x] Persist the selected default assistant through the desktop Core bridge.
- [x] Preserve conversation history and restore the user's original default after testing.
- [x] Compare source and implementation together and resolve all P0–P2 findings.

final result: passed

---

# 聊天输入 Token 指示器：设计 QA

## Evidence

- Source visual truth: `[LOCAL_HOME]/.codex/generated_images/019f6487-6371-7d90-b30b-eab4d14bfe85/exec-3afc00f0-8f1d-4a52-bd4c-4af9e935d185.png`
- Interaction override: the user's latest direction places the detail above the Token ring rather than to its left.
- Rendered implementation: `artifacts/design-qa/token-meter-implementation-hover-1920x936.png`
- Full-view comparison evidence: `artifacts/design-qa/token-meter-reference-vs-implementation.png`（上半部分）
- Focused region comparison evidence: `artifacts/design-qa/token-meter-reference-vs-implementation.png`（下半部分输入框裁切）
- Responsive evidence: `artifacts/design-qa/token-meter-responsive-1366x768.png`
- Viewport: implementation 1920 × 936 Electron content capture; responsive check 1366 × 768; source 1807 × 870.
- State: authenticated desktop chat, light theme, Token detail hovered, no text in final comparison; live conversation and current assistant artwork loaded.
- Primary interactions tested: typing updates the input estimate, hovering reveals the three-row detail above the ring, the ring and send action remain vertically aligned, and the narrow desktop layout preserves all composer controls.
- Console/runtime errors checked: no application exception observed during HMR and interaction capture; production build completed with only the existing Vite large-chunk advisory.

## Findings

- No actionable P0, P1, or P2 mismatch remains in the final comparison.
- [P3] The live input is empty in the final evidence, so the ring reads `0`, while the concept uses a 23-token example.
  Location: Token ring and `本次输入` detail row.
  Evidence: the earlier live input capture `artifacts/design-qa/token-meter-initial-input-state.png` shows the value changing to `11`; the final hover capture intentionally uses the settled empty state.
  Resolution: accepted as dynamic product state rather than visual drift.
- [P3] The implementation reports the runtime's real 256,000-token fallback rather than the concept's illustrative 128,000 limit.
  Location: `可用上限` row.
  Resolution: accepted because model-provided context-window metadata now overrides the fallback and the UI should not display fabricated model limits.
- [P3] The live conversation and assistant pose differ from the generated reference.
  Location: content behind the composer.
  Resolution: accepted as dynamic product content; the scoped composer composition and interaction state are the comparison target.

## Required Fidelity Surfaces

- Fonts and typography: the ring uses the existing neutral UI font, medium tabular numerals, and the tooltip follows the concept's compact two-column hierarchy. Labels remain muted and values retain stronger contrast without wrapping.
- Spacing and layout rhythm: the Token ring and send button share one right-edge vertical axis with a compact gap. The tooltip is right-aligned above the ring and stays inside the composer. Existing microphone, model selector, permission mode, and attachment controls retain their spacing at 1920 × 936 and 1366 × 768.
- Colors and visual tokens: the ring reuses the product's stone border and orange accent, the tooltip uses the existing card/border/text tokens, and the active send button keeps MonAgent orange. The disabled send state remains visually distinct.
- Image quality and asset fidelity: the feature introduces no new raster imagery or CSS illustration. The ring and send affordance use Lucide icons already present in the project; the actual assistant asset remains untouched.
- Copy and content: tooltip copy matches the selected three-row design: `本次输入`, `会话上下文`, and `可用上限`. Counts are localized and derived from live input, ordered message content, and runtime model metadata.
- Icons and surfaces: icon stroke weight, circular controls, border radius, and subtle card elevation are consistent with the existing composer and the selected design.
- Responsiveness: the 1366 × 768 capture shows no collision or clipping; the detail opens inward, while the vertical control stack remains usable at the right edge.
- Accessibility: the Token meter is a semantic button with a descriptive accessible label, `aria-describedby`, keyboard focus support, and hover/focus-within tooltip behavior. Numeric text remains visible without relying on color alone.

## Functional Verification

- Entered live text and observed the input estimate change from `0` to `11` without submitting.
- Hovered the ring and verified all three values render in the detail above the ring.
- Verified context usage is estimated from ordered message segments, reasoning, tool data, and image references.
- Verified the model API exposes `contextWindow`, honoring Core model configuration with a 256,000 fallback shared by frontend and runtime.
- Frontend unit tests: 13 passed.
- Server route unit tests: 4 passed.
- TypeScript typecheck: passed.
- Production Vite build: passed; only the existing large-chunk advisory remains.
- Python server package compile check: passed.

## Comparison History

### Iteration 1

- Earlier P2 finding: the first ring used Lucide's loader glyph, producing an almost complete orange circle and reading as an indefinite loading state instead of context usage.
- Fix: retained the Lucide circle icon but changed its standard stroke attributes to a short, rounded arc driven by context-window percentage.
- Post-fix visual evidence: `artifacts/design-qa/token-meter-implementation-hover-1920x936.png` and the focused lower half of `artifacts/design-qa/token-meter-reference-vs-implementation.png`.

### Iteration 2

- Earlier P2 finding: the first tooltip included a fourth explanatory footer, increasing its height and drifting from the selected three-row concept.
- Fix: removed the extra footer while keeping the estimate semantics in the accessible label and implementation behavior.
- Post-fix visual evidence: the final three-row tooltip in `artifacts/design-qa/token-meter-reference-vs-implementation.png`.

### Iteration 3

- User-directed layout change: move the hover/focus detail from the left side to above the Token ring.
- Fix: right-aligned the detail above the ring, changed the entrance motion to vertical, and moved the pointer to the lower edge so it points down to the ring.
- Post-fix visual evidence: `artifacts/design-qa/token-meter-implementation-hover-1920x936.png` and `artifacts/design-qa/token-meter-reference-vs-implementation.png`.

## Implementation Checklist

- [x] Place the Token ring above the send button on one vertical axis.
- [x] Update the input estimate live without sending the message.
- [x] Show context usage and model limit in a hover/focus detail above the Token ring.
- [x] Read the context-window limit from runtime model configuration with a shared fallback.
- [x] Preserve all existing composer actions and the compact desktop-pet input.
- [x] Verify target, hover, empty, typed, and narrow desktop states.
- [x] Pass frontend tests, server route tests, typecheck, production build, and visual comparison.

## Follow-up Polish

- Exact provider tokenization can replace the current deterministic estimate later if the runtime exposes tokenizer-specific counts; the UI contract does not need to change.

final result: passed

---

# 全局提问确认层：设计 QA

## Evidence

- Source visual truth: `[LOCAL_HOME]/.codex/generated_images/019f6487-6371-7d90-b30b-eab4d14bfe85/exec-c10fecdd-0ba8-4333-91ff-2ad4da2c2955.png`
- Rendered implementation: `artifacts/design-qa/question-decision-overlay-implementation-final.png`
- Full-view comparison evidence: `artifacts/design-qa/question-decision-overlay-comparison-full-final.png`
- Focused region comparison evidence: `artifacts/design-qa/question-decision-overlay-comparison-focus-final.png`
- Viewport: source 1750 × 894; Electron implementation normalized from 1920 × 981 content to 1750 × 894 for comparison.
- State: authenticated desktop chat, one real `ask_user` request, single choice, no selection, optional supplement empty.
- Capture method: running Electron renderer captured from the active MonAgent window; source and normalized implementation were joined into the same full and focused comparison images.

## Findings

- No actionable P0, P1, or P2 mismatch remains in the final comparison.
- [P3] The implementation uses MonAgent's existing `#d97706` accent token, which is slightly darker than the generated concept's orange.
  Location: confirmation button and selected state.
  Resolution: accepted to preserve the product design system and consistency with the chat header controls.
- [P3] The live background contains the current conversation and active character action rather than the concept's empty-chat copy and neutral standee.
  Location: dimmed application content behind the dialog.
  Resolution: accepted as dynamic product content; the 66/34 chat-character composition, warm scrim, blur, and modal placement match the source.

## Required Fidelity Surfaces

- Fonts and typography: the eyebrow, Chinese display question, option labels, descriptions, optional-note label, input copy, and actions follow the source hierarchy and the existing Helvetica/Arial/system and serif fallbacks. Wrapping and line-height match at the target state.
- Spacing and layout rhythm: centered 32vw decision panel, 74.5vh frame, measured internal padding, full-width choice rows, compact no-description row, divider, textarea, full-width primary action, and quiet rejection action align with the focused comparison. The single-question scrollbar is visually suppressed while multi-question dialogs remain scrollable.
- Colors and visual tokens: warm translucent scrim, white panel, stone borders and text, subtle elevation, amber focus/selection, and product orange primary action map to current project tokens with legible contrast.
- Image quality and asset fidelity: the implementation reuses the real current character asset and underlying application. No placeholder, handcrafted SVG, CSS illustration, emoji, or fake raster asset was introduced.
- Copy and content: the real `ask_user` header, question, option labels, option descriptions, and custom-answer capability populate the overlay. Empty descriptions remain empty instead of being duplicated from the option label.
- Accessibility and interaction: the layer is an `aria-modal` dialog, traps Tab focus, restores focus after closing, supports native radio/checkbox semantics, validates incomplete submissions, exposes an alert on failure, and maps Escape to the quiet rejection path.
- Responsiveness: viewport-relative sizing preserves the source proportions at the Electron target; the panel has a narrow-screen minimum/maximum width and internal scrolling for longer or multi-question requests.

## Functional Verification

- Triggered a real `ask_user` call from the running Python AgentCore chain and confirmed the global overlay appeared outside the message/composer layout.
- Selected `直接修改` with the keyboard, submitted it, and verified the pending question disappeared, the tool resumed, and the assistant returned `提问链路测试完成：直接修改`.
- Triggered another real question, pressed Escape, and verified the reject endpoint released the waiting tool and removed the overlay.
- Restarted the Python server, rehydrated a pending question after renderer reload, and confirmed the global layer restores from `/question` state.
- Verified a missing option description remains an empty string through the server payload and renders as the compact source row.
- Server unit suite: 84 tests passed.
- TypeScript typecheck: passed.
- Production Vite build: passed; only the existing large-chunk advisory remains.
- Git whitespace validation: passed for the root, frontend, and Server worktrees.

## Comparison History

### Iteration 1

- Earlier P1: the prior question UI lived above the composer, resized the chat grid, and duplicated the interaction on page-specific surfaces.
- Fix: mounted one ordered question overlay at the App root and removed the chat-page question cards while preserving the compact desktop-pet surface.
- Post-fix evidence: `artifacts/design-qa/question-decision-overlay-runtime-v2.png` showed the correct global scrim and centered decision composition.

### Iteration 2

- Earlier P2: fixed-pixel sizing rendered the panel roughly twice as large under the Electron display scale, clipping most choices and actions.
- Fix: converted the panel, type, row, and spacing geometry to the app's viewport-relative system and aligned the modal to the reference's 32vw placement.
- Post-fix evidence: `artifacts/design-qa/question-decision-overlay-selected.png` showed the full panel and working selected state without content clipping.

### Iteration 3

- Earlier P2: the disabled primary action was gray, empty option descriptions were repeated from labels, modal height was short, and the single-question body exposed a scrollbar.
- Fix: kept the primary action orange with inline validation, preserved empty descriptions in the interaction tool payload, added compact no-description rows, matched the measured 74.5vh frame, and suppressed the redundant single-question scrollbar.
- Post-fix evidence: `artifacts/design-qa/question-decision-overlay-comparison-full-final.png` and `artifacts/design-qa/question-decision-overlay-comparison-focus-final.png` show the corrected same-state composition.

## Implementation Checklist

- [x] Replace page-local question cards with one global blocking decision layer.
- [x] Preserve real reply/reject endpoints and sequential pending-question behavior.
- [x] Match source geometry, typography, warm scrim, choices, supplement field, and actions.
- [x] Support keyboard focus, validation, rejection, multi-select, custom answers, and multi-question scrolling.
- [x] Verify both submit and reject paths against the running Python agent runtime.
- [x] Pass source/rendered comparison, tests, typecheck, build, and whitespace checks.

## Follow-up Polish

- A future pass can tune the accent token globally if MonAgent adopts the concept's brighter orange across the whole product; this component intentionally does not introduce a one-off hue.

final result: passed

---

# 备忘录时间轴工作台：设计 QA

## Evidence

- Source visual truth: `文档/参考/设计思路/备忘录设计方案/02-时间轴工作台.png`
- Implementation target: `frontend/web/src/pages/memo/MemoPage.tsx`
- Rendered implementation: `artifacts/design-qa/memo-timeline-1730x909-final.png`
- Exact-size full comparison: `artifacts/design-qa/memo-timeline-reference-vs-final.png`
- Focused detail comparison: `artifacts/design-qa/memo-timeline-detail-reference-vs-final.png`
- Editor interaction state: `artifacts/design-qa/memo-timeline-edit-state.png`
- Viewport: 1730 × 909, matching the reference image exactly.
- State: real Electron application, current authenticated memo data, archived-status filter, all memo types, email/QQ reminder selected.

## Findings

- No actionable P0, P1, or P2 visual mismatch remains in the tested master-detail state.
- [P3] The live dataset contains no active future reminder, so the top strip correctly shows an empty reminder state instead of the reference's scheduled reminder. This is real data variation, not layout drift.
- [P3] Live memo dates are July 6–7 rather than the reference's July 7 and July 16 grouping. Group ordering, time ordering, selection, and metadata formatting follow the same design behavior.
- [P3] The Linux native Electron title bar is slightly taller than the reference environment's title bar. The application content below it is proportioned to the same 1730 × 909 outer viewport.

## Required Fidelity Surfaces

- Fonts and typography: serif display titles and memo names reproduce the paper-workspace character; sans-serif controls and metadata keep the existing MonAgent type system.
- Spacing and layout rhythm: the implementation matches the reference's approximately 32/68 master-detail split, compact left controls, grouped timeline rows, large reading field, and metadata cadence.
- Colors and visual tokens: warm paper white, stone text, faint neutral borders, pale amber selection, and orange action accents use existing project tokens and assets.
- Image quality and asset fidelity: the existing high-resolution memo background and diary paper texture are reused. All interface symbols use the project's Lucide dependency; no placeholder, emoji, CSS illustration, handcrafted SVG, or fake asset was introduced.
- Copy and content: the UI uses current API memo titles, bodies, reminder timestamps, creation timestamps, types, and statuses instead of hard-coded screenshot data.
- Responsiveness and overflow: the outer view remains fixed to the usable desktop space; the timeline and reading article own independent internal scroll regions.

## Functional Verification

- Clicking a timeline row updates the selected rail, title, body, and all metadata fields in the right reader.
- Double-clicking a row or clicking `编辑` opens the existing paper editor with the selected memo's real values.
- Closing the editor returns to the same selected timeline item without losing state.
- Search, status filter, type filter, refresh, create, save, complete, archive, and snooze behavior remain connected to the existing API implementation.
- Targeted oxlint: 0 errors and 0 warnings.
- TypeScript typecheck: passed.
- Production Vite build: passed.
- Git whitespace validation: passed.
- Build emitted only the existing Vite large-chunk advisory.

## Comparison History

### Iteration 1

- P1: the previous memo page used a three-column paper-card wall and had no persistent reading surface.
- Fix: rebuilt the page as a grouped timeline master list plus a full-height detail reader while preserving the real API and editor.

### Iteration 2

- P2: the first runtime render defaulted to an empty active filter and selected a different live record from the reference content.
- Fix: aligned the current four-record archived state, added stable grouped ordering and selection, and selected the matching email/QQ reminder for comparison.

### Iteration 3

- P2: the first side-by-side pass had a wider left column, full-width filters, a denser paper texture, and undersized detail typography.
- Fix: matched the 32.2vw column width, compact filter footprint, lighter paper treatment, lower title start, and larger title/body/metadata scale.

## Implementation Checklist

- [x] Match the selected time-axis master-detail composition.
- [x] Keep current memo API data, filters, refresh, selection, creation, editing, and lifecycle actions.
- [x] Use independent internal scrolling for the timeline and paper reader.
- [x] Perform exact-size source/rendered comparison and focused detail comparison.
- [x] Verify timeline selection and editor open/close interactions in Electron.
- [x] Pass lint, typecheck, production build, and whitespace validation.

final result: passed

---

# 自醒日记目录阅读台：设计 QA

## Evidence

- Source visual truth: `文档/参考/设计思路/自醒日记/01-日记目录阅读台.png`
- Rendered implementation: `artifacts/design-qa/self-awake-diary-1672x941-final.png`
- Same-input source/render comparison: `artifacts/design-qa/self-awake-diary-reference-vs-final.png`
- Search state: `artifacts/design-qa/self-awake-diary-search-state.png`
- Day expansion and selection state: `artifacts/design-qa/self-awake-diary-expanded-day-state.png`
- Viewport: source and implementation are both 1672 × 941 Electron-window captures.
- State: authenticated local user, real self-awake records, `日记` selected, 2026 / 07 expanded, July 14 expanded, completed diary selected.

## Findings

- No actionable P0, P1, or P2 mismatch remains in the final comparison.
- [P3] The rendered title, diary text, timestamps, and per-day counts differ from the concept because the implementation uses current server records rather than frozen mock content. The selected date, hierarchy, density, and reading composition match the reference state.
- [P3] Linux window decoration renders a 64px native title bar, while the concept capture uses a roughly 54px title bar. The application header and all content below it preserve the reference proportions.
- [P3] The current dataset contains ten July 14 entries rather than five. The UI intentionally shows the first three entries plus an ellipsis, matching the reference's compact directory treatment while preserving access through pagination.

## Required Fidelity Surfaces

- Typography: compact sans-serif directory metadata, serif date/title/body reading hierarchy, muted author metadata, and reference-scale body leading.
- Layout rhythm: seamless 31.8vw / flexible split, flat directory tree, fixed header, full-height paper reader, dashed separators, and compact footer metadata.
- Colors and visual tokens: warm paper canvas, white directory pane, orange selection/accent, emerald completion badge, stone borders, and restrained shadows.
- Asset fidelity: the existing high-resolution MonAgent paper background and Lucide icon library are reused; no placeholder, emoji, handcrafted SVG, or CSS illustration was introduced.
- Responsiveness and overflow: the page uses viewport-relative sizing, independent directory/reader scrolling, stable scrollbar gutters, truncation for long row titles, and no minimum page dimensions.

## Functional Verification

- Overview/diary segmented navigation works in the running Electron client.
- Year, month, and day rows expand and collapse; opening July 14 selects its latest visible diary and updates the reading pane.
- Diary rows select real records and update date, title, author/time, content, status, next wake, and action metadata.
- Search accepts input, updates the result state through the existing API path, shows an intentional empty state, and clears back to the directory.
- Refresh and paginated “加载更多” retain their existing handlers.
- TypeScript typecheck: passed.
- Production Vite build: passed; only the existing large-chunk advisory was emitted.
- Targeted oxlint: 0 warnings and 0 errors.
- Runtime smoke check: no renderer exception or Vite error overlay; only known Electron X11 atom-cache diagnostics appeared.

## Comparison History

### Iteration 1

- P1: the previous diary view used separated rounded cards and lined notebook paper, which did not match the seamless directory-and-reader composition.
- Fix: rebuilt the diary branch as a flat 31.8/68.2 split with a white directory pane and full-height warm paper reader while preserving live data and handlers.

### Iteration 2

- P2: the initial rendered title and body were oversized, the single-day list was too dense, and the paper asset showed an obvious desktop corner.
- Fix: matched the date-stamp geometry, reduced title/body scale and leading, limited expanded days to three entries plus an ellipsis, and softened the background asset with a higher-opacity paper veil.

### Iteration 3

- P2: the first comparison still showed body copy larger than the reference and did not exercise the target July 14 branch.
- Fix: reduced the reader scale once more, opened July 14 in the live Electron client, verified selection behavior, and recaptured at the exact 1672 × 941 reference size.

## Implementation Checklist

- [x] Match the selected seamless directory/reader composition.
- [x] Preserve real records, search, tree expansion, selection, refresh, and pagination.
- [x] Match the date stamp, completion badge, paper surface, separators, and footer metadata.
- [x] Compare source and rendered implementation together at the same viewport.
- [x] Verify search and day-selection states in the actual Electron client.
- [x] Pass typecheck, production build, targeted lint, and runtime smoke checks.

final result: passed

---

# 自醒观察报告：设计 QA

## Evidence

- Source visual truth: `文档/参考/设计思路/自醒/02-观察报告.png`
- Rendered implementation: `artifacts/design-qa/self-awake-observation-report-v3.png`
- Same-size side-by-side comparison: `artifacts/design-qa/self-awake-observation-report-comparison-final.png`
- Focused content comparison: `artifacts/design-qa/self-awake-observation-report-focus-final.png`
- Normalized viewport: 1672 × 941.
- State: authenticated user, real self-awake API records, overview selected, latest successful restart wake displayed.

## Findings

- No actionable P0, P1, or P2 mismatch remains.
- [P3] Live content length differs from the reference because the implementation renders the currently selected self-awake record instead of mock copy; the report hierarchy and overflow behavior remain equivalent.
- [P3] The current capture shows newer retry/startup events and a later next-wake timestamp. These are dynamic backend values and are intentionally preserved.
- [P3] The implementation uses the existing MonAgent background texture at very low contrast; the reference is nearly white. The resulting hierarchy remains visually equivalent without replacing the product asset.

## Required Fidelity Surfaces

- Header: compact title block, segmented overview/diary navigation, refresh action, and current-user control.
- Summary strip: current wake time/type/status on the left and next wake on the right.
- Recent list: date grouping, active orange marker and tint, event metadata, time, scrolling, and incremental loading.
- Observation report: title and actor, summary callout, full work diary, action result, current judgment, observation facts, follow-up schedule, and expandable raw data.
- Responsive proportions: the body uses proportional grid columns and viewport-relative spacing/type; no minimum page dimensions were introduced.

## Functional Verification

- Recent records remain selectable and drive every detail surface from the real API record.
- “查看更多” continues paginated loading through the existing request path.
- “查看原始数据” expands/collapses the selected record payload and resets when the selection changes.
- Overview/diary navigation and refresh retain their existing handlers.
- TypeScript typecheck: passed.
- Production Vite build: passed.
- Git whitespace validation: passed.
- Production build emitted only the existing large-chunk advisory; no build error occurred.

## Comparison History

### Iteration 1

- P1: the old overview used a dense review-desk dashboard and exposed raw nested context as the primary content.
- Fix: replaced it with the reference's recent-record list and observation-report reading layout while retaining live data.

### Iteration 2

- P2: header, cards, and background were visually heavier than the reference.
- Fix: reduced the header height and radii, simplified the segmented tabs, flattened the report card, and raised the neutral background overlay.

### Iteration 3

- P2: the report needed clearer separation between narrative and facts.
- Fix: assigned stable proportional columns, introduced orange section rules, and aligned judgment/facts/follow-up as a dedicated right rail.

final result: passed

---

# 自醒双栏审阅台：设计 QA

## Evidence

- Source visual truth: `文档/参考/设计思路/自醒/03-双栏审阅台.png`
- Rendered implementation: `artifacts/design-qa/self-awake-overview-implementation-v4.png`
- Full-view side-by-side comparison: `artifacts/design-qa/self-awake-overview-comparison-final.png`
- Interaction-restored capture: `artifacts/design-qa/self-awake-overview-interactions-final.png`
- Source viewport: 1672 × 941. Runtime capture: 1920 × 1080 with a 1920 × 1000 Electron work area and an 80px operating-system panel. The comparison crops the system panel and normalizes the work area to the source dimensions.
- State: real authenticated user, real self-awake records, `概览` selected, all records visible, completed run selected.

## Findings

- No actionable P0, P1, or P2 mismatch remains in the final comparison.
- [P3] The selected record copy and the number of records per date differ from the concept because the implementation renders current server data rather than mock rows. The table density, grouping, hierarchy, and column geometry remain faithful.
- [P3] The native Electron title bar is slightly taller than the concept title bar. The product window chrome is preserved; the application header below it matches the reference hierarchy and keeps the main 34/66 split aligned.
- [P3] The concept shows a custom abstract app mark, while the implementation uses MonAgent's existing Lucide spark identity to stay within the established product icon system.

## Required Fidelity Surfaces

- Fonts and typography: compact Chinese system sans-serif for operational data, serif display treatment for titles, clear metadata hierarchy, single-line table truncation, and controlled two-line detail truncation.
- Spacing and layout rhythm: 35.5vw master column, flexible detail column, compact header, grouped record table, three-step review flow, balanced observation/result panels, and a bottom diary summary all fit without overlap.
- Colors and visual tokens: warm paper workspace background, white review cards, stone borders, orange selection/accent, emerald completion state, and muted secondary data reuse existing project tokens.
- Image quality and asset fidelity: the existing high-resolution paper background is reused. All interface symbols use the project's Lucide dependency; no placeholder, emoji, CSS illustration, handcrafted SVG, or fake asset was introduced.
- Copy and content: raw context JSON is replaced with structured event and environment facts. Current desire, action result, next wake time, interval reason, and diary data come from the real API response.
- Responsiveness and overflow: the main page uses proportional `vw`/`vh` sizing, stable internal scroll regions, and explicit shrink behavior. The observation/result cards and diary summary no longer overlap at the tested Electron work area.

## Functional Verification

- Record filters (`全部`, `重启`, `定时`, `异常`) update the visible master list and keep selection valid.
- Selecting a record refreshes every detail surface, including missing-context fallbacks.
- Work-diary summary expands and collapses; the three factual summary lines remain visible in the compact state.
- `概览` and `日记` tabs navigate correctly and return without losing the selected record.
- Runtime stream after interaction showed successful API presence requests and no renderer exception or Vite error overlay.
- TypeScript typecheck: passed.
- Production Vite build: passed.
- Git whitespace validation: passed.
- Build emitted only the existing Vite large-chunk advisory.

## Comparison History

### Iteration 1

- P2: the original overview used metric cards plus a raw context block and did not match the selected master-detail concept.
- Fix: rebuilt the overview as a grouped review table, three-step decision flow, structured observation facts, result panel, and diary summary while preserving the live API.

### Iteration 2

- P1: increasing the diary summary height caused the flexible fact panels to shrink while their contents overflowed behind the diary card.
- Fix: made the fact grid non-shrinking, reduced its internal vertical density to the reference proportions, and kept the detail column's internal scroll boundary.

### Iteration 3

- P2: title punctuation, account affordance, result summary, and diary density differed visibly from the reference.
- Fix: normalized middle-dot spacing, restored the user icon, preferred the current desire for the review conclusion, and composed three real structured diary facts.

## Implementation Checklist

- [x] Match the selected 34/66 master-detail composition.
- [x] Keep real self-awake records, filters, selection, diary navigation, and refresh behavior.
- [x] Replace raw JSON with readable structured context facts.
- [x] Match the review flow, observation/result cards, and diary summary.
- [x] Perform same-input source/rendered visual comparison and interaction regression.
- [x] Pass typecheck, production build, runtime smoke check, and whitespace validation.

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
