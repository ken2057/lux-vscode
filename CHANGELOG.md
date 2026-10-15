# Change Log

All notable changes to the "lux-vscode" extension are documented in this file.

## [1.1.1] - 2026-10-15

- Added syntax highlighting for `[event_log]` and its enable/disable options.
- Updated syntax scopes for config, variable definition, export, and include directives.
- Gave `?` and `=` the same color in `[global name?=value]` assignments.
- Added errors for unset include variables and missing include files in cached and text searches.
- Missing include errors show the path from `[include]` and the file and line that contain it.

## [1.1.0] - 2026-10-15

- Added a cache for `.lux`, `.lux.tmpl`, and included `.luxinc` files to speed up repeated definition searches.
- Updated Go to Definition to search the current file, included files, nearby files, and other cached files in order.
- Kept shared includes when the active root changes and removed cache entries that the new root does not use.
- Used cached macro and loop ranges for editor highlights and failure traces when available.
- Added `Lux: Show Failure Location` to show source lines, loop counts, and links to source files for Lux failure locations.
- Added `lux.cache.enabled` and `lux.failureTrace.showFullMacroBlock` configuration. Text search remains available when the cache is disabled.
- Added cache and trace generation messages to the `Lux Language Support` output channel.

## [1.0.12] - 2026-10-14

- Added syntax highlighting for `[loop]` blocks that repeat until an `@` pattern matches.
- Added file type `.lux.tmpl`.

## [1.0.11] - 2026-10-07

- Added syntax highlighting for `[export ...]`.
- Fixed custom variable parsing to only accept `${VAR}` or `$VAR` (no mismatched braces).
- Support multiple custom variables in one path (e.g. `$ROOT/${SUB}/file.luxinc`); unknown variables are left as-is.

## [1.0.10] - 2026-07-13

- Version bump only, no functional changes.

## [1.0.9] - 2026-07-13

- Fixed highlight when invoke has double-quote and esceped double-quote as the same time
- Fix invoke unable to jump to include file

## [1.0.8] - 2026-07-03

- Fixed highlight for shell/macro/invoke

## [1.0.7] - 2026-05-07

- Fix go to definition stop when include path not found

## [1.0.6] - 2026-05-01

- Added variable hover support and expanded caching work.
- Fixed string parsing, variable highlighting in brackets, and include navigation when variables are used.

## [1.0.5] - 2026-04-29

- Fixed go-to-definition landing on comment lines.

## [1.0.4] - 2026-04-29

- Small round of stability and usability fixes.

## [1.0.3] - 2026-04-29

- Improved go-to-definition for macros and variable usage, including cancellation handling.
- Added snippets and a setting to disable block highlighting.

## [1.0.2] - 2026-04-29

- Added block decoration support for macro, loop, and shell sections.
- Fixed shell parsing details and variable handling in sleep statements.

## [1.0.1] - 2026-04-28

- Added publisher metadata for packaging.
- Improved include parsing and XML highlighting support.

## [1.0.0] - 2026-04-27

- Initial release with Lux syntax highlighting, icons, and go-to-definition support.
- Added the first project documentation and license setup.
