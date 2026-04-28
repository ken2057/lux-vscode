
/*---------------------------------------------------------
 * This code based from
 * https://github.com/microsoft/vscode-go/blob/master/src/goDeclaration.ts
 *--------------------------------------------------------*/

import * as vscode from 'vscode';
import { getCustomVariable } from './util';
import { BUILD_IN_LUX_VARIABLES, COMMENT, PATH_SEPARATOR, WORKSPACE } from './const';

export interface DefinitionInformation {
    column: number;
    line: number;
}

export interface GoDefinitionInformation {
    file: string;
    name: string;
    declarationlines: DefinitionInformation[];
}

interface WordType {
    type: "variable" | "macro" | "link" | undefined
    value: string,
    find_all: boolean
}

export async function definitionLocation(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
): Promise<GoDefinitionInformation[] | null> {
    const wordType = getWordFromPosition(document, position);
    if (wordType == undefined) {
        return Promise.resolve(null)
    }

    // multiple regex to find different case
    var regs = new Array<RegExp>()

    switch (wordType.type) {
        case "variable":
            regs.push(new RegExp("^\\[(global|local|my)\\s+" + wordType.value + "\\s*="))
            regs.push(new RegExp("^\\[macro\\s+[-_\\w ]+ " + wordType.value + "[\\s\\]]"))
            regs.push(new RegExp("^\\[loop\\s+" + wordType.value + "\\s+"))
            break
        case "macro":
            regs.push(new RegExp("^\\[(macro)\\s+" + wordType.value + "[\\s\\]]"))
            break
        case "link":
            return openDocument(document, wordType.value);
        default:
            return Promise.resolve(null)
    }

    let result = await findDeclaretion(document, position.line, undefined, wordType, regs)
    if (result?.length != 0) {
        return result
    }

    return await findDeclaretion(document, document.lineCount - 1, position.line, wordType, regs)
}

async function openDocument(document: vscode.TextDocument,
                            path: string
): Promise<GoDefinitionInformation[]> {
    path = path.replace(/"/g, "")
    path = patchPath(path)
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
        name: "",
        declarationlines: [{line: 0, column: 0}],
    }

    return [filePathInfo]
}

function patchPath(path: string): string {
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

async function findDeclaretion(
    document: vscode.TextDocument,
    line: number,
    stop_at: number | undefined,
    wordType: WordType,
    regs: RegExp[],
): Promise<GoDefinitionInformation[] | null> {
    var defInfos = new Array<GoDefinitionInformation>()

    var defInfo: GoDefinitionInformation = {
        file: document.fileName,
        name: "",
        declarationlines: new Array<DefinitionInformation>(),
    }

    // file line start from 0
    for (let i = line; i > -1; i--) {
        if (stop_at != undefined && i == stop_at) {
            break
        }

        const lineText = document.lineAt(i).text
        const lineTextTrimed = lineText.trim()

        if (isSkipLine(lineTextTrimed)) {
            continue
        }

        const included = /^\[include (.+)\]/g.exec(lineTextTrimed)
        if (included != null) {
            const filePath = (await openDocument(document, included[1]))?.[0].file
            const p = filePath ? filePath : included[1]

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

            const includeResult = await findDeclaretion(newDoc, newDoc.lineCount - 1, stop_at, wordType, regs)
            const hasResult = includeResult != null && includeResult.length != 0
            if (wordType.find_all && hasResult) {
                includeResult.forEach((value) => {
                    if (value.declarationlines.length != 0) {
                        defInfos.push(value)
                    }
                })
            } else if (hasResult) {
                return includeResult
            }
        }

        for (let regIdx = 0; regIdx < regs.length; regIdx++) {
            if (lineTextTrimed.match(regs[regIdx])) {
                const regex = new RegExp(`\\b${wordType.value}\\b`);
                const index = lineText.search(regex);
                defInfo.declarationlines.push({
                    line: i,
                    column: index != -1 ? index : 0
                })

                if (wordType.find_all) {
                    continue
                } else {
                    return [defInfo]
                }
            }
        }
    }

    if (defInfo.declarationlines.length != 0) {
        defInfos.push(defInfo)
    }
    return defInfos
}

function isSkipLine(line: string) {
    if (line == "") return true
    if (line.startsWith(COMMENT)) return true
    return !line.startsWith('[')
    // return !(line.match(/^[!#?]/g) == null)
}

function getWordFromPosition(
    document: vscode.TextDocument,
    position: vscode.Position
): WordType | undefined {
    const wordRange = document.getWordRangeAtPosition(position, /[-_\w]+/g)
    const lineText = document.lineAt(position.line).text.trim()
    let word = wordRange ? document.getText(wordRange) : ''

    if (
        !wordRange ||
        lineText.startsWith(COMMENT) ||
        // isPositionInString(document, position) ||
        word.match(/^\d+.?\d+$/)
    ) {
        return undefined
    }

    var wType: WordType = {type: undefined, value: word, find_all: false}

    // check is variable
    if (lineText.match(new RegExp(`\\$\\{?\\b${word}\\b\\}?`))) {
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
                if (defInfos == null || defInfos.length === 0) {
                    return Promise.reject("invalid");
                }
                let locations = new Array<vscode.Location>()
                defInfos.forEach(defInfo => {
                    const definitionResource = vscode.Uri.file(defInfo.file);
                    defInfo.declarationlines.forEach((value) => {
                        const declarationline = value
                        locations.push(new vscode.Location(definitionResource, new vscode.Position(declarationline.line, declarationline.column)))
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