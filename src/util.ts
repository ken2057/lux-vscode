import * as vscode from 'vscode';
import { EXTENSION_ID, WORKSPACE, BUILD_IN_LUX_VARIABLES, PATH_SEPARATOR } from './const';

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

export function getCustomVariable(varName: string): string | undefined {
    return vscode.workspace
            .getConfiguration("lux.envVariables")
            .get(varName)
}

export function isShowBlockHighlight(): boolean {
    return vscode.workspace
            .getConfiguration("lux").get("showBlockHighlight", true)
}

export function patchPath(path: string): string {
    const reVariable = /\$\{?(\w+)\}?/g
    const match = reVariable.exec(path);
    if (match == undefined) {
        return path
    }

    let varValue = getCustomVariable(match[1])
    if (varValue != undefined) {
        if (varValue.includes(WORKSPACE)) {
            const workspaceFolders = vscode.workspace.workspaceFolders
            varValue = varValue.replace(WORKSPACE, workspaceFolders ? workspaceFolders[0].uri.fsPath : "")
        }

        path = path.replace(match[0], varValue)
    }

    return path;
}

export function getWordFromPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    includeBuildIn: boolean = false
): WordType | undefined {
    const wordRange = document.getWordRangeAtPosition(position, /\w+([-_]\w+)*/g)
    const wordWithVarRange = document.getWordRangeAtPosition(position, /(\$\w+|\${\w+})([-_]\${\w+}|[-_]\$\w+)*/g)

    const lineText = document.lineAt(position.line).text.trim()
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
        wType.value = word.replace(/^\$?(\$\{?)(.*)(\}?)$/, "$2")
        // wType.find_all = true
        return wType
    }
    // check macro
    if (lineText.match(new RegExp("\\[invoke " + word))) {
        const wR = document.getWordRangeAtPosition(position, /[-_\w${}]+/g)
        let w = wR ? document.getText(wR) : ''
        const reVar = new RegExp("\\$?\\$\\{?[_-\\w]*\\}?", "g")
        const hasVar = reVar.exec(w)
        if (hasVar && hasVar[0] != w) {
            wType.value = w.replace(hasVar[0], "[-_\\w]+")
            w = w.replace(hasVar[0], "")
            wType.find_all = true
        }

        wType.type = "macro"
        return wType
    }
    // check invoke
    if (lineText.startsWith("[macro ")) {
        wType.type = "invoke"
        wType.find_all = true
        if (isIncludeFile) {
            wType.find_on_same_folder = true
        }
        return wType
    }
    // check use_variable
    if (lineText.match(new RegExp(`\\[(global|local|my)\\s+${word}\\s*=`))) {
        wType.type = "use_variable"
        wType.find_all = true
        if (isIncludeFile) {
            wType.find_on_same_folder = true
        }
        return wType
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