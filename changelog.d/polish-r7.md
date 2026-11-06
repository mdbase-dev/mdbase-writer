## Changed

- Update Writer's production, LAB and staging SDK originals to 0.1.0-beta.157, retaining archive and publisher integrity verification.
- Explain rejected or long-pending sync without stopping SDK retries, with a local-drafts download action and a polite announcement.
- Defer preview drawing during sidebar motion, preserve semantic text on size-only redraws, and warm the typesetter while Home is idle.
- Avoid inherited grid-variable invalidation and post-render forced layout; yield between typesetting and bitmap installation so they do not consume one input-blocking task.
- Make the command palette and shortcut sheet toggle, expose existing chapter, manuscript, sidebar and preview actions, and keep one Find shortcut row.
- Match palette and shortcut-sheet toggles by logical key on non-QWERTY layouts, and retain Home's warmed compiler until workspace initialization or Home cleanup rather than expiring it after a minute.
- Prebundle Lingui's macro-generated runtime dependency on a cold development start, reject unexpected Vite reloads in the demo gate, and audit phone preview ink after revealing Preview rather than requiring hidden rendering.
- Use the shared shortcut notation in editor, comment, sidebar, export and outline tooltips on every platform.
- Align Continue with manuscript rows, tighten reference chips, use the stronger primary token and unread-comment fill, enlarge Cite and Find targets, and hide installation prompts on collection gates.
