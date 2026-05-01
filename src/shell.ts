import * as vscode from 'vscode';
import { BlockInfo, ClearDecoration } from './decoration';

const verticalLineDecoration = vscode.window.createTextEditorDecorationType({
    border: '1.5px solid rgba(139, 233, 253, 0.7)', // Color of the line
    borderWidth: '0 0 0 1.5px',                     // Top Right Bottom Left (only Left has width)
    borderColor: 'rgba(139, 233, 253, 0.7)',      // Specific line color
    isWholeLine: false,                            // Keep it to the start of the text
});

const underline = vscode.window.createTextEditorDecorationType({
    border: '1.5px solid rgba(139, 233, 253, 0.7)',
    borderWidth: '0 0 1.5px 0', // Bottom border only
    isWholeLine: false,       // Spans the full width of the editor
});

const ShellBlockInfo: BlockInfo = {
    name: 'shell',
    startText: '[shell ',
    endText: ['[cleanup]', '[shell ', '[endshell ', '[endloop]'],
    firstLineDecoration: underline,
    verticalLineDecoration: verticalLineDecoration,
    lastLineDecoration: underline
}

function findCurrentBlock(editor: vscode.TextEditor, blockInfo: BlockInfo, text: string, cursorOffset: number): vscode.Range | null {
    // 1. Find the nearest [start] before the cursor
    const beforeText = text.substring(0, cursorOffset);
    const startIdx = beforeText.lastIndexOf(blockInfo.startText);

    // 2. Find the nearest [end] after the cursor
    const endTexts = blockInfo.endText instanceof Array ? blockInfo.endText : [blockInfo.endText];
    const afterText = text.substring(cursorOffset);
    let relativeEndIdx = text.length;

    for (const endText of endTexts) {
        const curRelativeEndIdx = afterText.indexOf(endText);
        if (curRelativeEndIdx !== -1 && curRelativeEndIdx < relativeEndIdx) {
            relativeEndIdx = curRelativeEndIdx;
        }
    }

    // 3. Verify both exist
    if (startIdx !== -1 && relativeEndIdx !== -1) {
        const endIdx = cursorOffset + relativeEndIdx + blockInfo.endText.length;

        // Convert offsets to VS Code Positions/Ranges
        return new vscode.Range(
            editor.document.positionAt(startIdx),
            editor.document.positionAt(endIdx)
        );
    }

    return null;
}

export function DecorateShellBlockInfo(editor: vscode.TextEditor, text: string, cursorOffset: number) {
    ClearDecoration(editor, ShellBlockInfo);

    const range = findCurrentBlock(editor, ShellBlockInfo, text, cursorOffset);

    if (range) {
        const firstLine = editor.document.lineAt(range.start.line);
        const rangeEndFix = range.end.line - 2;
        const lastLine = editor.document.lineAt(rangeEndFix);

        const firstLineTrim = firstLine.text.trim();
        const trimOffset = firstLine.text.length - firstLineTrim.length;

        if (ShellBlockInfo.verticalLineDecoration) {
            let listRange = []
            if (trimOffset == 0) {
                const verticalRange = new vscode.Range(
                    new vscode.Position(range.start.line + 1, trimOffset),
                    new vscode.Position(rangeEndFix, trimOffset)
                );
                listRange.push(verticalRange)
            } else {
                for (let i = range.start.line + 1; i < range.end.line - 1; i++) {
                    const empty = editor.document.lineAt(i).text.length == 0;

                    if (!empty) {
                        const verticalRange = new vscode.Range(
                            new vscode.Position(i, trimOffset),
                            new vscode.Position(i, trimOffset)
                        );
                        listRange.push(verticalRange)
                    }
                }
            }
            editor.setDecorations(ShellBlockInfo.verticalLineDecoration, listRange);
        }

        if (ShellBlockInfo.lastLineDecoration) {
            const underlineRange = new vscode.Range(
                new vscode.Position(rangeEndFix, trimOffset),
                new vscode.Position(rangeEndFix, lastLine.text.length)
            );
            editor.setDecorations(ShellBlockInfo.lastLineDecoration, [underlineRange]);
        }
    }
}