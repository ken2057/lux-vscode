import * as vscode from 'vscode';

export function getCustomVariable(varName: string): string | undefined {
    return vscode.workspace
            .getConfiguration("lux.envVariables")
            .get(varName)
}

export function isShowBlockHighlight(): boolean {
    return vscode.workspace
            .getConfiguration("lux").get("showBlockHighlight", true)
}

export function isCache(): boolean {
    return vscode.workspace
            .getConfiguration("lux.cache").get("enabled", true)
}

export function isShowFullMacroBlockInFailureTrace(): boolean {
    return vscode.workspace
            .getConfiguration("lux.failureTrace").get("showFullMacroBlock", true)
}
