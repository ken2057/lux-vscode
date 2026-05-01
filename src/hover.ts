import * as vscode from 'vscode';

import { getCustomVariable, getWordFromPosition, patchPath, WordType } from './util';
import { BUILD_IN_LUX_VARIABLES } from './const';
import { LuxDefinitionProvider } from './declaretion';

export class LuxHoverProvider implements vscode.HoverProvider {
    private ctx: vscode.ExtensionContext;

    constructor(ctx: vscode.ExtensionContext) {
        this.ctx = ctx;
    }

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        const wType = getWordFromPosition(document, position, true);

        if (!wType || token.isCancellationRequested) {
            return null;
        }

        if (wType.type === 'variable') {
            if (Object.keys(BUILD_IN_LUX_VARIABLES).includes(wType.value)) {
                return new vscode.Hover(BUILD_IN_LUX_VARIABLES[wType.value]);
            }
            if (token.isCancellationRequested) {
                return null
            }

            const customVariable = getCustomVariable(wType.value);
            if (customVariable) {
                const patched = patchPath(`\$${wType.value}`)
                return new vscode.Hover(patched);
            }
            if (token.isCancellationRequested) {
                return null
            }
        }

        return null;
    }
}