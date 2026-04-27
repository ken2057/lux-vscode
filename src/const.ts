import * as vscode from 'vscode';

export const LUX_MODE: vscode.DocumentFilter = { language: 'lux', scheme: 'file' };

export const EXTENSION_ID: string = 'ken2057.lux-vscode';

export const COMMENT: string = '#'

export const PATH_SEPARATOR: string = '/'

export const WORKSPACE: string = '$WORKSPACE$'

export const BUILD_IN_LUX_VARIABLES: string[] = [
    'LUX_SHELLNAME',
    'LUX_START_REASON',
    'LUX_TIMEOUT',
    'LUX_FAIL_PATTERN',
    'LUX_SUCCESS_PATTERN',
    'PS1',
    '_CTRL_C_',
    'MAKE'
]