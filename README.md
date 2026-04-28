# lux-vscode

Language support for [Lux (LUcid eXpect scripting)](https://github.com/hawk/lux)

https://marketplace.visualstudio.com/items?itemName=duyn.lux-vscode

## Features

- Syntax highlight
- Go to definition

## Extension Settings

If you have some environment variable that contain a path, you can use `lux.envVariables`
```
"lux.envVariables": {
    "TEST_LIB_DIR_1": "~/repo/test/system/test"
    "TEST_LIB_DIR_2": "$WORKSPACE$/system/test"
  },
```
It can be relative path or absolute path.
You can also set with `$WORKSPACE$`, the extension will use use current workspace when convert that path

## Known Issues

...

## Release Notes

### 1.0.0

Initial release

---
