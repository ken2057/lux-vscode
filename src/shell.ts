import * as vscode from 'vscode';
import { BlockInfo, ClearDecoration } from './decoration';
import { checkInvokeShellChange } from './cache';

const annotation = vscode.window.createTextEditorDecorationType({
    after: {
        margin: '0 0 0 3em',
        textDecoration: 'none',
        // color: '#ff79c6',
        color: new vscode.ThemeColor('editorCodeLens.foreground'),
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
});

export function DecorateShellBlockInfo(
    ctx: vscode.ExtensionContext,
    editor: vscode.TextEditor,
    cursorOffset: number
) {
    editor.setDecorations(annotation, []);

    const text = checkInvokeShellChange(ctx, editor.document, cursorOffset);
    if (!text) {
        return
    }

    const position = editor.document.positionAt(cursorOffset);
    const line = editor.document.lineAt(position.line).text;
    const range = new vscode.Range(position.line, line.length, position.line, line.length);

    const decoration: vscode.DecorationOptions = {
        range: range,
        renderOptions: {
            after: {
                contentText: text,
            }
        }
    }

    editor.setDecorations(annotation, [decoration]);
}