# Circé verification record

## Pond 2.2.0 upgrade — 2026-11-01

The integration advances the upstream base from `a1f7cdd0` to `60b40a9a`
(97 commits, including Pond 2.1.0 and 2.2.0). `main` remains an upstream
mirror; Circé's browser adapters, Library identity, branding and host actions
are retained on `web`. The three new `web-upgrade-*-cases.cjs` modules run
through `smoke-web-browser.cjs --upgrade-220` and are included in the existing
isolated browser CI runner.

The browser acceptance uses actual Chromium pointer/keyboard input and the
authenticated HTTP bridge to a rebuilt Electron host. Its disposable Library
is separate from the user's Twitter Library. Fixtures replace external feed
and model services; they do not replace the renderer, transport, persistence,
Markdown renderer or host execution pipeline.

| New behavior | Verification |
| --- | --- |
| RSS feed Watch | Actual New menu, Watch dialog, ingestion, stored files, ownership and reload; repeat sync deduplicates. |
| Atom and invalid feeds | Authenticated HTTP checks of relative URLs, invalid schemes and non-feed HTML. |
| Re-save from Trash | Actual browser Trash and Import from Links actions restore the original Save ID and saved date. |
| Marked Source | Actual New Source connection UI reaches extension pairing. Live authentication/library sync is unverified. |
| Fish faces | Actual picker controls cover all 15 species and 15 colors at phone width; reload agrees with host persistence. SVG frame sampling verifies idle/hover movement and reduced-motion stability. |
| Routine list | A weekly paused routine is seeded only in the fixture Fish. Actual phone-width Resume, Pause, reload and detail controls persist correctly. Routine creation and timed execution are not claimed by this case. |
| Reply rendering and scrolling | A loopback OpenAI-compatible fixture uses the real validated host stream and read-only search tool. Trusted wheel input moves the conversation up; later chunks preserve position; Read Latest Response resumes following. Code, tables, unsafe-link/HTML filtering, persistence and phone layout are checked. |
| Automatic startup asks | The real 20-second startup toast appears without a modal; its visible Not Now control dismisses it and records the dismissal. |

An initial chat-scroll test could send the wheel over the overlapping Fish
details panel. It now checks the target's actual hit-test ancestry, focuses
the test window, starts from the bottom with no follow button, and requires
measured upward scrolling before accepting the released-follow state. No
production scroll behavior or assertion was disabled to pass this check.
Screenshot review also caught that a persisted table's DOM presence alone
did not prove phone visibility. The phone case now closes the details panel,
uses Read Latest Response when needed after resizing, and requires the table
to fit onscreen and pass an unobstructed hit test before capturing evidence.

Existing regressions also passed: authenticated core/media/network/parity,
imports and package round trips, Canvas exports, browser Save editing,
physical folder drag and Undo, image mouse navigation, imported-from filters,
stable bulk pagination, and browser side-button history under `Win32` and
`MacIntel` platform emulation. These runs use macOS Chromium; physical Windows
and iPad acceptance and live Source/provider credentials remain separate.
Library identity checks also pass actual browser file selection, invalid-image
handling, favicon updates, icon/emoji reset, name and combined identity edits,
reload and supervised host-restart reconnection, then restore the fixture
Library's original identity.

The first pushed CI runs passed repository checks and builds but did not pass
the whole browser matrix. One stopped while replacing the settings name; the
other passed identity, release checks, Sources, Fish and chat rendering/scrolling
before timing out at the startup toast. That case's wait used the same 20-second
deadline as the real toast's delay. It now allows 35 seconds only at that
explicit delayed-UI boundary; other browser waits and unit-test deadlines are
unchanged. Identity text replacement now observes the completed native Select
All command before sending IME text, retaining its exact-value assertion and
adding failure diagnostics. CI retains selected fixture failure screenshots
and text, excluding profiles and credentials.

The cancelled desktop smoke was restarted. Its first attempt blocked inside
macOS Keychain access, confirmed by a native process sample. The isolated
`smoke:desktop` command now passes Electron's `--use-mock-keychain` flag, as
the other fixture runners already do. Visible startup and preload checks pass;
production Keychain behavior and security settings are unchanged.

Repository gates passed:

- Frozen-lockfile installation, typecheck, full production build, separate
  browser build and Circé extension build. Both extension manifests report
  2.2.0 and retain their respective Pond/Circé names. All bundle budgets pass
  within the limits carried by the upstream release.
- `pnpm check`: 28/28 tasks passed, 730 desktop files passed/five skipped;
  5,156 desktop tests passed/47 skipped, with zero failures. Duration 4m54s.
  Existing non-failing React `act()` warnings remain. Lint, Oxlint,
  architecture, unused-code, generated-file and type checks passed.
- Electron ABI database/vector checks: two files/eight tests passed.
- React Doctor 0.9.21, upgrade changes against the pre-merge `HEAD`: 70/100,
  33 non-blocking advisories, no errors. Most concern upstream shared-component
  exports, component complexity and animation imports. Its RAF-cleanup warning
  was checked against `useGlow`'s actual `cancelAnimationFrame` cleanup. The
  broader scan against the old `origin/main` also reports existing Circé
  archive-frame ref warnings; that file is unchanged by this upgrade. Neither
  score establishes browser acceptance or an improvement over a differently
  scoped/versioned scan. No rule suppression was added.

The installed Dock launcher was reused without reinstalling it or changing
macOS permissions, certificates, DNS or Tailscale configuration. The rebuilt
host reports 2.2.0 and authenticated trusted-HTTPS health verifies the original
Twitter Library ID/path. The probe revokes its own session. Nono's trusted HTTPS
also returns 200.

Activation exposed background video-sampling warnings for some existing media:
FFmpeg can exit successfully without producing every requested sampled frame,
and the sampler then rejects the batch. The sampler and its callers are
unchanged by this upgrade; this remains a known limitation rather than a
passing acceptance claim for every personal video.

Logs and screenshots are private under
`.artifacts/web-verification/pond-220-20261101` and the `upgrade220-*` files
in its parent directory.

## Recorded browser workflow — 2026-10-31

`smoke-web-browser.cjs --workflow` exercises one complete UI journey against a
fresh disposable host Library: import three PNGs through Import Files, search,
open an image, edit its title and note, create a tag, create and assign a folder,
create a Canvas from the Save's context menu, and drag the Canvas card. Reloads
verify the rendered edits, folder membership and final card position. The
recorded run passed all eight assertions; the card moved from `(0, 0)` to
`(144, 72)` and rendered at those persisted coordinates after reload.

All mutations use Chromium pointer input, editing commands and text input, or
Chromium's real file chooser with local fixture paths supplied through CDP.
Host queries only read back results. The test refuses nonempty Libraries and
hosts outside its `sandbox-workflow` profile. It leaves its fixtures in that
disposable profile for the runtime owner to remove after stopping the test host.
Do not point it at a personal Library or start a second shared runtime.

`CIRCE_RECORD_WORKFLOW=1` adds a diagnostic step label and brief reading pauses.
The private 28-second recording captures the actual Chromium window at its
original pace. This on-demand test is not currently part of CI. It demonstrates
macOS Chromium and reload persistence; it does not establish physical Windows,
iPad, host-restart, or complete feature-parity acceptance.

The subsequent local `pnpm check` was **not green**: 27 of 28 tasks succeeded,
but the desktop suite reported 24 failed, 5,052 passed and 47 skipped tests
across 13 failing files. Failures include component assertions and timeouts in
extension setup, downloads, import scope, rename, folder operations, conversion,
view controls, Library customization, Save viewing and model selection. Their
causes have not been established by this recording task. The passing Chromium
journey does not supersede those failures. The full log is retained privately as
`added-commits-20261031/recording/workflow-check.log` under the evidence directory.

## Investigation of the local check failures — 2026-10-31

Reran the exact 13 failing files with their original assertions and five-second
test deadlines, using two workers. This passed 167 of 169 tests. Only the two
export-dialog tests still failed, and both also failed when run alone. Thus the
initial 24 failures did not establish 24 independently broken application
features.

Tracing the first export test showed its initial render scope completing in
about 17 ms, then an empty dialog host until the five-second deadline while its
real lazy module loaded. After the timeout, late rendering could outlive global
fixture cleanup. Loading that same real module in `beforeAll` made both tests
pass. The tests still exercise `ConversionDialogHost`, its lazy boundary, export
fields, progress and cancellation. Module-load failure still fails setup; this
is not a cold browser-chunk performance test.

The original extension and download failures also logged overlapping React
`act()` calls before later tests saw empty content or missing controls. Extension
test setup previously returned its cleanup handle only after rendering finished.
It now registers cleanup before rendering, refuses a stale setup that finishes
after its test, and restores globals from `afterEach`. Cleanup returns one shared
promise and stays registered until unmount completes, so teardown joins an
already-running cleanup.

The desktop runner now has an explicit two-worker budget. Installed Vitest's
default selected nine workers on this ten-core Mac; the initial run also had
leftover recording windows, which were removed. These factors were not isolated
from one another, so the results do not prove worker count was the sole cause of
the other 22 failures. Production UI and behavior were not changed to obtain
passing tests, and no assertions, test cases or deadlines were relaxed.

| Previously failing area | Tests in affected file | Controlled run after setup fixes |
| --- | ---: | --- |
| Library queries | 55 | Pass |
| Extension setup | 10 | Pass |
| Model picker | 3 | Pass |
| Export/conversion dialog | 2 | Pass |
| Folder drag-and-drop | 6 | Pass |
| Smart Folder sidebar | 11 | Pass |
| Batch rename | 2 | Pass |
| Library customization | 7 | Pass |
| View menu | 7 | Pass |
| Download page | 25 | Pass |
| Folder tree selection | 17 | Pass |
| Mixed-file Save viewer | 3 | Pass |
| Source import scope | 21 | Pass |

All 169 tests across these 13 files passed in the focused run. React Doctor's
changed-file scan reported no findings; that score is not a whole-application
health score. Logs and the setup trace remain private under
`.artifacts/research/test-failures-20261031`.

The subsequent full `pnpm check` exited successfully: all 28 tasks passed, with
722 desktop test files passing and five skipped. Desktop totals were 5,076
passed and 47 skipped, with zero failures; the skip count is unchanged from the
failed run. All originally failing cases passed in this full run, and the
overlapping-`act()` cascades did not recur. Existing non-failing unwrapped-update
warnings remain in other component tests. The complete check took 17m51s on this
shared Mac with the two-worker budget. This verifies the automated suite, not
physical Windows/iPad acceptance or cold browser-chunk performance. No shared
host was restarted during this investigation.

## Browser audit of the added commits — 2026-10-30

Audited every commit in `ca206520..582eba6f`, then exercised the rebuilt browser
through an isolated shared host and disposable Libraries. Personal Library data,
Source credentials, and provider credentials were not used as test fixtures.

| Commit | Browser evidence |
| --- | --- |
| `a1f7cdd0` mouse side buttons | Chromium pointer back/forward input moved exactly one history entry under Win32 and MacIntel platform emulation. |
| `2aac1c3d` Safari settings | Native-only helper remains excluded from browser UI and HTTP access; native helper tests pass. |
| `421ed5ee` import origins | Seven visiting-device import routes retain origin in disk metadata, detail reads, and filters. Rendered Imported From detail, fresh-document reload, and `imported:files` search are exercised. |
| `0cb8f319` requeued replies | Shared host backfill/requeue regression tests pass; browser uses the same owner. |
| `00b7e22e` bulk updates and pagination | HTTP bulk edit/Undo across 13 Saves; tied-timestamp paging in both directions with insertion between pages, plus shared optimistic update/rollback tests. |
| `b192f4f6` disabled switches | Actual computed opacity `0.5`, not-allowed cursor, stable hover/pressed geometry, and unchanged value/preferences after reload. |
| `cc6224fb` All Sounds | Actual accessible control toggles and persists device-local sound state through reload; host preference remains unchanged. |
| `e88675ff` inference pacing | Two authenticated HTTP inference calls across a 17-second idle window complete with healthy enrichment and no model downloads. Native owner smoke also exercises worker replacement and bounded audio. |
| `6150dcdb` fullscreen and subscriptions | Browser native-event adapters register/unsubscribe without errors; shared subscription-model tests pass. Native fullscreen transitions and authenticated catalogs are separate acceptance boundaries. |
| `b7606ec3` capture cancellation | Shared host cancellation/AbortSignal regression tests and authenticated browser queue-control workflow pass. |
| `e8d29f1b` Source list switches | Shared Account handler/component and list-scope tests pass; HTTP classification is intact. A live browser Account flow was not exercised. |
| `7a44082d` reply screenshots | Shared reply-v14 capture regression tests pass; browser media transport and screenshot rendering pass with offline fixtures. |
| `4c0abf53` models, Dock, extension badge | Shared model-picker and extension background tests pass; browser host bridge remains intact. Native Dock and installed-extension badge appearance are not browser-page controls. |
| `b2f79f51` extension Save Page | Fresh browser connection setup, extension capture/authentication bridge, and extension toolbar/stale-settings regression tests pass. |
| `e79d09ec` Library restart | Real browser name/icon changes replace the host, reconnect, preserve identity and restore fixtures. |
| `582eba6f` integration | Core/media/auth, network, parity edits, identity, imports, package restart, Canvas export, desktop/mobile browser shell, and image mouse workflows pass. |
| `d0fe59bc`, `99cfaee5`, `5b13f47d`, `effe705a` releases/Casks | Browser app reports `2.0.3-web`; release assets build coherently. Homebrew casks do not execute in a browser. |

The runtime audit found a pre-existing video-frame-rate loss: package parsing and
portable metadata omitted `frameRate`. The canonical optional field, metadata
writer/reader, and package parser now preserve numeric, unknown/null, and absent
values. Six regression cases cover that path, and the original exact package
round-trip/import/restart check passes without relaxing its metadata comparison.

The existing smoke setup also lacked the quote fixture required by later import
checks and asserted a redundant cache-header spelling. It now seeds all three
media fixtures and explicitly requires the `no-store` directive. Private media
still cannot be stored in caches.

`--release-audit` adds the pointer/switch/sound/origin UI checks to the ordinary
browser harness. `smoke-web-release.mjs` adds seven origin routes, bulk/history,
paging and idle inference checks, with disposable-profile and canonical-Library
containment guards, owned cleanup, pipeline-state restoration and session logout.
The existing CI driver now runs both platform variants and the HTTP checks.

These are offline integration checks on macOS Chromium with device-platform
emulation. They do not claim physical Windows/iPad acceptance, live X/Threads
rendering or Account sync, authenticated subscription/provider execution,
installed-extension badge appearance, or native Safari/fullscreen interactions.
Watched-folder imports retain their native owner; they are not one of the seven
visiting-device import routes exercised here. Evidence stays private under
`.artifacts/web-verification/added-commits-20261030` and `/tmp/circe-browser-*`.

## Pond 2.0.3 sync and dev promotion — 2026-10-30

Merged all 18 upstream commits through `a1f7cdd0`, preserving Circé's browser
transport, native launcher, Library identity events, mouse controls, and resident
inference owner. Browser history retains its device-local routing while receiving
the new mouse side-button handling. Native fullscreen/swipe events have explicit
browser adapters. The new bounded audio decoder remains host-only and is admitted
through the resident owner's existing validated query boundary.

Browser clipboard uploads retain the new `clipboard` import origin through a
narrow files/clipboard contract. Unit coverage and a real authenticated upload,
import, and Save read verified persistence. Browser UI checks passed logo upload,
reset, cancellation, invalid images, icon, emoji, name, combined name/icon,
Settings rename, automatic host reconnection, and temporary Library restoration.

The 28-task check passed, including 5,070 desktop tests (47 skipped). Production
desktop, browser, and Circé extension builds passed. All existing size budgets
remain unchanged: main output is minified and extension CSS uses esbuild
minification. The native desktop smoke passed; its enrichment-owner option
verified two real worker starts across idle release and 8,000 finite audio samples
with further data correctly reported. No model downloads or personal Library
fixtures were required. React Doctor remained 76/100 before and after the merge.

`dev` is promoted to the same validated history as `web`; `main` continues to
mirror upstream. The [sync guide](sync.md) documents the manual fast-forward
promotion. No automatic sync workflow was enabled.

## Native Circé Dock launcher — 2026-10-29

The local installer produced a separately named and signed `~/Applications/Circé.app`
with bundle identifier `dev.elkyiem.circe`, and pinned exactly one Dock entry to
that installed destination. The app menu, About panel, and main window show
Circé. Launching this bundle loads the existing checkout and isolated Library,
prepares the private Portless address and Tailscale, and starts the desktop and
web host in one process. It creates no additional Tailscale Serve ports.

Native UI checks exercised the loaded Library, window close/reactivation while
the same web listener remained alive, Quit Circé, and normal installed-app
relaunch. The final process changed from 49000 to 50899 without reinstalling or
another permission prompt. Repeated native activation retained the same host.
The Dock's exact application URL was verified from its preferences; direct Dock
UI automation timed out, so the cold launch used the same installed app through
LaunchServices. The original Pond bundle checksum, Library pointer files, and
all unrelated pinned Dock entries remained unchanged.

The existing local browser session restored after the normal restart. Its
subsequent reuse on another origin was correctly rejected with 401. A separate
origin-scoped login and Library query passed on the preserved `:9443` address.
The reachable `circe.elkyiem` and `nono.elkyiem` routes both returned trusted HTTPS
200 through the Mac's Tailnet IP. The owned probe sessions were revoked, 401 was
verified, and the temporary private cookie file was removed.

The installer refused replacement while Circé was running. After Quit, reinstall
passed signing verification, archived and unregistered the previous owned app,
and refreshed the Dock entry to avoid a bookmark following the backup. macOS
required Documents access for the new app identity and again after reinstall;
the user approved both dialogs. Normal restart then reused that permission.

Verification passed the repository's 28-task check (4,951 Vitest tests), the
12-task production build and existing budgets, three focused Node tests covering
literal shell arguments/environment and origin preservation, and strict deep
bundle-signature verification. The disconnected-Tailscale reconnection path and
proxy-down administrator prompt were source-reviewed but not exercised by
interrupting shared network infrastructure. Evidence remains private under
`.artifacts/web-verification/dock-launcher`; check/build logs are
`/tmp/circe-dock-final-{check,build}.log`.

## Image viewer mouse navigation — 2026-10-29

The Windows recording showed the opened Save's image inspector. The previous
default treated wheel events as vertical pan, rejected middle-button dragging,
and reserved left dragging at or below fit for native file export. The browser
now allows left and middle panning at every scale, with pointer capture and a
grab cursor. Native file dragging at fit is preserved. CSS interface zoom is
accounted for once in pointer and wheel coordinates.

Windows browser preferences upgrade the inherited Mac scroll default to zoom
once, on the visiting device. Subsequent explicit Image Scrolling choices survive
reload. Mac trackpad defaults and host preferences are unchanged.

The focused regression run passed 42 tests across 14 files, including panning,
cancellation, capture loss, crop behavior and preference ownership. The finite
`smoke-web-browser.cjs --image-navigation` acceptance passed ten actual mouse
checks: both buttons at fit/below/above, release, wheel zoom, 150% interface scale,
explicit Pan preference persistence, and Mac two-axis scroll/pinch. It used a
temporary owned PNG Save, removed its upload and Save, restored browser storage,
verified the original Library and host viewer preferences, and revoked its
session. The first two attempts targeted the image toolbar; the corrected probe
requires the image's `role=application` frame. Windows/Mac input was emulated in
macOS Chromium; physical Windows OS middle-button behavior remains unverified.
An independent read-only review found no actionable production-code issues.

## Reconnect page component consistency — 2026-10-29

The offline fallback now builds the shared Empty and Button components instead
of a separate HTML/CSS approximation. Its primary button follows the shared
neutral theme, and its inline app icon remains available when the host returns
an error. The worker caches only the offline entry's static dependency allowlist;
authenticated Library responses and media remain uncached.

`pnpm --filter @pond/desktop build:web`, followed from `apps/desktop` by
`env -u ELECTRON_RUN_AS_NODE pnpm exec electron scripts/smoke-web-offline.cjs`,
passed a real server shutdown with the HTTP cache cleared, icon decoding at four
widths (320, 390, 768, 1280), shared primary-button geometry, unavailable private
session requests, keyboard focus and Space-to-reconnect after the server returned.
The production `--pwa-shell --pwa-shell-connection-only` suite passed seven checks
and restored the original Library, preferences and browser state.

The repository check passed all 28 tasks and 4,940 tests; the production build
passed all 12 tasks and existing budgets. React Doctor reported no findings in
the changed React code (93/100). Runtime recovery restored the existing HTTPS
proxy and host; trusted requests through the Mac's Tailnet IP returned 200 for
Circé and Nono. This verification does not establish the still-unreproduced
post-dragging issue reported separately.

## Library administration and file actions — 2026-10-29

The complete Library administration browser probe passed create, backup checksums,
fresh-ID restore, identity-preserving move, recent/open, active no-op, merge and
repeat-merge deduplication, and cancellation. Each run restored the original
Library and verified its identity and pointer before deleting only owned fixtures.
The eleven dead recent-history entries left by earlier test runs were hidden
through the native history operation after strict ownership validation.

The file-action probe passed seventeen real HTTPS checkpoints. It verified
thumbnail selection/cancel/corruption and useful feedback, visiting clipboard
denial/empty feedback, replacement bytes/name, both second-GIF-frame actions with
a nonzero file index and encoded filename, an actual video subtitle cue, valid and
invalid dotLottie export, decoded WebP output, and a redacted debug ZIP. It purged
only its five owned Saves and checked that the original Library was unchanged.

The shared toolbar layout review found and fixed two action-blocking defects:

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `image-inspector/controls` | GIF controls inherited disabled pointer input and clicks hit the image | Existing interactive HUD pill contains the controls | Controls stay distinct from content and receive input |
| HIGH | `viewers/hud` and `media-viewer/chrome` | Narrow grid tracks made slide navigation overlap GIF Frames | Container-driven wrapping preserves DOM order; the header grows with its controls | Hold structure until it breaks; critical actions remain reachable |

Fit, hit tests and real touch stepping passed at 320, 390, 768 and 1280 CSS-pixel
coarse-pointer layouts, 1280-pixel desktop at 200% zoom, and the 390-pixel RTL
mirror. Coarse control targets measured at least 44 pixels. Approve this tested
Chromium toolbar coverage. Not verified: physical Windows/iPad Safari, successful
OS clipboard transfer, and translated UI text beyond the application's current
English labels.

Full offline verification before the newest watched-folder/history changes passed
28 tasks and 4,753 desktop tests (five skipped). Later focused checks cover the
new importer ownership, configuration rollback/quit, history, keyboard and
authority boundaries. Final full verification remains required for completion.

## Circé extension transport — 2026-10-26

This slice started from local `web` commit `6309ddef`, with a clean working
tree. The pre-change `pnpm check` passed all 25 tasks (4,134 desktop tests).
The audited upstream commit remains
`0e9dc817e17baafe60d9151a7fc49be5dc3e0861`; no newer baseline was adopted.

- Final `pnpm check`: 25 tasks passed; desktop 607 files passed, 2 skipped;
  4,145 tests passed, 5 skipped. Extension transport tests run with the existing
  extension suite. Focused host cases cover credential hashing, 0600 storage,
  restart, expiry, rotation, independent browsers, revocation, exact origins,
  preflight, Library binding, rate limits, forbidden operations and request size.
- `pnpm build`: 11 tasks and all five performance budgets passed. The browser
  build and separate `build:circe` Chromium artifact passed. No dependency was
  added. The Circé build has a separate ID and cannot call the installed Pond
  native host while unpaired; the normal unpaired Pond build retains native
  messaging. Paired network/auth/storage failures cannot fall through to it.
- `smoke-web-extension.mjs`: `WEB_EXTENSION_PASSED` against the real isolated
  host. A generated PNG went through the original durable capture queue into
  the disposable Library. Replies omitted host paths, unsolicited Source-session
  import was rejected, and New Source selected the extension connection mode.
  This passed over both loopback HTTP and the private Tailscale HTTPS address.
- After an actual isolated-host stop/restart,
  `smoke-web-extension.mjs --after-restart` reported
  `WEB_EXTENSION_RESTART_PASSED`: both the capture and extension credential
  persisted. It then revoked its own credential, verified rejection, and removed
  its private 0600 test-state file. No live Source cookies were used.
- CI builds the Circé artifact and includes the first HTTP extension smoke in its
  isolated driver. The complete CI driver was not launched locally because this
  chat uses the single shared host. Restart evidence above is from the explicit
  local stop/restart, not the CI script.
- The finite browser regression passed at 1280×900 and 390×844: real keyword
  search, organization, image viewing, video seeking and reload. A prior run's
  search assertion assumed the video could never match the word “image”; its
  generated caption now contains that word. The driver now assigns a unique
  temporary title term to the image fixture and restores it in `finally`, keeping
  both the positive and negative search checks. No search implementation or
  assertion was weakened. This verifies the ordinary browser application, not
  the uninstalled Chrome extension.
- `--extension-setup` reported `WEB_EXTENSION_SETUP_BROWSER_PASSED`: the actual
  Sources menu and Twitter choice show pairing instructions at both widths when
  unpaired, without creating an Account or opening the separate host sign-in
  flow. The desktop's existing native connection path is unchanged.

At the transport commit, actual Chrome loading/pairing and live X verification
were pending. Computer use rejected opening `chrome://extensions/`: its URL
policy allows only HTTP/HTTPS and forbids alternate automation to bypass that
denial. The built folder and private file-picker instructions were supplied for
manual loading. The owner subsequently loaded and paired it; the live follow-up
below supersedes that pending state. Remote Firefox pairing remains deferred;
its native path is preserved.

Logs: `.local/verification/extension-{baseline-check,check,build,iris-build,
browser-build,http,restart}.log`. Generated files and credential state remain in
ignored directories. The extension transport is reviewable local work on `web`;
it is not promoted to `dev` while the broader acceptance matrix remains pending.

## Live Twitter connection and capture — 2026-10-26

The owner manually loaded the separate Circé extension, paired it with the private
Tailscale host, then chose Twitter in the web app and confirmed the import scope.
The host confirmed one paired browser, imported the requested session into its
isolated Account partition, and matched the expected signed-in handle. No Chrome
profile files were read and the installed Pond native host was not redirected.
The web page was on loopback while the extension was paired to private HTTPS;
the Library-bound polling path successfully delivered this connection request.

- The existing host collector finished its list walk and queued **4,102** live
  Saves. The Account was connected, no longer awaiting import choices, and had
  no sync-level error. This proves list collection/enqueue, not full media ingest.
- Live image/video samples retained matching Save URL, Source ID and structured
  Capture ID. Both native light/dark React cards were present. Authenticated
  original bytes matched the indexed files; unauthenticated media returned 401.
  A video byte-range request returned 206 and the requested 256 bytes.
- In shared Chrome, the original 1280×720 video played and sought to about ten
  seconds of its 10.71-second duration without a media error. A live 1200×630
  original image decoded and remained visible after reload. Screenshots:
  `.artifacts/web-verification/live-twitter-{video,image}-chrome.png`.
- A separate quoted-post sample retained distinct parent/quote IDs and authors.
  Its downloaded clip's yt-dlp asset ID matched the quoted clip; its webpage URL
  matched the parent Save. All four parent/quote light/dark PNGs and original
  video matched authenticated HTTP bytes. The parent PNG visibly contained the
  correct quoted author/content. This sample used Pond's existing actual-X
  screenshot fallback, whereas the image/video samples used native React cards.
  The fallback's video file has no `sourceUrl`; the yt-dlp identity established
  that relationship instead of treating that absent field as a mismatch.
- The installed Circé popup's **Harvest Post → Save** sent an already-saved post
  through the real capture queue. Its persisted receipt completed with
  `duplicateCount: 1` and the original Save ID. A revision-fenced Undo restored
  the original title, notes, rating, tags and user-title lock exactly; no social
  like/bookmark action was made. Private per-item evidence remains ignored in
  the sandbox, outside commits.
- At 19:27 UTC, the Library contained 995 completed Twitter Saves (including
  three existing fixtures), 23 failed live Saves, and 3,087 ingesting live Saves.
  The queue had 7,489 completed tasks, 115 dead tasks and no running task. These
  task counts are not Save counts. Read-only inspection showed `source_budget`
  deferral after 150 hourly permits, with the earliest resume at 19:50:38 UTC.
  The global queue was not paused. The existing governor and recovery schedule
  were left intact; the host was not restarted during the import.

Further read-only inspection matched **all 23 failed Saves** to
`DownloadSizeError` warnings for their captured media URLs. Pond's direct blob
path caps a file at 50 MiB (or a lower configured image limit), then loses that
reason and reports “permanently unavailable.” This does not establish that those
originals were deleted. The follow-up retains `size_limit` through the batch and
task error, with focused tests of an oversized HTTP response and task settlement.
It preserves the ceiling and existing retry/terminal policy. Supporting larger
direct videos while honoring video preferences remains a separate required fix.
The running host and its earlier stored failures have not been rewritten or
restarted to apply that classification change during this import.

Background X requests also emitted 429s, and native
enrichment logged transcript/frame errors on separate items. Full ingest
settlement, automatic bookmark/like hooks, other Sources, and enrichment recovery
remain pending. This is live Chromium/X evidence, not a claim of full parity.

The follow-up exposes the existing Source-budget reason and resume countdown in
Downloads instead of the generic “Waiting for Twitter.” Real Chrome testing
caught the renderer's Save parser discarding that reason; the regression now
passes through the same parser. The accumulated transfer history also squeezed
the download grid to zero height. That panel now has a bounded, keyboard-scrollable
area so active Save jobs retain space. The extension toolbar and popup now derive
their titles from the manifest name so Circé can be distinguished
from the separately installed Pond extension. Normal Pond retains its title.
These title changes take effect when the unpacked extension is reloaded.

At 19:51 UTC the queue had resumed automatically: two tasks were running and
the sync generation had 7,868 completed tasks. No restart, manual retry or budget
change was needed. Full settlement is still pending.

Shared Chrome reloaded the rebuilt app at 1280×900 and 390×844. The Downloads
grid retained about 476 and 408 pixels of height respectively, the transfer
history scrolled independently by keyboard, and the mobile document stayed
390 pixels wide. The mobile table retains its existing horizontal column scroll;
the open Assistant overlay was closed for inspection and restored afterward.
Screenshots: `live-twitter-budget-{desktop,mobile}-chrome.png` in the ignored
verification directory. The temporary viewport override was reset. These are
Chromium viewport checks, not physical-phone coverage.

Focused download-state checks passed 15 tests across two files. Size/transfer
checks passed 13 tests across three files. The full follow-up `pnpm check` passed
25 tasks: desktop 608 test files passed, 2 skipped; 4,149 tests passed, 5 skipped.
`pnpm build` passed all 11 tasks and all five budgets; the browser and separate
Circé extension builds passed. Local logs use `.local/verification/live-source-*`.

## Original kickoff baseline

Environment: macOS arm64, Node 24.14.1, pnpm 11.27.0. The shell initially selected
Node 26 with no pnpm; the existing Node 24 installation was selected explicitly.
Dependencies installed with the frozen lockfile. No baseline upgrade was made.

Before changing shared code, `pnpm check` and `pnpm build` were started from the
untouched audited tree. The full production build passed all 11 tasks and all
five performance budgets. The parallel check/build run suffered test timeouts:
`theme/colors/tokens`, desktop `cli-assistant`, `library-query`,
`queue-v2.simulation`, `bundle-icon`, and `view-store-persistence`. The theme
failure stopped the graph before a complete desktop test summary. These are
baseline observations, not port regressions. No shared tests were weakened.

## Final checks

| Check | Result |
| --- | --- |
| `pnpm build` | Passed 11 tasks and all five existing performance budgets |
| `pnpm typecheck` | Passed all 14 tasks |
| `pnpm lint:repo`, `pnpm oxlint:repo` | Passed |
| `pnpm architecture:check:repo` | Passed across 1,488 desktop modules |
| `pnpm knip:repo` | Passed, with redundant-entry configuration hints |
| Focused web, serialization, byte-range, Capture and media-selection tests | Final run: 31 passed across 7 files |
| `pnpm test` | Default five-second theme contrast timeout, also observed before edits; no clean full-suite claim |
| Theme timeout retry with `--testTimeout=60000` | The failing contrast invariant passed |
| Desktop suite with `--maxWorkers=2` | 595 files passed, 2 skipped; 4,092 assertions passed, 5 skipped; exit failed on an unhandled native socket cleanup ENOENT |
| Native socket test isolated retry | Passed; the affected native server and test are unchanged by this port |

The native socket error concerned a temporary `pond-native-*/native.sock` during
`keeps the replacement socket reachable after the previous listener stops`.
This is an unresolved test-harness race in unchanged code, distinct from the
baseline timeout observations. Neither test timeouts nor shared tests were
changed to obtain a pass. Consequently `pnpm check`/`pnpm test` are not reported
as fully green.

## Real host and browser workflows

The disposable host HTTP smoke passed queue-backed image/video ingest,
card/original file identity, media authentication, HEAD, bounded/suffix ranges,
416, metadata denial, organization, pagination and keyword search. Both UI and
HTTP-created folder membership survived a graceful host stop and restart.

A finite Chromium BrowserWindow loaded the production HTTP app with no preload
bridge, Node integration or existing profile. At 1280×900 it verified the sign-in
hit targets, actual search input, browser fixture enqueue, folder creation,
viewer folder add/remove/re-add, image viewing, video playback/seek and reload.
At 390×844 it verified the library, viewer, decoded video frames and reload.
The media state recorded the original video URL, 640-pixel video width and a
seek past two seconds. Side panes were adapted to overlays at this width.

Stored parent Capture IDs, quoted IDs/authors, source.json and query metadata
were compared. Light/dark card files were both present and distinct; original
image/video source URLs matched the corresponding Capture. Existing Pond media
selection and Capture-to-card tests remain in place. These are deterministic
fixtures, not live Twitter/X verification.

A separate browser run observed the actual `Host disconnected` banner after the
isolated host stopped. SSE tests also verify ready, progress SyncAction delivery
and subscription cleanup. Restart requires signing in again because sessions
are memory-only. Unauthorized operations/media/events and foreign origins were
tested at the HTTP boundary.

Collaborative Chrome exposed a real click blocker on the sign-in form: the empty
application root overlaid it. The form now has an explicit stacking position;
Chrome confirmed that clicking focuses the password input. Private credential
transfer through the browser automation file picker is unavailable without an
extension permission, so a signed-in collaborative Chrome workflow is still a
manual follow-up. No access key was printed or put in browser tool arguments.

Physical mobile devices, live source sessions, Tailscale HTTPS, archive replay,
Agent streaming and visiting-device uploads remain unverified or deferred as
listed in the [parity ledger](parity.md). The resident Electron collectors and
native worker path were preserved; no live account credentials were imported.

Raw local command logs are retained in ignored `*.log` files under
`.local/verification/`. Host test state and generated private credentials are
under ignored `.artifacts/iris-web-sandbox/`; neither belongs in commits.

## Expanded parity slice — 2026-10-26

This record supersedes the earlier kickoff-only limitations where explicitly
stated. Full feature parity is still in progress.

- `pnpm check`: all 25 tasks passed. Desktop: 599 files passed, 2 skipped;
  4,108 tests passed, 5 skipped. Other package checks, including theme, passed.
- `pnpm build`: all 11 tasks and five performance budgets passed. Browser
  production build and all 14 typecheck tasks passed separately.
- Focused transport/security/serialization/history/Agent/native tests: 68 passed,
  1 platform skip across 11 files before the additional reload/preference tests.
  Deep-link and preference regression check: 11 passed across 2 files.
- The native socket cleanup race is fixed. The theme contrast test now runs its
  identical assertions per preset; default timeouts and assertion coverage were
  preserved. A parallel build/check run again timed out in filter persistence;
  its isolated retry and subsequent full graph without a concurrent build passed.
- HTTP workflow smoke passed Save edits and conflicts, stale Undo rejection,
  tags, Saved Views, Canvas rename/content retention and stale autosave rejection,
  upload retry identity, real file import, Pond package Capture/media retention,
  same-Library reimport/dedup, CSV, conversion ZIP, attachment registration,
  decoded/sampled video frames, cross-Save thumbnail rejection and authenticated
  compatible preview byte ranges.
- Private Tailscale Serve HTTPS on port 9443 returned the real app and passed
  authenticated restart/persistence checks from this machine. Existing Serve
  configuration was compared before/after and preserved. No Funnel/public
  deployment was enabled. Another device has not been checked.
- Shared Chrome signed in through its native file chooser without exposing the
  access key. The actual assistant composer used **Codex Default** through the
  authorized ChatGPT subscription, searched the fixture Library, streamed a
  response and cited the correct Save. Opening the citation loaded that Save's
  original `media-1.png`. Folder assignment, removal and saved-item reload passed
  in shared Chrome. Screenshots are ignored local artifacts under
  `.artifacts/web-verification/shared-chrome-{agent,citation}.png`.
- Browser startup testing caught an allowlist mismatch for preferences. Model
  selection testing caught a stale preference publication. Deep-link reload
  testing caught a discarded HTML response body. All were fixed and the latter
  two gained focused regression coverage. HTTP-only checks did not catch them.

The isolated Source sign-in helper is implemented, but no user has completed a
live sign-in. Normal Chrome being signed in to X does not authorize automatic
cookie extraction into the sandbox. Live Source sync is therefore pending.
The available device tool reported a local device-support installation failure
and no Android SDK; physical mobile coverage is not claimed. Archive replay,
Canvas export, host administration, full viewer/format coverage, enrichment
execution ownership, and the remaining Agent review/cancellation/device matrix
remain open in the parity ledger. These are not hidden behind a full-parity claim.

## Canvas, composition and assistant follow-up — 2026-10-26

- The real host rendered a Canvas containing an image Save, note, connector and
  shape beyond the first capture tile to PNG and PDF. The test checks nonblank
  pixels, second-tile color, authenticated download and exact stored-content
  equality before/after. The PNG was visually inspected; an export HUD artifact
  was fixed. Shared Chrome opened the saved Canvas and downloaded its PNG through
  the actual context menu. `scripts/smoke-web-canvas.mjs` repeats the host check.
- Shared Chrome selected the quote and image fixtures, opened the shared Combine
  Images dialog, displayed their original Pond cards and created a new Save.
  HTTP checks also verified export and rejection of a browser-supplied host path.
  At 390×844 the settings and preview remained usable and Export downloaded the
  composed PNG. This is Chromium viewport coverage, not a physical-phone test.
- Shared Chrome stopped a real ChatGPT subscription turn. The accessible status
  now says “Assistant response stopped.” A regression test covers this state.
- Live review testing found an upstream tool returning a pending-review message
  with zero proposals when the model had not read the Save. The tool now reports
  a corrective error, and empty results do not claim a review is ready. The
  failing reproduction and fix are covered by the context test; 47 Agent tests
  passed across context, operations and completion.
- The live review then exposed a null/empty-note mismatch at the executor's
  conflict check. Apply now retains the exact stored original for conflict
  validation and Undo. Regression cases cover null, empty text and a newer note.
  Shared Chrome reopened the persisted review after a host restart, applied the
  fixture note and undid it. Host reads independently verified the applied value
  and exact restoration to `null`.
- Focused web/Canvas/status tests passed: 69 across 12 files. A full graph during
  the render smoke again timed out on the cold filter-store import; its next
  assertion was contaminated by that timed-out import. This is recorded separately
  from the new-feature checks; the final isolated graph result is recorded below.
- Final isolated `pnpm check`: all 25 tasks passed. Desktop: 600 files passed,
  2 skipped; 4,114 tests passed, 5 skipped. Cold dependency loading in the existing
  filter-persistence test moved into setup; every case still resets modules and
  reloads the real store. Default timeouts and assertions are unchanged.
  `pnpm build`: all 11 tasks and five budgets passed.

Screenshots are local ignored artifacts:
`shared-chrome-combine.png`, `shared-chrome-canvas.png`, and
`shared-chrome-agent-stopped.png` under `.artifacts/web-verification/`, with
additional `shared-chrome-combine-mobile.png` and `shared-chrome-agent-applied.png`.

## Directory import follow-up — 2026-10-26

The visiting-device adapter now bounds upload concurrency and retains validated
relative folder names. The host resolves those names to Library folders, never
filesystem locations, and holds transfer admission across creation/import and
assignment. Folder trees and staged-file identities are reused on retry.

- Unit checks cover nested names, retry identity, the host upload admission limit,
  traversal, ambiguous selections and missing destinations.
- `smoke-web-imports.mjs` imported two different originals named `same.png` into
  separate nested folders in the real isolated Library, compared original bytes,
  retried without additional Saves/folders and verified traversal rejection.
- Shared Chrome used the native folder picker and actual Duplicate File dialog,
  selected Keep Both for the two purpose-built files and displayed the complete
  hierarchy. Evidence: `shared-chrome-directory-import.png`. Reload retained the
  data but reset the active folder; that separate navigation gap remains recorded.
- `pnpm check`: all 25 tasks passed; desktop 602 files passed, 2 skipped,
  4,124 tests passed, 5 skipped. Electron-ABI database/vector tests: 8 passed.
- Root production build passed all 11 tasks and five budgets. The native desktop
  smoke passed visible startup, preload operations and detached preview with
  `--use-mock-keychain`. Its first invocation without that sandbox flag stalled
  before readiness and was terminated; no normal keystore access was approved.
- Directory Save identities and memberships survived the same host's restart.
  The finite browser again showed the disconnection banner when the host stopped.
  An initial manually orchestrated attempt missed its 20-second stop window;
  stopping directly when the readiness signal arrived passed without test changes.

## Browser scope restoration — 2026-10-26

The active-folder reload gap is fixed. Shared Chrome verified folder reload,
opening and reloading an imported Save, app Back/Forward and browser Back between
All and the selected folder. The correct two contents and subfolders returned.
Screenshot: `shared-chrome-folder-reload.png`. The finite desktop/mobile browser
smoke also passes folder reload through the real UI. Its first extended run
needed a null guard while waiting for the reloading breadcrumb to mount.

History tests cover Folder/Tag restoration, encoded tag names, Save context,
unrelated application routes, explicit scope, and invalid/ambiguous parameters.
`pnpm check` passed all 25 tasks: desktop 603 files passed, 2 skipped; 4,127 tests
passed, 5 skipped. The production build passed all 11 tasks and five budgets;
the browser build passed separately. Saved View and complete filter-history
restoration remain a further navigation slice.

## Fresh-Library package round trip — 2026-10-26

`smoke-web-package.mjs` downloaded a real authenticated browser export containing
the quote, image and video fixtures. A finite Electron process imported it into
a new temporary Library, compared every Capture and indexed-file record, and
hashed every original and derived file. Re-export retained each Save's folder
paths and the organization names. Reimport skipped all three existing Saves;
a second host process reopened the same temporary Library and verified stable
destination IDs and file bytes again. Both temporary profiles and their packages
were removed after the processes exited. No production data or credentials were
copied. The initial test bundle needed to reside in the workspace cache for
package resolution; this was a harness issue before import ran.

Pond's existing package importer assigns destination Save/Folder IDs and remaps
their references. Source IDs and structured Capture identities are retained.
Circé preserves that upstream behavior; copying a complete Library and importing
a package are different operations. This check does not claim every organization
attribute or foreign import format has a browser acceptance test.

## Representative file viewers — 2026-10-26

Twelve purpose-built files entered the isolated Library through authenticated
upload and the original importer: HEIC, PDF, WAV, WOFF2, Unicode text, EPUB, GLB,
ZIP, Live Photo, offline HTML, DOCX and a generic original. All twelve rendered
their actual registered viewer at both 1280×900 and 390×844; a fallback would fail
the check. PDF text search and rotation, audio playback, Live Photo motion and
seeking, font loading, EPUB content, 3D rendering, ZIP entries, sanitized sandboxed
HTML and byte-exact generic downloads passed. Native-preview coverage is specific
to this macOS host. This is representative coverage, not every supported file
format or viewer control; WARC replay remains a separate deferred boundary.

The browser now labels the original-file action **Download Original**; native
Open in Default App and Export Original remain on desktop. PDF HUD controls no
longer overlap when the center slot is empty: narrow toolbars retain every
control in a horizontally scrollable end slot. Both widths exercised rotation
through that toolbar. Shared Chrome independently confirmed PDF search; the
finite test initially omitted the Return character event, which was corrected
in its input harness without changing product search behavior.

The finite viewer matrix passed all 24 cases. The original browser workflow
also passed against the expanded Library, including search, full-image decoding,
video seeking, folder mutation/reload and mobile width. Its locators now handle
virtualized results and distinguish the open Save's original from the retained
Library grid's thumbnails. Evidence: `viewer-results.json` and
`viewer-<kind>-<width>.png` under `.artifacts/web-verification/`.

The final `pnpm check` passed all 25 tasks: desktop 603 test files passed,
2 skipped; 4,127 tests passed, 5 skipped. `pnpm build` passed all 11 tasks and
five performance budgets. The separate production browser build and focused
viewer tests also passed.

## New Note and editor persistence — 2026-10-26

The real New Note menu exposed a transport regression: the browser upload/manual
adapter dropped `mediaType`, so Pond rejected an untitled empty text Save as
empty input. The adapter now reuses the native manual-input schema and
normalization, replacing only filesystem paths and Source identity with
host-resolved upload tickets. Three focused tests verify empty Notes, media
metadata, upload identity and rejection of host paths or expired tickets.

The finite browser created Notes through New, edited their titles and Unicode
bodies in Pond's actual Lexical editor, independently checked committed Save
fields over HTTP and reloaded the Save at both 1280×900 and 390×844. The mobile
flow opens the existing sidebar to reach New and closes it to edit. Early harness
runs needed to await creation, open that sidebar and explicitly navigate to All
instead of invoking the Continue startup route. No product navigation behavior
was changed to satisfy those harness corrections.

Evidence: `editing-results.json`, `note-edited-<width>.png` and
`note-reloaded-<width>.png`. These Notes have not yet received a separate host
restart acceptance run; the fixture manifest and `--editing --after-restart`
command are prepared for the next shared-runtime restart. Rich formatting,
conflicting concurrent document edits and the full bulk-edit UI matrix remain
pending. `pnpm check` passed all 25 tasks: desktop 604 files passed, 2 skipped;
4,130 tests passed, 5 skipped. The root build passed all 11 tasks and five budgets.

## Library logo and browser tab icon — 2026-10-26

The owner reported a generic browser-tab icon and “Couldn't choose the logo.”
The browser document had no favicon, and both logo operations remained classified
as native-only. The browser now opens its own single-file picker and uploads an
opaque ticket. Main uses the same native image normalization as desktop;
the existing identity owner stores the 256×256 PNG in portable metadata.
Identity writes retain the current session, origin and Library fences. The
browser starts with Pond's upstream default app icon and follows the custom
Library logo after authenticated reads or updates; Reset restores the default.

- Focused checks: 22 tests across five files passed, including actual browser
  picker/change/cancel events and host authentication/origin/Library checks.
- The real isolated-host HTTP smoke verified PNG dimensions, stored metadata,
  reset/restoration, rejection of invalid images, host paths and oversized files,
  and the declared favicon's MIME type and image bytes.
- The finite Chromium browser used the real file chooser protocol and shared
  Settings UI to upload, display, reload and reset the logo. The custom favicon
  matched the stored logo after upload and reload. Original identity was restored.
  Evidence: `library-logo-changed.png`, `library-logo-reloaded.png` and
  `library-logo-reset.png`. Both identity checks now run in the isolated CI driver.
- Shared Chrome reached Settings, but its native access-key chooser left Open
  disabled. It was cancelled; no browser permission was changed. Complete logo
  UI acceptance therefore used the finite Chromium check above. The owner's
  remote Windows logo-picker result remains distinct from that automated proof.
- `pnpm check`: all 25 tasks passed; desktop 605 test files passed, 2 skipped;
  4,134 tests passed, 5 skipped. Root build: all 11 tasks and five budgets passed;
  the separate browser production build passed.

The necessary isolated-host restart also completed the pending Note restart
check: both previously edited Notes reopened with identical titles and bodies
at desktop and mobile widths (`WEB_EDITING_RESTART_PASSED`). Separately, the
owner confirmed remote Windows access through Tailscale after explicitly
authorizing private Taildrop delivery of the login file. No key contents were
printed, embedded in a URL or committed.

The Note acceptance assertions passed before its temporary Chromium profile
cleanup stalled two older finite processes in a native error dialog. Those
test-only processes were stopped; the shared host remained running. Profile
removal now retries transient filesystem failures and reports a failed cleanup
with a nonzero exit instead of opening an uncaught-error dialog. The Note
restart check was repeated and exited successfully with the profile removed.

## Pond 2.0 and Circé rename — 2026-10-27

Synced upstream `main` through `c594ed4d`, including release tag `v2.0.0`.
Renamed the GitHub fork to `elkyiem/Circe`, the project and checkout to Circé,
and the browser/extension branding to Circé. The isolated profile's three stored
checkout-path records were relocated with backups. Existing session namespaces,
Library identity and extension signing key remain compatible.

Verification from `/Users/elkyiem/Documents/GitHub/Circé`:

- `pnpm install --frozen-lockfile`: passed with Node 24.14.1 / pnpm 11.27.0.
- `pnpm check`: all 27 tasks passed; desktop 664 files passed, 4,585 tests passed,
  5 skipped (including the separately checked native database cases).
- `pnpm build`: all 12 tasks passed, including every unchanged performance budget.
- `pnpm --filter @pond/desktop build:web`: passed.
- `pnpm --filter @pond/extension build:circe`: passed; manifest name Circé,
  version 2.0.0, existing extension signing identity retained.
- Electron ABI database/vector checks: 2 files and 8 tests passed.
- `smoke-agent-stream.cjs`: passed reply streaming, completion and cancellation.
- `smoke-desktop.cjs --use-mock-keychain`: passed visible startup, preload Library queries and detached preview creation/cleanup with an isolated test Library. The mock keychain avoids a macOS authorization dialog during this finite check.
- Portless forwarding tests cover authenticated uploads, media ranges, cookie
  retention and foreign Host/Origin denial. Browser Data Export picker and
  Library-bound Fish handoff regression cases are part of the offline suite.

The shared Circé host and Tailscale were stopped at inspection. Live browser,
physical-device, new Source sign-ins and short-address activation require the
designated runtime owner. The local Portless/HTTPS forwarder does not configure
DNS or certificates on an unvisited remote device.

## Runtime activation follow-up — 2026-10-27

The user explicitly designated this chat runtime owner. The existing Library
opens after the checkout relocation, and authenticated reads, Fish settings,
MCP settings and the private HTTPS session at
`https://elkyiem.tailffeb5b.ts.net:9443` passed. The host runs independently of T3;
its PID and logs are under ignored `.artifacts/circe-runtime/`.

- The authenticated HTTP workflow passed image/video ingestion and identity,
  media byte ranges, pagination, search, Folder assignment and restart retention.
- The real browser workflow passed over loopback and private Tailscale HTTPS at
  1280×900 and 390×844, including image
  rendering, video seeking, Folder assignment/removal, browser navigation and reload.
- Smoke scripts now retain old fixture titles and find fixtures outside the newest
  100 Saves. Their Folder selectors follow Pond 2's accessible menu roles.
- The CI failure on the renamed extension output was traced to one stale
  `.output-iris` path; it now reads `.output-circe`.
- Portless 0.15.11 rejects `--tld` on its app command. A cross-platform Node
  launcher now provides `PORTLESS_TLD=elkyiem` and the `circe` app name.
- The network smoke reproduced a real Unicode User-Agent failure after the Circé
  rename. The host keeps the accented display name and sets an ASCII `Circe`
  HTTP token before creating sessions. The regression fetches an actual image
  through Electron's `pond://` handler, passed after the fix, and is included in the CI driver.

After the owner approved the native certificate dialog, `https://circe.elkyiem`
became active on this Mac. Portless runs on loopback port 443, the local hostname
resolves to loopback, and macOS certificate verification and ordinary `curl` both
pass. The browser workflow passed at desktop and mobile widths through this
trusted short address, including video seeking and reload persistence. Node-side
fixture requests use the same `NODE_EXTRA_CA_CERTS` setting supplied by Portless;
Chromium page loads use macOS certificate trust.

Portless also publishes the private address
`https://elkyiem.tailffeb5b.ts.net:8444`. The existing private HTTPS route on port
9443 remains active. All prior Serve routes and Funnel settings were verified
unchanged. Temporary administrator credential delivery files were removed after
use. Shared tailnet access was completed in the follow-up below.

After the network fix, `pnpm check` passed all 27 tasks (4,585 desktop tests),
`pnpm build` passed all 12 tasks and budgets, the browser bundle rebuilt, and the
network smoke passed. The independent host was restarted from those bundles;
authenticated private-HTTPS restart and browser checks passed again, and the
new runtime log contains no ByteString header errors.

A later Ubuntu CI run exposed a case-sensitive media lookup failure. Chromium
lowercases standard-scheme authorities, but Save directories retain uppercase
ULIDs. The protocol now restores valid Save ULIDs before resolving media and
thumbnails. The existing network smoke was run against a temporary case-sensitive
HFS+ volume on macOS: it reproduced `404 !== 200` before the fix and passed after
the fix. That volume was detached and removed. The production build passed all
12 tasks and size budgets, and the shared Portless host was restarted from the
rebuilt bundles. Authenticated media ranges, folder/search operations, private
HTTPS persistence, and normal macOS certificate verification passed again.
`pnpm check` passed all 27 tasks again, with 4,585 desktop tests passed and
5 skipped.

## Shared tailnet DNS and HTTPS — 2026-10-27

The short addresses now work through the Mac's Tailscale IP instead of requiring
a Portless process on each visiting device. The owner installed the public CA
on Windows and confirmed that `https://circe.elkyiem` loads there.

- CoreDNS 1.15.0 serves the private `elkyiem` zone on `100.88.201.56:53`, with a
  wildcard A record pointing to the Mac. UDP and TCP lookups passed; AAAA queries
  return empty NOERROR responses, and unrelated DNS zones are refused.
- Tailscale split DNS was patched only for `elkyiem`. Other split-DNS namespaces,
  global nameservers, and MagicDNS preferences were read before and after and
  verified unchanged. Queries through Tailscale's resolver at `100.100.100.100`
  return `100.88.201.56` for both `circe.elkyiem` and `nono.elkyiem`.
- HAProxy 3.4.7 routes TLS connections from Tailscale TCP port 443 through the
  existing Portless proxy for `.elkyiem` names. Other hostnames retain the prior
  HTTPS handlers, moved behind the gateway to port 9445. Every previous web
  handler was compared with the resulting configuration. Other ports and Funnel
  settings were retained. The original default target returned 502 before the
  change, and its response remained identical afterward.
- Trusted HTTPS requests for both short names passed when explicitly connected
  to `100.88.201.56`. The desktop/mobile browser smoke also passed with Chromium
  resolving Circé to that Tailscale IP: image rendering, video seeking, folders,
  navigation, reload, and folder persistence.
- CoreDNS and HAProxy run under dedicated launchd jobs. Both reported running;
  DNS binds only to the Tailscale IP and the TLS gateway only to loopback. The
  firewall remains enabled, with the CoreDNS executable allowed. Runtime
  configuration and logs live outside the repository checkout.
- The routing helper uses LocalAPI concurrency tokens, retains backups, and its
  rollback transformation was checked against the original configuration plus
  a newer unrelated route. This check did not change live routing.
- Temporary administrator-password and Tailscale API-token delivery files were
  removed after use. Public Windows/iPad certificate artifacts remain available
  under `.artifacts/circe-device-setup/`.


## Main-to-web sync — 2026-10-28

Merged the 12 new `main` commits through `d949c928` into `web`. At the time of
verification, `origin/main` and `upstream/main` both pointed to that commit.
The merge retained Circé's download-size diagnostics alongside upstream's image
validation tests. The refresh sign-in notice reads a loaded Save's Source through
an explicit Saves entrypoint, satisfying the feature ownership check.

The new native Safari operations are classified as host-only. A regression test
first reproduced the visiting Mac browser showing Safari controls, then passed
after those controls were restricted to the desktop runtime. Boundary tests also
reject all three native Safari queries and verify that `pipeline:refresh-blocked`
reasons survive the authenticated SSE stream. Upstream's notice tests cover the
sign-in action, retry after connection, and unloaded Saves.

- `pnpm check`: all 27 tasks passed; desktop 668 files passed, 4,627 tests passed,
  5 skipped.
- `pnpm build`: all 12 tasks and existing performance budgets passed.
- `build:web` and the Circé extension build passed.
- `smoke-desktop.cjs --use-mock-keychain` passed with a temporary isolated Library.
- React Doctor changed-scope scans before and after the compatibility fixes both
  scored 90/100 with the same three advisories. The small media-kind lookup,
  sequential Safari probes and intentionally bounded embedding batches were
  reviewed; they did not identify a browser regression requiring a behavior change.
- The designated runtime owner restarted only the shared Circé host from the
  rebuilt bundles, preserving its sandbox. The authenticated restart check passed,
  followed by image/video byte ranges, pagination, search and Folder operations.
- The real browser smoke passed at 1280×900 and 390×844, with Circé explicitly
  resolved to the Mac's Tailscale IP. Image rendering, video seeking, Folder
  assignment/removal, navigation and reload persistence passed.
- Trusted HTTPS requests for Circé and Nono through `100.88.201.56` both returned
  200. The complete Tailscale Serve configuration before and after the host
  restart was identical; shared DNS, gateway and certificate setup were retained.

Local logs are `/tmp/circe-main-sync-{check,build,web-build,extension-build,
react-doctor,desktop-smoke,web-restart,web-http,web-browser}.log`. Physical Windows
and iPad acceptance of these new application changes was not repeated. Source
sign-ins and external network harvests remain separate from these offline checks.
The [sync process](sync.md) records the repeatable commands and a proposed sync-PR
workflow; no automatic updater or deployment was enabled.

## Pond 2.0.1 sync — 2026-10-28

Merged 19 new upstream commits through `029bfcb1`, including release `v2.0.1`.
The browser retains its transport and Circé branding. Refresh sign-in notices
now use upstream's public Saves pool entry, replacing the temporary lookup
helper added during the previous sync.

- The new browser adapter regression first failed because `machinePace` was
  missing. It now verifies unavailable thermal telemetry, local native-client
  detection, prompt-signal loading without a host app probe, and the version
  derived from the desktop package. Host boundary tests reject the native MCP
  client query over HTTP.
- The real browser run exposed an upstream keyboard regression: the global
  capture handler swallowed field and widget keys, so Escape did not close the
  Folder picker. A test reproduced the lost Enter/Escape events. The guard now
  stops propagation at the document bubble phase, allowing local field and
  document widget handlers to run before blocking window app shortcuts. All
  14 focused app-hotkey tests pass, retaining typing and search coverage.
- The smoke runner dismisses first-launch prompts through the actual Escape
  interaction and captures them as evidence. It does not suppress the product's
  prompt logic or follow external voting/share actions.
- `pnpm install --frozen-lockfile` passed, including the new video workspace.
- Final `pnpm check` passed all 28 tasks: desktop 678 files passed, 4,693 tests
  passed and 5 skipped.
- `pnpm build` passed all 12 tasks and the upstream performance budgets. The
  initial build exceeded the main startup budget; the optional native updater
  now loads at app readiness outside the sandbox, retaining the 3,200,000-byte
  limit. The final main static graph is 3,120.6 KiB against a 3,125.0 KiB limit.
- The browser and Circé extension builds passed. The extension manifest retains
  the Circé name and signing identity, with version 2.0.1.
- Native database/vector checks passed both files and all 8 tests. The protocol
  network smoke passed with the accented display name and ASCII HTTP headers.
  The final desktop startup/preload/preview smoke passed with a temporary
  isolated Library and mock keychain.
- React Doctor changed-scope scans before and after the compatibility fixes
  both scored 84/100 and reported no new diagnostics.
- The designated owner restarted the shared host with its existing sandbox.
  Authenticated restart retention, media ranges, pagination, search and Folder
  operations passed. The actual browser workflow passed at 1280×900 and 390×844
  through the Mac's Tailscale IP, including Folder assignment/removal, Escape
  dismissal, image rendering, video seeking, navigation and reload persistence.
- Circé and Nono both returned trusted HTTPS 200 through `100.88.201.56`.
  The full Tailscale Serve configuration before and after the update was
  identical. DNS, certificate trust and the shared gateway were retained.

Local logs use `/tmp/circe-201-*.log`. Live Source sign-ins, the new sensitive
model's network download/inference smoke, and physical iPad/Windows acceptance
were not repeated. The sync automation proposal remains unimplemented.


## Native bridge lifetime and resident processing — 2026-10-29

This implementation continues on `web` from `57ee6186` (Pond 2.0.1). Full browser
parity remains in progress. The immediate usage target is one active client at a
time, switching between Mac desktop and a Windows browser.

- The finite real browser identity suite passed visiting-device image upload and
  reset, icon and emoji selection, Cancel, invalid-image retry, name-only and
  combined name/mark rename, Settings Enter commit/Escape discard, bundle rename,
  managed host replacement and real key-file reauthentication. Original Library
  name/path/logo/mark were restored. File-input cancellation uses the DOM cancel
  notification; this does not claim physical OS-picker cancellation coverage.
- Shared Canvas tests exercise stale saves in both desktop/browser directions,
  rapid writes, an uncertain transport result, fresh-read recovery and concurrent
  rename preservation. Portable Canvas JSON remains unchanged. Broader real board
  interaction and device handoff acceptance is still pending.
- `pnpm --filter @pond/desktop smoke:enrichment` is a separate opt-in live-model
  check. It starts the built native application in a disposable profile, runs the
  pinned sensitive-content model through the real renderer/Worker, closes the
  visible client during processing and checks database/sidecar agreement. It then
  accepts a retry, crashes the owner before its scheduled scan, recreates it and
  verifies completion with one owner and no orphan window. Normal quit completes.
  The profile is removed by its parent after Electron closes; test keychain mode
  avoids accessing the user's keychain. This test passed.
- That model evidence covers images. Hidden-owner Florence, Whisper, audio/video
  decoding and each other model are not individually demonstrated by that probe.
  The unpackaged test reports single-threaded WASM fallback because production
  COOP/COEP headers are applied only to packaged native builds.
- Transport regressions cover a full-resolution 6000×4000 RGB photo as binary,
  vocabulary batches of 64/64/9, nine frame uploads within host admission limits,
  partial-upload cleanup, and acknowledged durable model invalidation.
- The repository check passed 28 tasks with 685 desktop test files and 4,718 tests before
  the final upload cleanup/Settings draft adjustments; final current-tree checks
  are recorded in local `/tmp/circe-parity-*` logs while this work continues.

Independent read-only review checked sender/Library/generation fences, request
settlement, restart/quit admission, cancellation and manual-retry durability.
Physical Windows acceptance and the remaining Library administration, archive,
preview, Source and OS workflows remain open. No remote-device result is inferred
from macOS Chromium.


## Native-backed browser acceptance — 2026-10-29

The implementation keeps one resident Mac owner and the shared Pond renderer.
The intended handoff is one active device at a time, with stale-tab guards retained.
These are actual finite Chromium/Electron interactions against the shared Circé
host, distinct from unit tests and physical Windows/iPad acceptance. Each fixture
run checked the original Library identity, pointer and full preferences before
cleanup; only explicitly owned test content was removed.

| Probe | Result and evidence |
| --- | --- |
| Identity | Real file chooser, icon/emoji/name/reset, invalid input, Cancel, combined mark/name and Settings rename passed; host restart and key-file reauthentication retained the result |
| Library administration | 12 groups passed create, checksummed backup, independently editable restore with a fresh Library ID, identity-preserving Move, recent/open/no-op, merge/repeat deduplication and cancellation |
| Maintenance | 15 groups passed watched-folder cancellation/checkpoint/pause/resume/stop, real Rescan, four repair preview/apply/cancel/stale flows and keyboard Undo. Ordinary Library open stopped hashing every original; recorded open completed in milliseconds |
| File actions | 17 checkpoints passed custom thumbnail, replacement, second GIF-frame actions, playable SRT, dotLottie validation, decoded WebP, redacted debug ZIP and visiting clipboard denial/empty feedback. Touch fit/hit checks covered 320/390/768/1280, 200% desktop zoom and 390 RTL |
| Detached previews | 8 groups passed image transformations/navigation/slideshow/download/close, real popup denial with shared-dialog fallback, and playable 320/390 touch video controls |
| Archive replay | 22 groups passed actual decoded page assets and nested frame/worker navigation, shared HUD, hostile-content and forged-message rejection, read-only collection configuration, worker stop/restart, trusted external-link confirmation, range semantics and revocation. A fresh TLS socket connected to the Mac Tailnet IP with the exact replay hostname and public CA; native archive SHA remained unchanged |
| Copy and storage | 8 groups passed cancellation/no-write, byte-exact copy with notes/tags/fresh IDs, repeat/self-copy, destination open, immediate storage-limit behavior and reload. The owned sparse storage fixture and destination Libraries were removed |
| Drag/history | Actual trusted CDP dragstart/data/drop changed Folder membership and survived reload. Trash, keyboard Undo and original checksum passed without a false native-only error |
| Eagle | 5 groups passed actual folder selection/cancel, 2 Saves with 18 streamed files across two imports, zero-byte and Unicode files, native metadata/folders/tags/progress and repeat deduplication. Upstream repeat folder-tree behavior was preserved |
| Settings/Quick Preview | 15 groups passed host-labelled Settings and source-build update guidance, device-local zoom/reload, 150% Canvas tile/camera math and persistence, Quick Look Space/Escape/hold/blur, 320/390/768 touch controls and constrained 200% dialogs. This earlier run measured the image zoom pill at 28px; the final PWA follow-up below verifies its corrected 44px target alongside Close/step controls |
| Transfer recovery | 4 groups passed a real missing-original failure, physical Retry/Cancel, completed receipt and byte-identical automatic, explicit and reload downloads of a 268,471,644-byte ZIP containing 32 originals. Cancellation and subsequent retry settled correctly. Exactly two owned terminal records/checkpoints were retired while the host was stopped, retaining 24 unrelated history rows |
| Large upload | A 314,572,800-byte streaming HTTP upload exceeded the former 256 MiB ceiling, matched staged size and Library binding, and was explicitly retired without importing a Save |
| MCP context | Actual initialize, tools/list, query_library and list_folders used the intended native launch descriptor in an owned disposable profile. EOF/termination completed, temporary data and probe session were removed, and protected host files were unchanged |
| Production handoff | A real same-Library host replacement preserved the existing cookie. Explicit logout returned 401 and removed its persisted digest. Fixture controls were disabled and the complete Tailscale Serve configuration stayed identical |

Private evidence is retained under `.artifacts/web-verification/` and
`.artifacts/research/browser-parity-implementation/`; logs use
`/tmp/circe-parity-*.log`. Credentials, Source cookies and private keys are not
part of those reported results. The production PWA and real host-font probes are
recorded below once complete.

The iOS device runner failed `xcodebuild build-for-testing` and failed again on
its single prescribed retry. Device work stopped; Safari was left at the fresh
simulator's untrusted-certificate warning. No CA trust or device setting was
changed. Physical iPad installation/offline/media behavior, physical Windows
clipboard/sharing and the complete new Windows feature matrix remain unverified.
The owner's earlier confirmation that the short address loads on Windows is
retained as a connectivity result, not expanded into feature coverage.


## Production PWA — final real acceptance

The clean final run passed all fifteen checks against one stable production
build. No critical target failed the 44-pixel minimum. Real trusted input covered
320/390/768-pixel coarse-pointer layouts, 390 RTL and 390 at 200% interface zoom:
Library navigation, uniquely matched search, Save double-tap, useful image
rendering, Fit, Back and Clear. Phone drawers started closed; opening one closed
the other, and both the outer panel and inspector child fit and received input
at 100% and 200%. Zoom Out, Zoom Ratio and Zoom In all met 44px at rest.

Actual decoded 180/192/512 icons, manifest scope and activated root service worker
passed. CacheStorage contained only offline.html and app-icon-192.png before and
after visiting the Library. The protocol safe-area check verified real computed
insets rather than replacing application CSS.

Offline transport was applied to both the disposable page and its exact
app-sw.js worker. Actual worker requests failed with ERR_INTERNET_DISCONNECTED;
the real navigation came from the service worker and displayed reconnect
guidance. An uncached authenticated session fetch failed. The browser reported
navigator.onLine=true in this emulation; that advisory signal was recorded rather
than substituted for transport evidence. Trusted Try again completed a new
Document with an online 200 session response and the same Library ID.

Settings Disconnect → Cancel sent no DELETE. Confirm sent exactly one DELETE
and the revoked cookie returned 401. The phone login fields met 44px, and an
actual file chooser plus FileReader reauthenticated to the same Library. The
original identity, pointer, full host preferences, stable Save fields/original
SHA, exact device storage, direction and window size were unchanged after
restoration; the disposable session was revoked and cleanup completed.

The tests caught and fixed real mobile defects: undersized controls, RTL drawer
anchors, scaled drawer width and fixed inspector-child width, overlapping phone
drawers, and native Mac traffic-light padding in a browser titlebar. Their other
failed attempts remain recorded as harness issues: delayed native welcome
dialogs, measuring transient press animation, applying offline only to the page,
and retaining an old-Document JavaScript waiter across real navigation. The
final run kept the physical input, byte/state and 44px assertions.


## Host font activation — final real acceptance

Four groups passed in 7.9 seconds. A newly generated, unique synthetic TTF was
absent from CoreText before the run. Trusted FontViewer actions labelled
“on your Mac host” copied it into the real OS user Fonts/Pond directory. Native
activation state, the sidecar, file inode/checksum and browser reload agreed;
fresh Swift processes resolved only that exact nonce PostScript name. The
visiting browser's Download Original had the identical SHA.

Native Deactivate removed the exact file and sidecar, cleared the native flag
and made fresh-process CoreText lookup false again. Cleanup purged the owned
Save and removed only the newly created, verified empty Pond font directory;
the preexisting Fonts directory and all personal fonts were untouched. Original
Library identity/pointer/full preferences were unchanged. The passed run revoked
its exact session and verified 401.

An earlier setup attempt stopped before activation after a delayed native welcome
dialog interrupted text selection. It purged its Save and never installed an OS
font. Its disposable profile was removed before explicit session revocation was
added, so that attempt's server-side session cannot be claimed revoked; no raw
cookie was retained or guessed for cleanup. It remains subject to normal expiry.

This proves Mac host activation and visiting-device download, not silent font
installation on Windows or iPad. Those devices use their own ordinary font
installation facilities.


## Bookmarks and Mymind — final real acceptance

Four groups passed through the actual New menu and browser file-chooser
selections. The probe used a fresh, account-empty, AI-disabled Library and paused
the native reconciler before any import. Its bookmark URLs were confined to a
forbidden loopback port; no live Source account or external request was used.

HTML imported two bookmarks and Chromium JSON imported one. Dates, nested
Folders/membership and repeat-import counts matched the native owner; existing
edited notes and tags remained intact. Mymind ZIP imported three and skipped two,
then repeated as zero imported/five skipped. Unicode/newline note content,
source identities and original PNG SHA matched. Tags followed Pond's existing
ASCII normalization policy rather than changing that policy in the adapter.
An empty bookmark export returned the exact native message with HTTP 422 and no
mutation. Browser reload retained the results.

Cleanup removed exactly six Saves, their known folders/tags, seven validated
uploads, the owned Library and its index. Original identity/full preferences,
exact pointer/history snapshots and reconciler pause state were restored. All
three current-run cookies were explicitly revoked and returned 401; no cleanup
error remained. Earlier setup failures were recovered from their nonce/dev/inode
ownership records before another run, and their captured cookies were revoked.

Actual OS file-picker Cancel remains unverified. Empty CDP file selection does
not itself emit native cancellation, and computer use could not uniquely
distinguish the finite Electron picker from the resident host's application.
The import probe therefore does not claim that cancellation passed. Earlier
identity/Eagle/thumbnail fixtures exercise the browser cancel-event handler by
dispatching DOM cancel; their successful selections, uploads and native outcomes
remain real. Host-folder chooser Cancel and transfer Cancel are separate real
in-app controls with actual trusted-input coverage.


## Final repository and runtime gate

- `pnpm check`: 28/28 tasks passed, 716 desktop test files passed/two skipped,
  4,940 tests passed/five skipped. Biome, Oxlint, architecture, unused-code,
  generated-file and type checks passed without weakening their rules.
- `pnpm build`: 12/12 tasks and all five unchanged budgets passed. Main startup
  measured 3,119.4/3,125.0 KiB; renderer initial JS/CSS measured 3,017.4/3,027.3 KiB.
  The separate production browser build passed.
- Real Electron ABI database/vector checks: two files/eight tests passed.
- Real desktop smoke passed visible startup, preload queries and detached
  preview creation/cleanup in its own temporary Library and mock keychain.
- React Doctor final changed scope: 77/100, 26 advisories across 270 files. The
  initial saved scan was 83/100 with 56 advisories across 157 files, so the raw
  score did decrease as scope expanded. New actionable diagnostics introduced
  during the work were fixed. Remaining groups are the previously reviewed
  serial resource/transaction loops, 17 smoke response-status checks whose
  existing assertions the tool does not recognize, and two unchanged upstream
  announcement/extension findings. No suppression or rule change was added.
- The designated owner replaced only the shared Circé host, retained its profile,
  proved same-Library login persistence and durable logout, and compared the
  complete Tailscale Serve configuration unchanged. Circé and Nono returned
  trusted HTTPS 200 when connected directly to the Mac Tailnet IP.
- Final authenticated health verified the original Library identity, all user
  configuration and the original reconciler pause flag. Its existing Source
  continued syncing, so its lastSyncedAt watermark advanced; it was preserved.
  The health probe revoked its own session and verified 401. The unrelated
  installed Pond process was not stopped or reconfigured.

Final logs use `/tmp/circe-parity-release-{check,build,web-build,restart,
desktop-smoke}.log`; native ABI and Doctor logs are separate. Runtime/PWA/
font/import ownership evidence remains private under ignored `.artifacts`.
This gate does not turn the explicitly unverified physical-device, OS-picker
cancellation or live provider/Source variants into demonstrated coverage.
