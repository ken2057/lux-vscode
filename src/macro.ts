import * as vscode from 'vscode';
import { BlockInfo, findCurrentBlock } from './decoration';

const verticalLineDecoration = vscode.window.createTextEditorDecorationType({
    border: '1.5px solid rgba(80, 250, 123, 0.7)', // Color of the line
    borderWidth: '0 0 0 1.5px',                     // Top Right Bottom Left (only Left has width)
    borderColor: 'rgba(80, 250, 123, 0.7)',      // Specific line color
    isWholeLine: false,                            // Keep it to the start of the text
});

const underline = vscode.window.createTextEditorDecorationType({
    border: '1.5px solid rgba(80, 250, 123, 0.7)',
    borderWidth: '0 0 1.5px 0', // Bottom border only
    isWholeLine: false,       // Spans the full width of the editor
});

export const MacroBlockInfo: BlockInfo = {
    name: 'macro',
    startText: '[macro ',
    endText: '[endmacro]',
    firstLineDecoration: underline,
    verticalLineDecoration: verticalLineDecoration
}