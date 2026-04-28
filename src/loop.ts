import * as vscode from 'vscode';
import { BlockInfo } from './decoration';

const verticalLineDecoration = vscode.window.createTextEditorDecorationType({
    border: '1.5px solid rgba(255, 255, 255, 0.7)', // Color of the line
    borderWidth: '0 0 0 1.5px',                     // Top Right Bottom Left (only Left has width)
    borderColor: 'rgba(255, 255, 255, 0.7)',      // Specific line color
    isWholeLine: false,                            // Keep it to the start of the text
});

const firstLineUnderline = vscode.window.createTextEditorDecorationType({
    border: '1.5px solid rgba(255, 255, 255, 0.7)',
    borderWidth: '0 0 1.5px 0', // Bottom border only
    isWholeLine: false,       // Spans the full width of the editor
});

export const LoopBlockInfo: BlockInfo = {
    startText: '[loop ',
    endText: '[endloop]',
    firstLineDecoration: firstLineUnderline,
    verticalLineDecoration: verticalLineDecoration
}