import * as vscode from 'vscode';
import { LUX_MODE } from './const';
import { MacroBlockInfo } from './macro';
import { LoopBlockInfo } from './loop';
import { isCache, isShowBlockHighlight } from './configuration';
import { CacheLuxFile, CachedDecorationBlock } from './cache';

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
    blockInfo: BlockInfo,
    range: vscode.Range | null,
) {
    ClearDecoration(editor, blockInfo);

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

function findCachedBlock(
    document: vscode.TextDocument,
    blocks: CachedDecorationBlock[],
    type: CachedDecorationBlock["type"],
    cursor: vscode.Position
): vscode.Range | null {
    let nearest: CachedDecorationBlock | undefined;
    for (const block of blocks) {
        if (block.type !== type || block.startLine < 0 || block.endLine >= document.lineCount ||
            block.startLine > block.endLine || block.startCol < 0 ||
            block.startLine > cursor.line || block.endLine < cursor.line ||
            (block.startLine === cursor.line && block.startCol > cursor.character)) {
            continue;
        }
        if (!nearest || block.startLine > nearest.startLine ||
            (block.startLine === nearest.startLine && block.startCol > nearest.startCol) ||
            (block.startLine === nearest.startLine && block.startCol === nearest.startCol &&
                block.endLine < nearest.endLine)) {
            nearest = block;
        }
    }
    if (!nearest) {
        return null;
    }
    return new vscode.Range(
        new vscode.Position(nearest.startLine, nearest.startCol),
        document.lineAt(nearest.endLine).range.end
    );
}

export function LuxDecorationListener(
    ctx: vscode.ExtensionContext,
    event: vscode.TextEditorSelectionChangeEvent
) {
    const editor = event.textEditor;
    if (!editor || editor.document.languageId !== LUX_MODE.language) return;

    const document = editor.document;
    const cursor = event.selections[0].active;
    const cached = isCache() ? ctx.workspaceState.get<CacheLuxFile>(document.uri.fsPath) : undefined;
    const blocks = cached?.fileInfo.version === document.version && Array.isArray(cached.decorationBlocks)
        ? cached.decorationBlocks
        : undefined;
    const showHighlight = isShowBlockHighlight();
    let text: string | undefined;

    for (const {info, type} of [
        {info: MacroBlockInfo, type: "macro" as const},
        {info: LoopBlockInfo, type: "loop" as const}
    ]) {
        const range = !showHighlight
            ? null
            : blocks
                ? findCachedBlock(document, blocks, type, cursor)
                : findCurrentBlock(editor, info, text ??= document.getText(), document.offsetAt(cursor));
        decorateBlockInfo(editor, info, range);
    }
    // DecorateShellBlockInfo(ctx, editor, editor.document.offsetAt(event.selections[0].active));
}
