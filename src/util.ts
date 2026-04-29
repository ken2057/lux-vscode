import * as vscode from 'vscode';
import { EXTENSION_ID, WORKSPACE } from './const';


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