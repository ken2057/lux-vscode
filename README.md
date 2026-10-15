# lux-vscode

Language support for [Lux (LUcid eXpect scripting)](https://github.com/hawk/lux) in VS Code.

https://marketplace.visualstudio.com/items?itemName=duyn.lux-vscode

## Features

- Lux syntax highlighting
- Go to definition
- Source lines for a Lux failure location

## Failure locations

A root file is the `.lux` or `.lux.tmpl` file for the test. A failure location contains source line numbers and loop counts separated by colons. It can also start with a Lux file name. Run `Lux: Show Failure Location` from the Command Palette.

Enter `path/a/b/test.lux:576:53:732:727` to find the file under a workspace folder. Enter `test.lux:576:53:732:727` to search by file name. If the active root file has that name, the command uses it first. If a root file is active, you can enter only `576:53:732:727`.

The command opens a temporary result editor. The trace lists source locations in order. A source entry shows its file, line number, source lines, and Lux syntax colors. Use `Go to Definition` (F12) on a file heading or source line to open the original file. If several files have the same name, select the correct file from the list.

A macro is a named block of Lux commands. If Lux selects a macro at run time, the command removes matches on comments and block boundaries. It then uses the next trace line and the literal macro arguments on the `[invoke]` line. If several paths remain, the file list explains the choice. It shows each macro name, line range, and source line.

A negative number shows how many times a loop ran. For example, `368:-2:369` shows `-2` as `looped 2 times`. That entry has no source lines.

If one index points to a `[loop]` line and the next points inside that loop, the trace marks the first entry `skipped loop header`. That entry shows the file and line without source lines. The next entry shows the loop in its source context.

A cache stores data from files that the extension read before. If the cache is enabled and its data matches the source files, the command uses its include and macro locations. Otherwise, the command reads the source files.

The `Lux Language Support` output channel records trace generation, missing files, rejected paths, and unresolved lines. It also gives the reason for each rejected path. To read these messages, run `View: Toggle Output` and select `Lux Language Support`.

By default, `lux.failureTrace.showFullMacroBlock` is `true`. If a location is inside a macro, the trace shows the full `[macro]` to `[endmacro]` block. Set it to `false` to show only nearby lines. For locations outside macros, the trace always shows nearby lines.

## Configuration

Use `lux.envVariables` to set environment variables that contain paths. For example:

```
"lux.envVariables": {
    "TEST_LIB_DIR_1": "~/repo/test/system/test"
    "TEST_LIB_DIR_2": "$WORKSPACE$/system/test"
  },
```

A path can be relative or absolute. You can use `$WORKSPACE$` in a path. The extension replaces it with the current workspace path.

## Known issue

The extension cannot find the destination when an `[invoke]` name contains multiple variables, such as `[invoke $a-$b 1]`.
