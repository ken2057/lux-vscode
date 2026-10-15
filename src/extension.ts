// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { LUX_MODE } from './const';
import { LuxDefinitionProvider } from './declaretion';
import { LuxDecorationListener } from './decoration';
import { LuxHoverProvider } from './hover';
import { LuxCacheListener, LuxCacheOnChangeListener } from './cache';
import { registerFailureLocationCommand } from './failureLocation';

// This method is called when your extension is activated
export async function activate(ctx: vscode.ExtensionContext) {
    const cachedFiles = ctx.workspaceState.keys()
        .filter(key => key.endsWith(".lux") || key.endsWith(".lux.tmpl") || key.endsWith(".luxinc"));
    await Promise.all([...cachedFiles, "updateCache", "luxCacheOnChangeIdle", "onRunningCache"]
        .map(key => ctx.workspaceState.update(key, undefined)));

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "lux-vscode" is now active!');
	ctx.subscriptions.push(vscode.languages.registerDefinitionProvider(LUX_MODE, new LuxDefinitionProvider(ctx)));
	ctx.subscriptions.push(vscode.languages.registerHoverProvider(LUX_MODE, new LuxHoverProvider(ctx)));
    registerFailureLocationCommand(ctx);

    ctx.subscriptions.push(vscode.window.onDidChangeTextEditorSelection((e) => LuxDecorationListener(ctx, e)));

    ctx.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => LuxCacheOnChangeListener(ctx, e)));
    ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (e) => await LuxCacheListener(ctx, e)));
    await LuxCacheListener(ctx, vscode.window.activeTextEditor);
}

// This method is called when your extension is deactivated
export function deactivate() {}
