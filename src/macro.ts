import * as vscode from 'vscode';
import { BlockInfo, findCurrentBlock } from './decoration';

const verticalLineDecoration = vscode.window.createTextEditorDecorationType({
    border: '1px solid rgba(80, 250, 123, 0.7)', // Color of the line
    borderWidth: '0 0 0 1px',                     // Top Right Bottom Left (only Left has width)
    borderColor: 'rgba(80, 250, 123, 0.7)',      // Specific line color
    isWholeLine: false,                            // Keep it to the start of the text
});

const firstLineUnderline = vscode.window.createTextEditorDecorationType({
    border: '1px solid rgba(80, 250, 123, 0.7)',
    borderWidth: '0 0 1px 0', // Bottom border only
    isWholeLine: false,       // Spans the full width of the editor
});

const macroBlockInfo: BlockInfo = {
    startText: '[macro ',
    endText: '[endmacro]'
}

function clearDecoration(editor: vscode.TextEditor) {
    editor.setDecorations(verticalLineDecoration, []);
    editor.setDecorations(firstLineUnderline, []);
}

export function decorateMacroBlock(
    editor: vscode.TextEditor,
    text: string,
    cursorOffset: number
) {
    clearDecoration(editor);

    // Logic to find the innermost block containing the cursor
    const range = findCurrentBlock(editor, macroBlockInfo, text, cursorOffset);

    if (range) {
        const firstLine = editor.document.lineAt(range.start.line);
        const underlineRange = firstLine.range;

        const verticalRange = new vscode.Range(
            new vscode.Position(range.start.line + 1, 0), // Start of the line
            new vscode.Position(range.end.line - 1, 0)    // Start of the line
        );
        editor.setDecorations(verticalLineDecoration, [verticalRange]);
        editor.setDecorations(firstLineUnderline, [underlineRange]);
    } else {
        clearDecoration(editor);
    }
}