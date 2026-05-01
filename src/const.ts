import * as vscode from 'vscode';

export const LUX_MODE: vscode.DocumentFilter = { language: 'lux', scheme: 'file' };

export const EXTENSION_ID: string = 'ken2057.lux-vscode';

export const COMMENT: string = '#'

export const PATH_SEPARATOR: string = '/'

export const WORKSPACE: string = '$WORKSPACE$'

export const BUILD_IN_LUX_VARIABLES: { [key: string]: string } = {
    'LUX_SHELLNAME': 'Name of active Lux shell',
    'LUX_START_REASON': 'Reason for starting a shell (normal|fail|success)',
    'LUX_TIMEOUT': 'Value of match timeout in the active Lux shell',
    'LUX_FAIL_PATTERN': 'Value of fail pattern in the active Lux shell',
    'LUX_SUCCESS_PATTERN': 'Value of success pattern in the active Lux shell',
    'PS1': 'Shell prompt variable set by Lux',
    '_CTRL_C_': 'control+C',
    '_BS_': 'backspace',
    '_TAB_': 'horizontal tab',
    '_LF_': 'line feed',
    '_CR_': 'carriage return',
    '_ESC_': 'escape',
    '_DEL_': 'delete',
    'MAKE': 'Make command'
}
