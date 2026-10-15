import * as vscode from 'vscode';
import { EXTENSION_ID, WORKSPACE, BUILD_IN_LUX_VARIABLES, PATH_SEPARATOR, COMMENT, EXECUTE_1, EXECUTE_2, ASSERT, ASSERT_BLOCK, PROGRESS_BLOCK } from './const';
import { getCustomVariable } from './configuration';

export interface WordType {
    type: "variable" | "macro" | "link" | "invoke" | "use_variable" | undefined
    value: string,
    find_all: boolean
    find_on_same_folder?: boolean,
}

export function getExtensionCommands(): any[] {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (ext == undefined) {
        return []
    }

    const pkgJSON = ext.packageJSON;
    if (!pkgJSON.contributes || !pkgJSON.contributes.commands) {
        return []
    }

    const extensionCommands: any[] = pkgJSON.contributes.commands.filter((x: any) => x.command !== 'go.show.commands');
    return extensionCommands;
}

export function isPositionInString(document: vscode.TextDocument, position: vscode.Position): boolean {
    const lineText = document.lineAt(position.line).text;
    const lineTillCurrentPosition = lineText.substr(0, position.character);

    // Count the number of double quotes in the line till current position. Ignore escaped double quotes
    let doubleQuotesCnt = (lineTillCurrentPosition.match(/\"/g) || []).length;
    const escapedDoubleQuotesCnt = (lineTillCurrentPosition.match(/\\\"/g) || []).length;

    doubleQuotesCnt -= escapedDoubleQuotesCnt;
    return doubleQuotesCnt % 2 === 1;
}

export function patchPath(path: string): string {
    const reVariable = /\$(?:\{(\w+)\}|(\w+))/g
    return path.replace(reVariable, (whole, braced, plain) => {
        let varValue = getCustomVariable(braced ?? plain)
        if (varValue == undefined) {
            return whole
        }

        if (varValue.includes(WORKSPACE)) {
            const workspaceFolders = vscode.workspace.workspaceFolders
            varValue = varValue.replace(WORKSPACE, workspaceFolders ? workspaceFolders[0].uri.fsPath : "")
        }

        return varValue
    });
}

export function getWordFromPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    includeBuildIn: boolean = false
): WordType | undefined {
    const wordRange = document.getWordRangeAtPosition(position, /\w+([-_]\w+)*/g)
    const wordWithVarRange = document.getWordRangeAtPosition(position, /(\$\w+|\${\w+})([-_]\${\w+}|[-_]\$\w+)*/g)

    const rawLine = document.lineAt(position.line).text
    const lineText = rawLine.trim()
    let word = wordRange ? document.getText(wordRange) : ''
    let wordWithVar = wordWithVarRange ? document.getText(wordWithVarRange) : ''

    if (
        !wordRange ||
        word.match(/^\d+.?\d+$/)
    ) {
        return undefined
    }

    var wType: WordType = {type: undefined, value: word, find_all: false}
    const isIncludeFile = document.fileName.endsWith(".luxinc")

    // check include file
    if (lineText.startsWith("[include ")) {
        const reInclude = new RegExp(/\[include (.*)\]/g)
        const file = reInclude.exec(lineText)?.[1]
        wType.type = "link"
        wType.value = file ? file : word
        return wType
    }
    // check is variable
    const isDiffWord = wordWithVar != '' && word != wordWithVar
    if (lineText.match(new RegExp(`\\$\\{?\\b${word}\\b\\}?`)) && isDiffWord) {
        if (!includeBuildIn && Object.keys(BUILD_IN_LUX_VARIABLES).indexOf(word) != -1) {
            return undefined
        }

        wType.type = "variable"
        wType.value = simpleVar(wordWithVar)
        // wType.find_all = true
        return wType
    }
    const invoke = rawLine.match(/^\s*\[invoke\s+([^\s\]]+)/)
    if (invoke) {
        const name = invoke[1]
        const col = (invoke.index || 0) + invoke[0].lastIndexOf(name)
        if (position.character >= col && position.character < col + name.length) {
            wType.type = "macro"
            wType.value = name
            wType.find_all = /\$(?:\{\w+\}|\w+)/.test(name)
            return wType
        }
    }

    const macro = rawLine.match(/^\s*\[macro\s+([^\s\]]+)/)
    if (macro) {
        const name = macro[1]
        const col = (macro.index || 0) + macro[0].lastIndexOf(name)
        if (position.character >= col && position.character < col + name.length) {
            wType.type = "invoke"
            wType.find_all = true
            wType.find_on_same_folder = isIncludeFile
            return wType
        }
    }

    const declaration = rawLine.match(/^\s*\[(global|local|my)\s+([^\s=\]]+)\s*=/)
    if (declaration) {
        const name = declaration[2]
        const col = (declaration.index || 0) + declaration[0].indexOf(name, declaration[1].length + 1)
        if (position.character >= col && position.character < col + name.length) {
            wType.type = "use_variable"
            wType.find_all = true
            wType.find_on_same_folder = isIncludeFile
            return wType
        }
    }

    return undefined
}

export async function convertIncludePath(
    document: vscode.TextDocument,
    path: string
): Promise<string> {
    path = path.replace(/"/g, "")
    path = patchPath(path)

    const homeDir =
      (globalThis as { process?: { env?: { HOME?: string } } }).process?.env?.HOME ?? "";

    path.startsWith("~") && (path = path.replace("~", homeDir))

    const isAbsolutePath = path.startsWith(PATH_SEPARATOR)

    let uri: vscode.Uri
    if (isAbsolutePath) {
        uri = vscode.Uri.file(path)
    } else {
        let curPath = document.uri.path
        curPath = curPath.substring(0, curPath.lastIndexOf(PATH_SEPARATOR));
        uri = vscode.Uri.file(curPath + PATH_SEPARATOR + path)
    }

    return uri.path
}

export function simpleVar(str: string): string {
    const braced = str.match(/^\$\{(\w+)\}$/);
    if (braced) {
        return braced[1];
    }
    return str.startsWith('$') ? str.slice(1) : str;
}

export function skipLine(text: string): boolean {
    const trimmed = text.trim();
    return trimmed === '' ||
           trimmed.startsWith(COMMENT) ||
           trimmed.startsWith(EXECUTE_1) ||
           trimmed.startsWith(EXECUTE_2) ||
           trimmed.startsWith(ASSERT) ||
           trimmed.startsWith(ASSERT_BLOCK) ||
           trimmed.startsWith(PROGRESS_BLOCK);
}
