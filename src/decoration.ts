import * as vscode from 'vscode';
import { LUX_MODE } from './const';
import { decorateMacroBlock } from './macro';

export interface BlockInfo {
    startText: string;
    endText: string;
}

export function findCurrentBlock(editor: vscode.TextEditor, blockInfo: BlockInfo, text: string, cursorOffset: number): vscode.Range | null {
    // 1. Find the nearest [start] before the cursor
    const beforeText = text.substring(0, cursorOffset);
    const startIdx = beforeText.lastIndexOf(blockInfo.startText);
    const lastEnd = beforeText.lastIndexOf(blockInfo.endText);

    const lastEndLine = editor.document.positionAt(lastEnd).line
    const cursorLine = editor.document.positionAt(cursorOffset).line
    const isSameLine = lastEndLine == cursorLine
    // If a [stop] is closer to the cursor than a [start],
    // it means the cursor is outside of a block.
    if (lastEnd > startIdx && !isSameLine) {
        return null;
    }

    // 2. Find the nearest [end] after the cursor
    let relativeEndIdx = 0;
    if (!isSameLine) {
        const afterText = text.substring(cursorOffset);
        relativeEndIdx = afterText.indexOf(blockInfo.endText);
    }

    // 3. Verify both exist
    if (startIdx !== -1 && relativeEndIdx !== -1) {
        const endIdx = isSameLine ? cursorOffset : cursorOffset + relativeEndIdx + blockInfo.endText.length;

        // Convert offsets to VS Code Positions/Ranges
        return new vscode.Range(
            editor.document.positionAt(startIdx),
            editor.document.positionAt(endIdx)
        );
    }

    return null;
}

export function LuxDecorationProvider(event: vscode.TextEditorSelectionChangeEvent) {
    const editor = event.textEditor;
    if (!editor || editor.document.languageId !== LUX_MODE.language) return;

    const cursorOffset = editor.document.offsetAt(event.selections[0].active);
    const text = editor.document.getText();

    decorateMacroBlock(editor, text, cursorOffset);
}