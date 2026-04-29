/*---------------------------------------------------------
 * This code based from
 * https://github.com/microsoft/vscode-go/blob/master/src/goDeclaration.ts
 *--------------------------------------------------------*/

import * as vscode from 'vscode';
import { patchPath } from './util';
import { BUILD_IN_LUX_VARIABLES, COMMENT, PATH_SEPARATOR, WORKSPACE } from './const';

export interface DefinitionInformation {
    column: number;
    line: number;
}

export interface GoDefinitionInformation {
    file: string;
    declarationlines: DefinitionInformation[];
}

interface WordType {
    type: "variable" | "macro" | "link" | "invoke" | "use_variable" | undefined
    value: string,
    find_all: boolean
    find_on_same_folder?: boolean,
}

export async function definitionLocation(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
): Promise<GoDefinitionInformation[] | null> {
    const wordType = getWordFromPosition(document, position);
    if (wordType == undefined || token.isCancellationRequested) {
        return Promise.resolve(null)
    }

    // multiple regex to find different case
    var regs = new Array<RegExp>()

    switch (wordType.type) {
        case "variable":
            regs.push(new RegExp("\\[(global|local|my)\\s+" + wordType.value + "\\s*="))
            regs.push(new RegExp("\\[macro\\s+[-_\\w ]+ " + wordType.value + "[\\s\\]]"))
            regs.push(new RegExp("\\[loop\\s+" + wordType.value + "\\s+"))
            break
        case "use_variable":
            regs.push(new RegExp("\\$" + wordType.value + "\\b"))
            regs.push(new RegExp("\\${" + wordType.value + "}"))
            break
        case "macro":
            regs.push(new RegExp("\\[(macro)\\s+" + wordType.value + "[\\s\\]]"))
            break
        case "invoke":
            regs.push(new RegExp("\\[(invoke)\\s+" + wordType.value + "[\\s\\]]"))
            break
        case "link":
            return [await openDocument(document, wordType.value)];
        default:
            return Promise.resolve(null)
    }

    if (wordType.find_on_same_folder) {
        return await fineDeclareionInSameFolder(document, wordType, regs, token)
    }
    else if (wordType.find_all) {
        let allResult: GoDefinitionInformation[] = []
        //check current file
        const r1 = await findDeclaretion(document, position, wordType, regs, token)
        if (r1 != null && r1.length != 0) {
            allResult.push(...r1)
        }
        if (token.isCancellationRequested) {
            return Promise.resolve(null)
        }

        // check include file
        const r2 = await findIncludeDeclaretion(document, wordType, regs, token)
        if (r2 != null && r2.length != 0) {
            allResult = allResult.concat(r2)
        }
        if (token.isCancellationRequested) {
            return Promise.resolve(null)
        }
        return allResult.length > 0 ? allResult : null
    } else {
        // check current file
        const r1 = await findDeclaretion(document, position, wordType, regs, token)
        if (r1 != null && r1.length != 0) {
            return r1
        }
        return Promise.resolve(null)
    }
}

async function fineDeclareionInSameFolder(
    document: vscode.TextDocument,
    wordType: WordType,
    regs: RegExp[],
    token: vscode.CancellationToken
): Promise<GoDefinitionInformation[] | null> {
    const dir = document.fileName.substring(0, document.fileName.lastIndexOf(PATH_SEPARATOR))
    const relativePattern = new vscode.RelativePattern(dir, "*.{lux,luxinc}")
    const files = await vscode.workspace.findFiles(relativePattern)

    let allResult: GoDefinitionInformation[] = []
    wordType.find_all = true

    for (const file of files) {
        if (token.isCancellationRequested) {
            return Promise.resolve(null)
        }
        const doc = await vscode.workspace.openTextDocument(file)
        const result = await findDeclaretion(doc, new vscode.Position(0, 0), wordType, regs, token)
        if (result != null && result.length != 0) {
            allResult.push(...result)
        }
    }
    return allResult.length > 0 ? allResult : null
}

async function openDocument(document: vscode.TextDocument,
                            path: string
): Promise<GoDefinitionInformation> {
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

    var filePathInfo: GoDefinitionInformation = {
        file: uri.path,
        declarationlines: [{line: 0, column: 0}],
    }

    return filePathInfo
}

function getDeclaretionLine(
    document: vscode.TextDocument,
    matchIdx: number,
    word: string
): DefinitionInformation {
    const pos = document.positionAt(matchIdx)
    const textLine = document.lineAt(pos.line).text

    const exclude = "[^-_\\w]"

    let col = textLine.search(new RegExp(`${exclude}${word}${exclude}`))
    col = col != -1 ? col : textLine.search(new RegExp(`\\b${word}\\b`))

    return {
        line: pos.line,
        column: col != -1 ? col + 1 : -1
    }
}

async function findDeclaretion(
    document: vscode.TextDocument,
    position: vscode.Position,
    wordType: WordType,
    regs: RegExp[],
    token: vscode.CancellationToken
): Promise<GoDefinitionInformation[] | null> {
    var defInfo: GoDefinitionInformation = {
        file: document.fileName,
        declarationlines: new Array<DefinitionInformation>(),
    }

    const offsetCursor = document.offsetAt(position)

    for (let regIdx = 0; regIdx < regs.length; regIdx++) {
        let cutTextCount = 0
        if (token.isCancellationRequested) {
            return Promise.resolve(null)
        }

        let curText = document.getText()
        let matchIdx = curText.search(regs[regIdx])

        if (matchIdx === -1) {
            continue
        }

        while (true) {
            if (matchIdx === -1) {
                break
            }
            if (token.isCancellationRequested) {
                return Promise.resolve(null)
            }

            const declaretionLine = getDeclaretionLine(document, matchIdx, wordType.value)
            const skipLine = document.lineAt(declaretionLine.line).text.trim().startsWith(COMMENT)

            if (!skipLine) {
                if (wordType.find_all)  {
                    defInfo.declarationlines.push(declaretionLine)
                } else {
                    if (matchIdx > offsetCursor) {
                        if (defInfo.declarationlines.length == 0) {
                            defInfo.declarationlines.push(declaretionLine)
                        }
                        break
                    }
                    defInfo.declarationlines = [declaretionLine]
                }
            }

            const cut = matchIdx - cutTextCount + 1
            curText = curText.substring(cut)
            cutTextCount += cut
            matchIdx = curText.search(regs[regIdx])
            matchIdx = matchIdx != -1 ? matchIdx + cutTextCount : -1

        }
    }

    if (defInfo.declarationlines.length != 0) {
        return [defInfo];
    }

    return findIncludeDeclaretion(document, wordType, regs, token)
}

async function findIncludeDeclaretion(
    document: vscode.TextDocument,
    wordType: WordType,
    regs: RegExp[],
    token: vscode.CancellationToken
): Promise<GoDefinitionInformation[] | null> {
    var defInfos = new Array<GoDefinitionInformation>()
    const text = document.getText()

    const includes = text.matchAll(/\[include (.+)\]/g)
    while (true) {
        const include = includes.next()
        if (include.done || token.isCancellationRequested) {
            break
        }
        const includeFile = include.value[1]
        const includeLine = include.value[1]

        const filePath = (await openDocument(document, includeFile)).file
        const p = filePath ? filePath : includeFile

        var newDoc: vscode.TextDocument | any = undefined
        var err: string = ""

        await vscode.workspace.openTextDocument(p)
            .then((includedDoc) => {
                newDoc = includedDoc
            }, (reason) => {
                err = String(reason)
                err = err.includes("cannot open file") ? "[include " + p + "] file not found" : err
            })
            if (err != "" || newDoc == undefined) {
                throw err
            }

        const includeResult = await findDeclaretion(newDoc, new vscode.Position(0, 0), wordType, regs, token)
        const hasResult = includeResult != null && includeResult.length != 0
        if (wordType.find_all && hasResult) {
            defInfos.push(...includeResult)
        } else if (hasResult) {
            return includeResult
        }
    }

    return defInfos;
}

function getWordFromPosition(
    document: vscode.TextDocument,
    position: vscode.Position
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

    // check is variable
    const isDiffWord = wordWithVar != '' && word != wordWithVar
    if (lineText.match(new RegExp(`\\$\\{?\\b${word}\\b\\}?`)) && isDiffWord) {
        if (BUILD_IN_LUX_VARIABLES.indexOf(word) != -1) {
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
    // check include file
    if (lineText.startsWith("[include ")) {
        const reInclude = new RegExp(/\[include (.*)\]/g)
        const file = reInclude.exec(lineText)?.[1]
        wType.type = "link"
        wType.value = file ? file : word
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

export class LuxDefinitionProvider implements vscode.DefinitionProvider {
    public provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Thenable<vscode.Location[]> {
        return definitionLocation(document, position, token).then(
            (defInfos) => {
                if (token.isCancellationRequested) {
                    return Promise.resolve([]);
                }
                if (defInfos == null || defInfos.length === 0) {
                    return Promise.reject("invalid");
                }
                let locations = new Array<vscode.Location>()
                defInfos.forEach(defInfo => {
                    const definitionResource = vscode.Uri.file(defInfo.file);
                    defInfo.declarationlines.forEach((value) => {
                        const declarationline = value
                        try {
                            locations.push(new vscode.Location(definitionResource, new vscode.Position(declarationline.line, declarationline.column)))
                        } catch (error) {
                        }
                    });
                });
                return locations;
            },
            (err) => {
                vscode.window.showErrorMessage(err);
                return Promise.reject(err);
            }
        );
    }
}