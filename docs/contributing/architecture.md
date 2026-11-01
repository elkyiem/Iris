# Desktop architecture

Pond is a local-first desktop app. The library on disk is authoritative; the database is its index. The main process owns persistence and privileged operations. The renderer owns presentation and optimistic state. Preload exposes the desktop interface. Cross-runtime schema definitions belong to the schema package or desktop shared contracts.

## Code map

Renderer code is grouped by product ownership under `features`: library, saves, search, sources, tags, downloads, agent, settings, enrichment, and captures. A feature contains its components, hooks, state, operations, and colocated tests. `app` composes features and windows, and `shared` owns reusable controls and infrastructure, including preferences (`shared/state/prefs`), the resolved theme, UI sounds, and Settings navigation.

A feature's public entries are the files at its root: `index.ts`, `types.ts`, and narrow entries such as `saves/pool.ts` or `enrichment/status.ts`. Other features import only those entries (`@/features/saves`, `@/features/saves/pool`), never a deeper path. Add a narrow entry, named for what it exposes, when the root entry would create a runtime cycle or load route-split or lazy code into a static chunk; lazy imports target a narrow entry too. `pnpm architecture:check` enforces this for production modules. Tests, `app`, and `routes` may import feature internals.

```text
apps/desktop/src/
├── main/                  # Electron startup, IPC handlers, core operations, persistence
├── preload/               # Typed renderer capability bridge
├── shared/                # Desktop contracts and pure shared definitions
└── renderer/src/
    ├── app/               # Window and feature composition, application effects
    ├── features/          # Product UI, state, operations, hooks, and tests
    ├── shared/            # Reusable renderer controls and infrastructure
    └── routes/            # TanStack route definitions
```

The main process separates startup composition, Electron integration, domain operations, persistence, and background work. `main/core` owns Library behavior and application workflows. `main/lib` owns reusable infrastructure with no product orchestration. `main/index.ts` composes startup dependencies, including database-open migrations. Domain modules consume explicit runtime operations rather than importing the startup entrypoint. Shared desktop contracts contain no main- or renderer-specific implementations.

Library search parses filters locally and can use on-device semantic matching. Natural-language model requests belong to Agent chat; the search bar does not call an Agent provider or expose a separate model-assistance preference. Older stored `ai.nlCompiler` values are ignored when preferences are parsed.

The Agent uses the Vercel AI SDK in the main process: `ToolLoopAgent`, `generateText`, and provider clients created with the user's key or a local base URL. Inference uses direct provider clients and native model IDs; Gateway is used only as a public metadata catalog. Renderer chat state comes from `useChat` and a Pond `ChatTransport` that posts JSON over a MessagePort and reads an SSE `Response` (`x-vercel-ai-ui-message-stream: v1`). Preload forwards serializable reply bytes through callbacks and returns a cancellation function; `AbortSignal`, `ReadableStream`, and `Response` stay in the renderer because their prototypes cannot cross the context bridge. The composer snapshots the selected model and run controls into each send, so immediate sends and retries do not depend on preference-write timing. Keys stay in main and the keychain. The model interprets each request and chooses tools through the SDK loop; there is no keyword intent router, forced pre-search, or automatic result selection. Library execution, citation validation, and Apply/Undo review remain domain operations. Composer drafts, Save attachments, the chat header, and review UI remain product state. Pond extras ride as UIMessage data parts (`data-pond-question`, `data-pond-review`, `data-pond-sources`, `data-pond-results`, `data-pond-steps`, transient `data-pond-activity`).

IPC composition also registers a discoverable Agent operation catalog. The `query` wrapper retains its input schema; Agent calls the same validated handler as preload. An exhaustive query-name classification controls exposure, and app controls compose the existing sync, pipeline, navigation, and history operations. Discovery and schema tools let the model choose capabilities without sending every operation schema on every turn. Large results have bounded, paginated access within the turn.

The authenticated loopback API exposes the same catalog to local automation. Read operations run directly. Mutations require an expiring preview token bound to the operation arguments and current Library identity. `pond-api` owns environment-independent transport and response validation. Raycast and `@pond/cli` inject credentials and lifecycle behavior at their application boundaries. Neither client reads SQLite or Library files directly.

Catalog mutations become persisted review requests containing the exact arguments and originating Pond identity. Apply revalidates both before execution, retains the result, and ignores already-applied reviews. Reviewed outcomes enter the next turn's context. Generic operations use Pond's global history where supported; their cards do not promise a per-change Undo. Credential entry and Library transitions use native flows. Internal derived-data writes, credential retrieval, recursive Agent calls, active-chat deletion, and index reset are excluded from direct catalog execution.

Visible replies persist in `agent_messages` with stable IDs, sources, questions, and review metadata. Each model's Fast, Context, and Reasoning choices persist independently. Fast stays off unless catalog metadata and a direct provider mapping confirm a native premium tier. Reasoning uses the AI SDK's portable setting and exposes only catalog-declared levels. Context is a whole-request token budget: main reserves output headroom, counts instructions, evidence, tool schemas, and messages, then removes the oldest complete turns. It repeats this budget before each tool-loop step and always preserves the current turn and complete tool pairs. Stored conversations remain intact. Chat listings do not expose model transcripts to the renderer. Reopening a chat reads saved messages without executing a turn. Header chat management uses typed rename and export queries. Main persists titles and writes visible conversation Markdown through a native save dialog; renderer owns clipboard export, confirmation, and chat draft cleanup. These chat-management queries remain excluded from Agent tool discovery. Main measures each accepted reply with a monotonic clock and stores optional elapsed milliseconds in its metadata, including failed or stopped runs. Final timing and tool outcomes cross the UI stream as message metadata and data parts; the renderer uses them for the collapsible work summary and never estimates missing historical timing.

Provider settings list only added Cloud, Subscription, and Local connections, in the order they were added, with each new provider last. Each section has its own Add Provider menu. Each connection is a `Settings.Card`. Cloud and Local setup forms use a key field, optional endpoint, Cancel, and Save. Subscription setup uses the installed CLI's authenticated plan, with Cancel and Connect instead of storing a key. The section list and the edit form measure their content and spring that height. Saving or connecting collapses the same card to its header: name, a Connected icon, Edit, Remove, the setup page, and an enable switch. The Agent composer chooses the language model from visible connected-provider IDs. An optional stored `visionModelId` still overrides image conversations when present; older preferences fall back to the provider model ID.

Settings groups Providers, Models, Personalization, and Model Context Protocol under Intelligence. Providers retains the `/settings/models` route and its existing aliases. Models is `/settings/agent-models` (`ai-models` alias) and lists every catalog model in one searchable table with visibility controls. Bookmarks to `/settings/models/$provider` redirect there. Model Context Protocol is `/settings/mcp`. Pond is a local stdio MCP server for this library. Settings lists Access switches (Search, Open, Export), setup steps for each MCP host, and the live Pond command under Advanced. Pond does not host an MCP URL. Personalization stores optional `userProfile` and `responseInstructions` fields in app-scoped Agent preferences on this computer. The main chat entry point reads them for each turn and includes them in completion context, with the current request taking precedence. Empty fields contribute no personalization context.

Library settings use focused routes: `/settings/library` owns identity and lifecycle, `/settings/storage` owns disk location and limits, `/settings/backups` owns backup and restore, `/settings/search` owns query behavior, `/settings/processing` owns on-device enrichments, and the Harvesting group splits incoming media across `/settings/schedule` (fetch schedule), `/settings/sources` (per-source download overrides, with child pages at `/settings/sources-<source>`), `/settings/images`, and `/settings/videos`. App shortcut editing lives at `/settings/shortcuts`; the workspace menu links to that page. Browser extension settings live at `/settings/extension` in the app-wide `extension` prefs slice; the extension reads them with the `extension.settings` native request and keeps a local copy for when Pond is closed. Legacy merged-page paths and anchors redirect to the focused owner. These pages reuse the existing preference sections and main-process operations; navigation does not create a storage migration.

The Agent composer and document viewer share Lexical Markdown extensions and ordinary block commands from renderer `shared/markdown-editor`. Agent keeps Markdown drafts, slash actions, Save mentions and submission in its own feature. The document viewer retains its custom nodes, embeds and Save persistence. The shared UI composer accepts an editor slot and remains independent of Lexical.

The composer offers a compact model menu with Fast, Context, Reasoning, and Model rows. Context, Reasoning, and Model open side submenus. Model search covers visible models from connected providers, including saved custom IDs. The Models page uses the full discovery catalog; `visibleModelIds` restricts only chooser results in the composer. An absent provider entry shows all models, and an empty array hides all. Hiding a model preserves existing selections.

The Models settings renderer queries only connected, enabled providers and caches each provider query for the app session. Catalogs stay fresh for 15 minutes; older results remain visible during background refresh, and provider connection changes invalidate the cache. Providers render as their queries settle, without waiting for slower hosts.

Provider model discovery is main-owned. Cloud metadata comes from the public Vercel AI Gateway REST catalog, cached for five minutes with concurrent request sharing and an in-memory last-good fallback. Providers without credentials or an explicitly connected local host do not appear on the Models page. After connection, native inventories supply valid inference IDs; exact catalog ID matches or unique display-name matches supply Gateway names, context/output limits, descriptions, capabilities, and Gateway pricing. Unmatched native models retain their provider identity without invented metadata. Local inventories reflect their servers. No bundled cloud list is injected, and discovery failures remain distinct from authentication rejection. Electron secure key storage, local Transformers inference, SQLite library search and Pond's outward-facing MCP server retain their respective ownership.

Use [CONTEXT.md](../../CONTEXT.md) for domain terminology and [code standards](code-standards.md) for naming, imports, types, and tests.

## Changes by example

Subscription providers (`codex`, `claude-code`) use `cli-language-model` as an AI SDK V4 adapter. `cli-runtime` owns executable discovery, inherited provider credential and routing removal, subscription sign-in and required-capability checks, bounded process output, timeouts, and cancellation of the process group. Each step runs in a temporary directory with CLI tools, MCP, and user or project customizations disabled. Codex receives an isolated home with a narrow link to its existing file-backed subscription credential and a generated model catalog whose effective metadata is checked for an empty native-tool surface. Keyring-backed Codex sign-ins are rejected during connection because their credential identity is bound to the canonical Codex home, which cannot also provide the isolated customization boundary. Codex can still describe its bundled system skills, but the isolated home and empty tool surface prevent those descriptions from reading files or executing capabilities. Claude Code still applies organization-managed policy hooks in safe mode; bare mode cannot replace it because bare mode does not read subscription OAuth or keychain credentials. Structured CLI output becomes ordinary SDK tool calls; the existing Pond tool loop owns execution and review. Settings stores connection flags, never CLI tokens. The default CLI model is offered without invented pricing or model metadata. Text and Library tools are supported; binary attachments require another provider.

Apple Intelligence (`apple`) uses `apple-language-model` as an AI SDK V4 adapter over `pond-apple-model`, a Swift helper built from `apps/desktop/apple-model` into `resources/bin` with FoundationModels weak-linked. Each step spawns the helper with one JSON request on stdin and reads one JSON reply on stdout; it never keeps a session. `apple-schema` converts tool JSON Schemas into the helper's schema tree, and the helper runs guided generation with `SystemLanguageModel.default` only, so output stays on the Mac. A reply holds text or one tool call, which becomes an ordinary SDK tool call. The model's context is about 4k tokens, so `apple-profile` gives it a short system prompt, a reduced read-only tool set, and a trimmed chat context. Settings lists it under Local on macOS only and connects without a key.

### Add a feature

Start with the owning product area. Keep its UI, operations, state, and tests together. Compose its route or window from application code. Export only the entries another module consumes. Put a helper in shared code only when its responsibility is independent of the feature.

### Add an IPC operation

Define the operation’s input and output in its domain contract under `apps/desktop/src/shared/`. Save reads, mutations, imports, exports, clipboard operations, and external-open operations use their focused `saves-*-contracts.ts` modules; inspection, conversion, and transfers follow the same pattern. `query-contracts.ts` is the closed aggregate consumed by preload, not the default owner for new domain types. Register the main handler in the matching focused module under `apps/desktop/src/main/ipc/queries/`; domain aggregators such as `saves.ts` and `library-locations.ts` compose those handler maps into the root registry. The preload query signature accepts declared names and inputs. Decode incoming values at the transport adapter. Main delegates to an operation that can be tested without Electron; preload exposes only the intended capability. Verify success, invalid input, failure behavior, and handler coverage. Preserve serialized compatibility for existing callers.

### Change shared UI

Implement the primitive in the UI package, with its styles and behavior tests. Feature-specific decisions stay in feature components.

### Test an operation

Accept the external capability the operation needs, such as a typed tag client or snapshot store. For example, `createNewActions` receives prompt, notification, navigation, and folder-refresh services; `RightPaneView` receives the active pane and content components while its wrapper owns stores and lazy imports. Production passes the real implementation. Tests pass a faithful in-memory implementation and exercise success, rejection, and cleanup. Do not mock the module loader.

## Compatibility

File organization is internal. Routes, stored preference keys, source ids, library files, and extension messages are compatibility contracts. Preserve them through a refactor. Continue to build the capture renderer, auxiliary windows, and inference workers; these are entrypoints even when no TypeScript file imports them.

Pond has no released Library or preference format older than the current one, so readers accept only current representations. External formats such as Eagle libraries and packages keep their readers at the import boundary. Agent provider state still treats `enabledKeys` as connected for a local provider until `connectedLocalProviders` records it. When a released format changes, add the reader or migration with its own test at the boundary that reads it.

Do not remove a compatibility path based on age alone. Preference readers and migrations can be removed only after the minimum supported direct-upgrade version already writes the replacement representation, every supported startup and Library-switch path has an idempotent migration test, and fixtures no longer contain the legacy keys. Disk-format readers and repairs have a stronger gate because a Library can remain unopened across releases: remove them only when every supported open and import path requires a portable completion marker written inside the Library, or when Pond ships a preflight converter that preserves an untouched backup and reports unsupported schemas before mutation. Record the oldest supported preference and Library schema in release notes when either cutoff changes.

## Library storage

Library encryption and folder locking are not product features. Library files, metadata, media, indexes, backups, and exported packages use plaintext storage. The renderer has no Security settings page, lock screen, password-protected folders, or lock lifecycle. IPC sender validation, loopback API tokens, reviewed Agent mutations, and provider credentials in the operating system keychain remain separate application boundaries.

`main/core/storage` owns file and media access.

Save previews may open in image presentation and detached image/video windows with optional always-on-top. Detached video owns playback resources and releases them when its target changes or the window closes. Main remains the sole owner of file access, and auxiliary windows receive only the capabilities they need for the active Library. Image rotation and horizontal flip may explicitly replace supported originals; destructive transforms require confirmation and run through the executor journal so failure recovery and Undo cover the original bytes and index update together. Interface zoom may be configured from 50 to 200 percent, independently of media zoom.

Compatibility fixtures under `apps/desktop/test/fixtures/compatibility` freeze the plaintext and external representations that Pond must continue to read. Storage, window, transform, and zoom changes must retain behavior tests against those baselines before changing a serialized format.

## Verification boundaries

Settings pages share the default `Settings.Page` width and spacing; individual sections do not override the page width.

Run `pnpm architecture:check` for runtime dependency cycles, process/shared-code boundaries, and feature entries. Type-only imports are excluded from the runtime graph. Run `pnpm check` for the required local code checks and offline tests, then `pnpm build` for bundles and performance budgets. Use `pnpm knip` separately when pruning; check non-TypeScript and dynamic entrypoints before accepting a deletion.

Save previews can open in app-owned presentation and detached always-on-top windows. A dedicated sandboxed preload exposes only typed preview state, configuration, neighbor navigation, and close capabilities. Main validates the Save and image before creating a window, closes auxiliary windows during Library transitions and shutdown. The older `preview.pin`, `preview.configure`, and `preview.neighbor` command names remain removed rather than becoming an undocumented compatibility surface.

The renderer save pool lives under `features/saves/state/`. Library state owns navigation, folders, and saved views. Library may compose Saves, but Save modules cannot import Library modules. App-level bridges expose the narrow Library actions needed by Save menus and viewers. Tag operations live under `features/tags/operations/`; both the library Tags page and settings consume that feature. Shared UI primitives remain in `packages/ui`, independent of desktop stores.

Agent chrome lives in `@pond/ui` as Pond-owned compounds (`Thread`, `Composer`, `Message`, Markdown, ToolCall, Prompt, Reasoning). They take props from `useChat` and do not wrap Assistant UI primitives. Feature-specific widgets (consulted saves, review, model picker) stay in the desktop pane. Renderer vendor chunks assign modules to their own packages without recursively absorbing dependencies.

## Dialogs

`@pond/ui` exports one `Dialog` API. `Dialog.Root` selects standard or alert semantics with `variant`; paged popups require both `pageId` and `depth`. Static bodies use `Content`, and paged bodies use `Viewport`. Page context and measurement are internal. Header Close defaults to a circular icon button; `render` supports custom footer dismissal buttons. `Cancel` and `Confirm` are styled actions and do not close a flow automatically.

Application composition mounts one `Dialog.Host` inside `Dialog.PortalProvider`. Dialogs render to the document by default; development galleries may register one `Dialog.PortalTarget` to contain real dialog surfaces inside a clipped preview frame. `Dialog.confirm` and `Dialog.prompt` accept presentation options and completion callbacks; the UI package owns their input, pending, error, and dismissal behavior. Callers own domain operations. Commands return void, preserve payload replacement behavior, and require the host in the same renderer. Custom source flows remain compositional. `createHandle` and `createAlertHandle` support standard and alert roots respectively; `Dialog.Handle` remains the standard handle constructor.

Controlled flows must retain their last popup content while `open` becomes false. Base UI completes portal cleanup from the popup exit lifecycle; removing only Popup immediately can leave an invisible backdrop intercepting clicks. SourceFlowHost retains its last page and depth for this exit. Connect and Watch setup stay in that paged dialog. Account and Watch details open as a full page at `/sources/<kind>/<id>`.

RSS and Atom Watches use Source `web` and Watch kind `feed`. The Watch handle stores the feed URL, including its path and query. The main process checks the XML before it creates the Watch. Feed links use the normal enqueue rules, so each Save keeps the Source of its URL. Watch checks compare both Source and Source ID to find new Saves. Feed Watches use the existing schedule and incoming Save controls.

The schema package owns Watch kinds, supported Sources, session requirements, labels, and feed URL rules in `watches.ts`. Main and renderer code use these shared rules. The Watch feed reader also reads Pinterest RSS feeds. The Pinterest adapter owns its feed address and request header. The response size limit helper belongs to `main/lib`; the feed reader and WARC recorder use it.

Queue V2 is a main-owned durable scheduler backed by the active Library's
SQLite index. Task claims use short immediate transactions, source and
operation lanes are admitted before a lease is created, and completion uses
the lease token plus cancellation fence as a compare-and-set guard. Source
budgets, breaker state, generation state, and attempt history are durable.
Downloads, the sidebar, and the tray project that shared state through typed
queries. They never infer queue truth from renderer activity.

The main process remains the sole database settlement authority. A small
`utilityProcess` pool runs validated Node-compatible image processing, image
probing, and poster extraction jobs. Each request and response carries its task
lease token and cancellation fence. Worker timeout, exit, or malformed output
fails the attempt in main, where the normal retry policy applies. Browser
session harvesting, page archives, tweet capture, text-card rendering, Library
file writes, and every task-state transition remain main-owned. Library
switches pause claims and drain accepted work before paths or database
ownership change. Mac suspend extends current leases; resume refreshes their
heartbeats before claim admission restarts.

Downloads activity is main-owned transient state, exposed through the typed `downloads.activity` query in the shared download activity contract. The reconciler owns task lifetimes; workers report observed phases and per-transfer measurements through their context. Direct media fetches report response and first-byte timings and streamed byte counts; yt-dlp reports its structured progress fields. Request telemetry includes only the method, hostname, status, and content type. Unobserved measurements remain absent. Snapshots bound recent task, transfer, and phase history, discard late worker callbacks after settlement, and clear when the development app switches libraries; production switches restart the process. The renderer polls this snapshot for the Downloads page instead of persisting or broadcasting each progress update.

Smart Folders, Groups, and Saved Views share the existing saved view persistence and IPC operations, distinguished by kind and optional parent group. Main validates group membership and prevents cycles; deleting a group promotes its children atomically. The library feature owns their sidebar tree and selection. Editable filters stay separate from inherited ancestor conditions, which are combined with AND for library retrieval. Only Saved Views restore layout and sorting.

Canvases are main-owned JSON files under the Library's `canvases/` directory, one per Canvas, written atomically through `library-config` and validated against `shared/canvas-contracts.ts`. Items reference Saves by ID, so trashing or deleting a Save leaves a placeholder instead of corrupting the file. `canvases.update` replaces content and never the name, so autosave cannot undo a rename. The canvas feature owns the sidebar group, the store, and the route-split board; while a board is open, Saves added from the sidebar or Save menus go through that board so a pending autosave cannot overwrite them. Save menus reach Canvases through the Save Library bridge. Array order in `items` is paint order, so layer commands reorder the array. Copy and paste carry items as `application/x-pond-canvas` JSON validated by `CanvasClipSchema`, with a plain-text fallback, so a copy pastes into any Canvas in any window. Pasted or dropped files, links, and images import as Saves through the same `pasteImportOf` and `runPasteImport` path the Library uses, then land as cards. Sections render beneath every other item and own nothing in the file: a drag carries whatever sits wholly inside the section's frame. Groups are a shared `group` ID on each member. Export pans the board tile by tile, captures each tile with `canvases.capture`, stitches them in the renderer, and hands the PNG to `canvases.export`, which writes it or wraps it in a one-page PDF. Rotation is a visual transform on the item, so resize handles and connector anchors stay on the upright box. Sections stay upright. Note text may be a small HTML subset, and a Save card stores its crop as four fractions of the image.

Fish are main-owned records in the Library's `fish.json`, validated against `shared/fish-contracts.ts`. A missing file reads as the default fish, and the default fish cannot be deleted. Chats link to a fish through `agent_chat_fish`; a chat without a link row belongs to the default fish, so chats from before Fish need no migration. `sendMessage` loads the chat's fish and adds its name and instructions to the context. It passes the fish's folder and tag scope as a `filter` on the library retrieval scope, so every library tool honors it. Attachment-scoped turns skip that filter. Main broadcasts what each fish is doing on `IPC.fish`, so the sidebar mark animates without polling. Routines live in `main/core/fish`: a five-minute schedule and a debounced listener for new Save inserts each start a run in its own chat, and the changes it proposes wait for review like any other Agent change. The fish feature owns the sidebar group, store, editor, and mark; the Agent pane reads the active fish from the Agent store and sends with the fish's model when it has one, so the composer's model picker edits that fish instead of the global default. `/fish/$fishId` is the full page, and `/assistant` redirects to the default fish.

The Raycast extension is a separate workspace app and never reads Library files
directly. It uses the authenticated loopback HTTP API for search, capture,
active Library information, recent Libraries, and Library switching. The
desktop keeps lifecycle coordination and relaunch behavior in the main process.
The Pond CLI launches the app through a platform adapter, waits for bounded
readiness, then uses the same local client and operation previews.

Conversion presets are stored in `conversion-presets.json` in the library. The main conversion job registry owns progress, cancellation, and a two-job concurrency limit. Sharp image conversions and FFmpeg GIF exports share collision-safe file writers; originals remain unchanged, and completed outputs remain available after cancellation or a later-file failure. IPC asks for an export directory through Electron, while authenticated HTTP and MCP accept an explicit destination. Both adapters use the same validated presets and job operations. Library switches prevent remaining items in an old job from resolving against the new library.

The executor serializes mutations and creates a `.transactions` journal before changing Save files or organization metadata. Journals snapshot touched files; destructive operations additionally snapshot originals. SQLite records a commit receipt atomically with index updates and sync events. Opening a library restores journals without a receipt and discards journals whose operation committed. A failed rollback retains its journal and blocks further executor writes to that library until restart recovery succeeds. Library switches stop worker and transfer admission, suspend and drain executor work before changing active paths, and clear undo history after a successful switch. Pipeline metadata persistence shares the executor mutation scope through AsyncLocalStorage; nested writes remain admitted until the outer operation finishes. Explicit user-title locks are stored beside item metadata, included in the update transaction journal, and reversed with undo. Folder membership updates use the `save_folder` transaction model so info metadata, the membership index, and undo follow the same path.

Collection interaction separates the focused cursor, range anchor, and selected IDs. The Library feature owns folder, Smart Folder, Group, Saved View, and Quick Access selection. Combined organization browsing composes existing query predicates as a union; folder entry updates navigation and the query directly. Batch folder moves send explicit IDs, a destination parent, and optional insertion target through `folders.moveBatch`; main owns hierarchy and ordering validation.

The Saves feature owns result navigation, the gallery cursor, and full-query selection resolution. Packed layouts register geometry with result navigation; the gallery keeps one focusable listbox and a mounted active descendant across virtualization. Native and keyboard Select All/Invert share the full-query operation, with stale-query cancellation. Keyboard effects gate commands by their focused collection or viewer; editable controls and overlays keep their own keys. Shared DataTable owns the same cursor/anchor distinction independently of desktop stores, including virtual reveal and focus return. Window receives current pane widths from composition and exposes keyboard separator operations. Spatial viewers consume their keys at the focused stage before application handlers. Optional dialog hosts retain their last payload while loading the body on first use; closing still completes the popup exit lifecycle. The dotLottie export handler loads ZIP support after the destination is chosen, keeping optional archive code out of the main startup graph.

Bulk selection mutations cross IPC as explicit IDs through `saves.bulkEdit`. Main loads only the metadata needed to prepare rating, tag, trash, restore, and purge operations; the renderer pool is an optimistic projection and never determines mutation membership. Main validates the complete selection before committing one transaction batch. Purge remains permanent and does not add an unusable undo entry. Clipboard and external-open commands hydrate missing rows before resolving files or links; enrichment commands run against the resident host owner, which hydrates the authoritative Library pool.

## On-device processing resources

Enrichment revalidates the current Save and enabled preference when a queued job starts. Processing preference changes rescan eligibility. The inference worker serializes requests, reuses one multimodal embedding bundle with shared text weights, and releases the worker after fifteen seconds without pending requests. Main reports macOS kernel memory pressure, or available-memory pressure on other platforms, through the existing machine-pacing bridge; inference yields under pressure and resumes automatically.

`media.decodeAudio` is an internal, validated IPC operation for files in the active Library. Main runs bounded FFmpeg extraction and returns at most thirty seconds of mono 16 kHz PCM. It never reads a complete video into the renderer to obtain that segment. Full transcription retains its existing complete-recording behaviour and byte limit, enforced during the response stream. Video sampling uses one decoder for the first thirty-two seconds. Video inference retains every sampled frame and aggregates frame-count-weighted batches of at most sixteen; the media preprocessing version distinguishes these derived vectors from earlier whole-video embeddings.

`scripts/verify-enrichment.cjs` runs finite Electron checks against an isolated Library with real models. Performance comparisons prepare identical media and posters before admission, retain enabled processing preferences, wait for persisted results and a drained queue, and record active and idle resource use separately. The large-file and queued-cancellation modes remain separate from timed comparisons.

## Auxiliary window composition

Settings has a dedicated renderer and scoped preload. Its singleton native window reuses the section registry, search and provider UI without booting Library selection, ingestion or enrichment effects. Main broadcasts committed preferences to every renderer; Settings delegates Processing rescans to the resident enrichment owner rather than starting a second loop. Settings deep links and native commands select the same window, while app activation explicitly creates or focuses the Library.

The app composition layer passes the Library's full selection and folder membership to the Save inspector; a full viewer continues to inspect one Save. Immediate folder assignments use deltas and notes/tag removal use main-owned bulk transactions with Undo. Inspector text drafts are keyed by target IDs and retain failures for retry.

## Circé browser transport

Source sign-in notices use the Saves feature's existing `saves/pool.ts` entry
for loaded Save reads, following the upstream feature boundary.

The browser's machine pacing uses visiting-device visibility and focus, with
unknown thermal state and a default battery value where those signals are not
available. Native MCP-client detection resolves locally to an empty client list;
it does not inspect the host's installed apps. This keeps shared prompt selection
working without exposing native desktop operations. The native updater module
loads at app readiness only outside an isolated sandbox.

The Circé browser entrypoint installs an HTTP implementation of the renderer
capability boundary before loading the shared application. A separate, opt-in
Electron listener owns authenticated browser queries, media and SyncAction SSE.
Its generic query allowlist excludes Source/provider credential reads, native dialogs and Library
transitions. A dedicated Library transition endpoint currently bridges real bundle
renames; visiting-device files use scoped binary uploads. Electron remains the
single persistence and queue owner. See the
[Circé architecture decision](../circe/architecture.md) and
[local runbook](../circe/runbook.md) for isolation, origin/session policy and the
remaining platform boundaries. The desktop and browser retain separate transports into the same native owners.

Authenticated Settings can explicitly copy or rotate the native local integration
token for Raycast on the host. This is a host-wide credential: Raycast uses Library
listing and switching operations that scoped search/export tokens cannot perform.
Its existing rotation confirmation remains, and neither Source/provider secrets
nor the general web access key have read endpoints. Bind addresses, CORS and
native API authorization are unchanged. Replay origins cannot call these Settings
operations or receive the integration token.


## Resident enrichment owner

`main/core/enrichment-owner.ts` owns one hidden, sandboxed renderer per active
Library. Its scoped preload permits only the reads, derived writes, media decoding,
progress and validated title mutation needed by the existing enrichment code.
`renderer/enrichment.ts` composes the upstream Save bootstrap, full-pool hydration,
preferences, registry and inference Worker without mounting the application UI.
Visible desktop and browser windows observe coalesced processing status and send
manual tasks or interactive search inference to this owner.

A manual retry persists model-stamp invalidation in main before acknowledging its
scan request. Prior content and vectors remain until replacement. Processing
completion waits for persistence acknowledgement. Worker startup and requests
have deadlines; failure remains visible until the owner is replaced. Intentionally
hidden service pacing retains battery and thermal limits. Sleep stops the owner,
resume recreates it, and explicit quit permanently closes admission. Owner IPC
checks sender, Library and generation; stopping aborts main-owned media work.

Native inference tensors cross IPC as typed arrays. Browser tensors use bounded,
Library-bound upload tickets and `/web/inference`, then the same host owner.
Staging files are consumed after execution or removed after upload failure. Browser
clients never receive model/provider credentials or supply host file paths.

## Library request lifetime and Canvas writes

`main/core/library-access.ts` leases the actual asynchronous lifetime of native,
HTTP, chat, routine and conversion work. Location changes close admission, stop
background owners and drain readers before sealing database/path access. Transition
callers leave their own request lease so they cannot wait on themselves. The web
launcher retains its address while replacing an Electron child after a prepared
Library relaunch. It sets `CIRCE_WEB_SUPERVISED=1` so the child requests replacement
with exit code 75. A standalone host, including the Dock app, schedules its own
Electron relaunch after the same shutdown preparation. A new process restores valid
digest-only sessions and has a distinct readiness nonce.

The native history owner publishes revision and committed Undo/Redo availability
after background work as well as ordinary edits. Reads during an in-flight command
retain the last committed availability; a failed write cannot leave a reconnecting
browser with a transient empty snapshot at that revision. Browser keyboard Edit
shortcuts feed the existing surface Undo owner, preserving text-field and Canvas
history. Host-history commands are queued with their acknowledged revision;
out-of-order responses cannot lower it.

Repair jobs retain an independent lease through their final recoverable unit,
including work after the initiating IPC or HTTP request returns. Location changes
cancel and drain the repair owner; quit also closes its admission. Cancellation
remains running until in-flight writes settle. Retained job IDs are scoped to the
Library ID and root. Preview/apply/cancel control requests do not hold the mutation
queue while the repair performs its own commits.

The browser's host-folder chooser exchanges short-lived, session-, Library- and
purpose-bound handles. Display paths do not authorize operations. Main rechecks
canonical containment and directory identity before calling the same native
Library operations; a missing selection cannot open a dialog on the Mac. Browsing
and cancelling do not enter a location transition. Create uses a granted parent
and one validated name; move, backup and restore resolve complete destinations.

An explicit backup restore creates a separately editable Library with a new root
Library ID, preserving Save and organization identities and all other metadata.
Its index cannot reuse rows or sessions from the source. Move and rename preserve
the existing Library ID. Portable backups reject unresolved transaction journals:
their SQLite commit receipts are host-local, so recovery against a fresh index
cannot safely decide whether to roll back a copied journal.

Canvas snapshots carry a host-issued content version outside the portable JSON
format. Both preload and browser transports use `shared/canvas-client.ts` to save
against their last acknowledged snapshot and serialize their own requests. Main
rejects stale content while preserving independent renames. An uncertain write
requires a fresh read before retry; optimistic renderer state never supplies the
expected host version.

## Browser archive replay

`main/web/replay-host.ts` owns per-Save replay grants, their Portless routes,
request cancellation and shutdown. Each grant binds one sanitized archive revision
to a browser session, Library and parent origin. A fresh random origin under
`replay.elkyiem` has separate cookie ancestry from `circe.elkyiem`. Exact-Host
dispatch precedes application authentication and exposes only the fixed viewer,
bootstrap, UI, worker and scoped archive source. It never receives the application
key or a general API capability.

The browser receives a private WARC derivative with captured cookie and
authorization headers and request records removed. Native originals remain
unchanged. `replay-archive.ts` checks indexed files and their revision;
`replay-source.ts` serves bounded byte ranges. `library-response.ts` retains its
Library lease until the actual stream finishes or is cancelled. Grant revocation
aborts reads and waits for file handles before deleting temporary bytes. In-flight
revocations remain owned even after a grant leaves the routing maps.

The typed `browser/replay-worker.ts` uses the replay engine's supported subclass
hooks to pin its source and persisted collection configuration. Read-only engine
APIs and a separate HTTP worker policy apply to fresh and cached replay paths.
`replay-bootstrap.ts` observes current replay documents, frames and open shadow
roots for navigation; it does not poll or grant archived code application access.
The whole replay origin remains untrusted. The shared archive viewer keeps its
native webview on desktop and lazily uses `BrowserArchiveFrame` in browsers.
Parent messages require the current frame, exact origin, generation and schema.
External navigation is a proposal displayed in trusted Circé UI and requires a
user click. Already imported browser cache bytes are not securely erased by
revocation.

## Visiting-device Eagle imports

The browser's folder picker retains relative paths and uploads selected files
through existing Library-bound tickets. `main/web/eagle-import.ts` assembles only
those granted files into a private tree, rejects mixed roots, traversal and
ambiguous names, and waits for all assembly work before failure cleanup.
`core/eagle-library-import.ts` owns the existing native import options, shortcut
policy and paced progress for both IPC and HTTP. Native import progress uses the
authenticated status feed; upload progress remains on the visiting device.
`main/lib/private-work-directories.ts` tracks explicit temporary-directory
ownership for Eagle assembly and replay. Crash cleanup preserves another live
host's directories and all unrecognized or unmarked entries.


## Circé transfer delivery and production browser shell

The native durable transfer store remains the job owner. `web/package-import.ts`
retains an owned raw archive and reconstructible expanded source through retry;
unpacking is part of the cancellable job. `web/transfers.ts` includes packaging
and download receipts before Completed. The resident
`core/transfer-delivery.ts` registration lets native transfer queries reuse those
hooks and save a completed browser artifact through the desktop file picker.
Browser responses contain only authenticated download URLs, never native paths.
Streaming ZIP64 and random-access extraction retain cancellation, disk headroom,
explicit file-handle ownership and identity-checked partial cleanup.

`web/auth.ts` persists only expiring session digests in a mode 0600 file bound to
the current key. A same-Library host replacement preserves login; logout settles
the persisted revocation before acknowledging. Public built assets remain
available while a Library transition closes private request admission.

Browser interface zoom is device-local. Canvas normalizes CSS scale into its
physical camera and back into persisted world coordinates. PWA generation emits
manifest/icons and caches only the public reconnect page and 192-pixel icon.
Library data and writes remain online-only. Fixture controls are opt-in; Settings
owns ordinary browser disconnect. An explicit font activation on a Circé host
uses the real OS user Fonts directory, while normal isolated tests keep their
configured home and legacy installations remain removable.
