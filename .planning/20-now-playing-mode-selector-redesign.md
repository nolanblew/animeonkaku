# Now Playing — playback-mode selector redesign

**Status:** ✅ Implemented and verified on device
**Date:** 2026-07-28
**Branch:** `feature/media-catalog-initiative`
**Scope:** Android only (`src/`). No server change.
**Evidence:** `artifacts/nowplaying-mode-selector-before.png` (device
`28301FDH300ERZ`, 1440×3120 @ 560dpi, captured live before any change)

---

## 1. The problem, from the device

The TV Size / Full Size / Video selector is a segmented pill **floated on top of
the album artwork**:

- `PlayerScreen.kt:326` — `modeSelector: { top: ['art', 'top', 8] }`, combined
  with `.zIndex(1f)` at `PlayerScreen.kt:377`, deliberately overlays the art.
- `PlayerModeControls.kt:85` — the row paints an `Ink900 @ 78%` capsule, and
  `:112` fills the active chip with `Rose500`.

Three distinct problems follow:

1. **It occludes the hero image.** On the captured frame the capsule covers the
   top ~12% of the artwork and crops the characters' heads. The artwork is the
   single most important element on this screen and it is the one thing being
   covered.
2. **It carries far too much visual weight.** A saturated `Rose500` fill is the
   loudest colour on the screen — louder than the play button — for a control
   the user touches perhaps once per session. It competes with the title and the
   transport row for first fixation.
3. **It is permanently expanded.** All three options are always rendered, so a
   rarely-used control occupies a full-width band at the top of the art whether
   or not the user cares about it.

## 2. Decisions

Confirmed with the user before planning:

- **Placement:** inline in the existing `anime · ED` eyebrow row, as a third
  tappable segment. Chosen over a dedicated row or a top-bar chip because it
  costs **zero extra vertical space** and the mode is a property of the track,
  which is exactly what that row already describes.
- **Chooser:** a `DropdownMenu` anchored to the chip, listing the available
  modes with a check on the active one. Light, in-context, no modal surface for
  a two-to-three item choice.

Target:

```
 ←        Now Playing              ⋮
 ┌──────────────────────────────────┐
 │            ARTWORK               │   ← fully unobstructed
 └──────────────────────────────────┘
   I Want to End This… · ED · Full Size ⌄
              Little World
               PompadollS
```

## 3. What changes

### 3.1 `PlayerModeControls.kt` — replace the segmented row

`PlayerModeSelector` (the segmented capsule) is replaced by `PlayerModeChip`:

- Text-only, no filled background, no capsule. `labelLarge` to match the
  sibling eyebrow text, `Mist200` to sit at the same emphasis as the `ED` tag —
  deliberately *quieter* than the cyan anime name.
- Label is the **current actual mode** plus a small chevron, so the current
  state stays readable at a glance without opening anything.
- Retains `minimumInteractiveComponentSize()` so the touch target stays ≥48dp
  even though the visual footprint is small.
- Opens a `DropdownMenu`; each item is `Role.RadioButton` with a leading check
  on the active mode, preserving the existing selection semantics.

### 3.2 Move it out of the MotionLayout overlay

- Delete the `modeSelector` `layoutId` Box (`PlayerScreen.kt:376-395`) and its
  `zIndex(1f)`.
- Delete the `modeSelector` entries from **both** constraint sets
  (`PlayerScreen.kt:311` start, `:326` end). Nothing else references that id —
  it only referenced `art` — so removal is safe.
- Render the chip inside the eyebrow `Row` in the `titles` block
  (`PlayerScreen.kt:525-557`). It is already wrapped in `if
  (isExpandedThreshold)`, so the chip is naturally absent from the mini player
  and the old `isExpanded` gate is no longer needed.

### 3.3 Layout safety in the eyebrow row

The anime name is a `MarqueeText` with `weight(1f, fill = false)`. Adding a
third element needs care so a long title cannot squeeze the chip out:

- The chip wraps its content and does **not** take weight.
- The anime name keeps the flexible weight and marquees as it does today.
- The row's render condition widens from `eyebrowAnimeName != null ||
  eyebrowThemeTag != null` to also include the chip, so a track with a mode but
  no eyebrow metadata still shows it.

### 3.4 `retainedIntentText` must not be lost

Today `"Full Size preferred · playing TV Size"` renders as a live-region line
under the segmented control. It cannot occupy its own line in the new design,
so:

- The chip's `stateDescription` carries the text, preserving the polite
  live-region announcement for screen readers.
- The text renders as a non-interactive header inside the dropdown, so the
  explanation is available exactly when the user is looking at the choice.

## 4. Deliberate behaviour change — flagged for veto

**When fewer than two modes are available, the chip renders nothing at all.**
Today the segmented control still renders, showing a single option.

Rationale: a chooser with one choice is not a control, and the eyebrow row is
scarce space. This is likely to be the *common* case — a theme with no imported
full song has only `TV_SIZE` — so it meaningfully cleans up the default screen.

Cost: for those tracks the user no longer sees which mode is playing. The `ED`
tag still identifies the track, and the mode is not actionable, so the lost
information is low value.

This is implemented as a small pure function with its own test, so it is a
one-line flip if the call is wrong.

## 5. What must not change

- `derivePlayerModeUiState` and `selectionDecision` are pure state logic covered
  by `PlayerModeUiStateTest`. **No semantic change** — this is a presentation
  refactor only.
- The NSFW/spoiler confirmation path. `ModeSelectionDecision.Confirm` still
  routes through `pendingModeConfirmation`; the chip reuses the identical
  callback body from `PlayerScreen.kt:383-393`.
- Video/fullscreen behaviour, `VideoModeSessionTracker`, and the landscape
  overlay are untouched.
- Debug-only gating elsewhere on the screen is untouched.

## 6. Tests

- `PlayerModeUiStateTest` — unchanged, must stay green (proves no state-logic
  regression).
- New unit test for the "fewer than two options renders nothing" rule.
- `PlayerModeControlsTest` (androidTest) currently drives `PlayerModeSelector`
  at lines 37 and 79 — rewritten against `PlayerModeChip`: chip shows the
  current mode; tapping opens the menu; selecting emits the mode; the active
  mode is marked selected; `retainedIntentText` is exposed.

## 7. Verification

- `./gradlew.bat --no-daemon test` — full unit suite (503/503 at last
  acceptance).
- `./gradlew.bat --no-daemon assembleDebug` and `compileDebugAndroidTestKotlin`
  so the instrumented test keeps compiling.
- **Reinstall on device `28301FDH300ERZ` and capture an after screenshot** of
  the same screen, plus the dropdown open, to prove the artwork is unobstructed
  and the control is still discoverable.

## 8. Outcome

Unit suite **512 tests, 0 failures, 0 errors**, including the two new
`showsModeChip` cases. `compileDebugAndroidTestKotlin` and `installDebug` both
green.

Verified live on `28301FDH300ERZ`, same track as the before shot:

| Artifact | Shows |
|---|---|
| `artifacts/nowplaying-mode-selector-before.png` | the capsule cropping the characters' heads |
| `artifacts/nowplaying-mode-selector-after.png` | artwork fully unobstructed; `… · ED · Full Size ⌄` in the eyebrow row |
| `artifacts/nowplaying-mode-selector-menu.png` | dropdown open, check on the active mode |
| `artifacts/nowplaying-mode-selector-switched.png` | switched to TV Size |

Switching was proven functional, not merely cosmetic: selecting TV Size changed
the track duration from **3:08 to 1:29**, so the media source actually swapped.
The device was returned to Full Size afterwards.

### Defect found and fixed during device verification

The first build rendered the dropdown as a **white card on the dark player** —
visible in an intermediate capture. Cause: Now Playing paints its own
`Ink`/`Mist` palette unconditionally, but `DropdownMenu` is a popup that reads
the ambient `MaterialTheme.colorScheme`. `Theme.kt` picks its scheme from the
system setting, and the test device is in light mode, so the menu correctly
followed a light scheme onto a hardcoded-dark screen.

Fixed by pinning the menu's `surface`/`surfaceContainer`/`onSurface`/
`onSurfaceVariant` to the dark palette locally rather than depending on the
system theme.

**This is a latent bug class worth knowing about:** any other M3 popup or
dialog hosted by this screen (or any other hardcoded-palette screen) will have
the same problem on a light-mode device. Not fixed here — out of scope — but
worth a sweep if light-mode users are in scope.

Chip horizontal padding was also trimmed 6dp → 2dp so the `·` separators space
evenly with the existing eyebrow items.

---

## 9. Follow-up — artwork centring and vertical fit

Reported after the above shipped: the artwork was visibly off-centre, and the
header sat too low.

### 9.1 Why the artwork was off-centre

Measured from a device capture: the card spanned x=84→1259 on a 1440px screen,
so **24dp on the left and 51dp on the right**. Not a rounding artifact — the art
was hard against the left edge of its container.

Cause: each `HorizontalPager` page lays its content out **top-start** by default.
The art `Box` is a fixed `artSize`, and whenever that is narrower than the page —
which is any time the size cap binds — it hugged the left edge and left all the
slack on the right. Nothing centred it; the `contentAlignment = Center` on the
outer `layoutId("art")` box applies to the pager, not to content inside a page.

Fixed by wrapping each page's art in a `fillMaxSize` box with
`contentAlignment = Alignment.Center`. Verified at 71px/70px margins, and still
centred after paging and after a video → music round trip (the path in the
original report).

### 9.2 Header height and shared margin

`endTopMargin` went from `topInset + 16` to `topInset + 6`, so the header sits
just clear of the status bar instead of floating mid-gap.

`PLAYER_CONTENT_MARGIN_DP = 20` is now shared by the artwork inset and the seek
bar's constraint, so the two edges cannot drift apart. This is the artwork's
*minimum* margin — the most it is ever allowed to grow.

### 9.3 Artwork is now the flexible element

Second report: with the artwork at its width-bound maximum the reaction row was
pushed down against the Up Next card.

`expandedPlayerArtworkSize` now takes the available height and returns
`min(widthBound, availableHeight - PLAYER_STACK_BELOW_ART_DP)`, clamped to
[200dp, 400dp]. The artwork yields to the control stack rather than the other way
round.

**`configuration.screenHeightDp` includes the system bars** — established
empirically, not assumed: a probe build with a deliberately oversized reserve
rendered 331dp artwork, giving `891dp` on a 1440×3120 @ 560dpi device, which
matches the full window height rather than the inset-excluded height. Worth
knowing before anyone reuses that value.

`PLAYER_STACK_BELOW_ART_DP = 545` yields 346dp artwork on the reference device —
slightly larger than the original 336dp, with the reaction row comfortably clear
of Up Next. On this device the height bound binds, so the artwork's margins
(33dp) are wider than the 20dp minimum; on a taller window it grows until the
20dp margin binds instead.

Final state: 512 unit tests, 0 failures. Artwork centred at 115px/114px.
