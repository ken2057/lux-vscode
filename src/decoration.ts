import * as vscode from 'vscode';
import { LUX_MODE } from './const';
import { MacroBlockInfo } from './macro';
import { LoopBlockInfo } from './loop';
import { DecorateShellBlockInfo } from './shell';
import { isShowBlockHighlight } from './util';

export interface BlockInfo {
    name: string;
    startText: string;
    endText: string | string[];
    firstLineDecoration?: vscode.TextEditorDecorationType;
    verticalLineDecoration?: vscode.TextEditorDecorationType;
    lastLineDecoration?: vscode.TextEditorDecorationType;
}

export function findCurrentBlock(editor: vscode.TextEditor, blockInfo: BlockInfo, text: string, cursorOffset: number): vscode.Range | null {
    const endText = blockInfo.endText instanceof Array ? blockInfo.endText[0] : blockInfo.endText;
    // 1. Find the nearest [start] before the cursor
    const beforeText = text.substring(0, cursorOffset);
    const startIdx = beforeText.lastIndexOf(blockInfo.startText);
    const lastEnd = beforeText.lastIndexOf(endText);

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
        relativeEndIdx = afterText.indexOf(endText);
    }

    // 3. Verify both exist
    if (startIdx !== -1 && relativeEndIdx !== -1) {
        const endIdx = isSameLine ? cursorOffset : cursorOffset + relativeEndIdx + endText.length;

        // Convert offsets to VS Code Positions/Ranges
        return new vscode.Range(
            editor.document.positionAt(startIdx),
            editor.document.positionAt(endIdx)
        );
    }

    return null;
}

export function ClearDecoration(editor: vscode.TextEditor, blockInfo: BlockInfo) {
    if (blockInfo.verticalLineDecoration) {
        editor.setDecorations(blockInfo.verticalLineDecoration, []);
    }
    if (blockInfo.firstLineDecoration) {
        editor.setDecorations(blockInfo.firstLineDecoration, []);
    }
    if (blockInfo.lastLineDecoration) {
        editor.setDecorations(blockInfo.lastLineDecoration, []);
    }
}

function decorateBlockInfo(
    editor: vscode.TextEditor,
    text: string,
    cursorOffset: number,
    blockInfo: BlockInfo,
) {
    ClearDecoration(editor, blockInfo);
    if (!isShowBlockHighlight()) return;

    // Logic to find the innermost block containing the cursor
    const range = findCurrentBlock(editor, blockInfo, text, cursorOffset);

    if (range) {
        const firstLine = editor.document.lineAt(range.start.line);
        const firstLineTrim = firstLine.text.trim();
        const trimOffset = firstLine.text.length - firstLineTrim.length;
        const rangeEndFix = range.end.line - 1;

        if (blockInfo.firstLineDecoration) {
            const underlineRange = new vscode.Range(
                new vscode.Position(range.start.line, trimOffset),
                new vscode.Position(range.start.line, firstLine.text.length)
            );
            editor.setDecorations(blockInfo.firstLineDecoration, [underlineRange]);
        }

        if (blockInfo.verticalLineDecoration) {
            let listRange = []
            if (trimOffset == 0) {
                const verticalRange = new vscode.Range(
                    new vscode.Position(range.start.line + 1, trimOffset),
                    new vscode.Position(rangeEndFix, trimOffset)
                );
                listRange.push(verticalRange)
            } else {
                for (let i = range.start.line + 1; i < range.end.line; i++) {
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
            editor.setDecorations(blockInfo.verticalLineDecoration, listRange);
        }
    }
}

export function LuxDecorationListener(
    ctx: vscode.ExtensionContext,
    event: vscode.TextEditorSelectionChangeEvent
) {
    const editor = event.textEditor;
    if (!editor || editor.document.languageId !== LUX_MODE.language) return;

    const cursorOffset = editor.document.offsetAt(event.selections[0].active);
    const text = editor.document.getText();

    [MacroBlockInfo,
     LoopBlockInfo,
    ].forEach(BlockInfo => {
        decorateBlockInfo(editor, text, cursorOffset, BlockInfo);
    });
    // DecorateShellBlockInfo(ctx, editor, editor.document.offsetAt(event.selections[0].active));
}