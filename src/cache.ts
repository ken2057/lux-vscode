import * as vscode from 'vscode';
import { COMMENT, LUX_MODE } from './const';
import { convertIncludePath } from './util';

interface FileInfo {
    file: string;
    version: number;
}

interface ShellRef {
    name: string;
    line: number;
    col: number;
    macroShellCtx?: ShellRef[];
    fileInfo: FileInfo;
    from: string;
}

interface CacheData {
    shellCtx: ShellRef[];
    macro: { [key: string]: ShellRef[] };
    full: ShellRef[];
    fileInfo: FileInfo;
}

function getCacheKey(fileInfo: FileInfo): string {
    return `${fileInfo.file}@${fileInfo.version}@`;
}

export function checkInvokeShellChange(
    ctx: vscode.ExtensionContext,
    document: vscode.TextDocument,
    cursorOffset: number
): string | null {
    if (!document || document.languageId !== LUX_MODE.language) {
        return null;
    }

    const cache = ctx.workspaceState.get<CacheData>("cacheShellCtx")
    if (!cache) {
        return null;
    }

    if (cache.fileInfo.file !== document.uri.fsPath || cache.fileInfo.version !== document.version) {
        return null;
    }


    const lineIdx = document.positionAt(cursorOffset).line;
    const line = document.lineAt(lineIdx).text.trim();
    if (line.startsWith(COMMENT)) {
        return null;
    }

    if (!line.match(/^\[invoke\s+(\w[-_\w]+\w)[ \]]/)) {
        return null;
    }

    let startShell = null
    let endShell = null
    for (let i = 0; i < cache.full.length; i++) {
        if (cache.full[i].line <= lineIdx) {
            startShell = cache.full[i]
            continue
        }

        if (startShell) {
            endShell = cache.full[i]
            break
        }
    }

    if (startShell === null || endShell === null) {
        return null;
    }

    if (startShell.name == endShell.name) {
        return null;
    }
    return `Shell changed from ${startShell.name} to ${endShell.name}`;
}

async function getCacheData(document: vscode.TextDocument, cache: CacheData): Promise<CacheData> {
    let inMacroCount = 0
    let macroNames: string[] = []

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text.trim();

        if (line.startsWith(COMMENT)) {
            continue
        }

        const macroMatch = line.match(/\[macro\s+([-_\w]+)/);
        if (macroMatch) {
            const macroName = macroMatch[1];
            macroNames.push(macroName);
            cache.macro[macroName] = [];
            inMacroCount++
            continue
        }

        const endmacroMatch = line.match(/\[endmacro\]/);
        if (inMacroCount > 0 && endmacroMatch) {
            const macroName = macroNames.pop()?.toString() ?? "";
            if (cache.macro[macroName].length == 0) {
                delete cache.macro[macroName]
            }
            inMacroCount--
            continue
        }

        const shellMatch = line.match(/\[shell\s+(.+)\]/);
        if (shellMatch) {
            let shellName = shellMatch[1]
            const ref: ShellRef = {
                name: shellName,
                line: i,
                col: line.indexOf(shellName),
                fileInfo: cache.fileInfo,
                from: `${i}`
            }

            if (inMacroCount > 0) {
                const macroKeys = Object.keys(cache.macro);
                const lastMacroKey = macroKeys[macroKeys.length - 1];
                cache.macro[lastMacroKey].push(ref);
            } else {
                cache.shellCtx.push(ref)
            }
            cache.full.push(ref)
            continue
        }

        const cleanupMatch = line.match(/\[cleanup\]/);
        if (cleanupMatch) {
            const ref: ShellRef = {
                name: "cleanup",
                line: i,
                col: line.indexOf(cleanupMatch[0]),
                fileInfo: cache.fileInfo,
                from: `${i}`
            }

            if (inMacroCount > 0) {
                const macroKeys = Object.keys(cache.macro);
                const lastMacroKey = macroKeys[macroKeys.length - 1];
                cache.macro[lastMacroKey].push(ref);
            } else {
                cache.shellCtx.push(ref)
            }
            cache.full.push(ref);

            continue
        }

        const includeMatch = line.match(/^\[include\s+(.+)\]/);
        if (includeMatch) {
            const includePath = await convertIncludePath(document, includeMatch[1])
            const includeCaches = await vscode.workspace.openTextDocument(includePath).then(includeDoc => {
                return getCacheData(includeDoc, {shellCtx: [], macro: {}, fileInfo: {file: includePath, version: includeDoc.version}, full: []});
            });
            includeCaches.shellCtx.forEach(includeCache => {
                includeCache.line = i
                includeCache.from = `${i}:${includeCache.from}`
            });
            cache.shellCtx.push(...includeCaches.shellCtx);

            includeCaches.full.forEach(includeCache => {
                includeCache.line = i
                includeCache.from = `${i}:${includeCache.from}`
            });
            cache.full.push(...includeCaches.full);
            Object.assign(cache.macro, includeCaches.macro);
            continue
        }

        const invokeMatch = line.match(/^\[invoke\s+(\w[-_\w]+\w)[ \]]/);
        if (invokeMatch) {
            const macroName = invokeMatch[1]
            const shellCtx = cache.macro[macroName] ?? []
            for (const macroRef of shellCtx) {
                const r = {
                    name: macroRef.name,
                    line: i,
                    col: macroRef.col,
                    fileInfo: macroRef.fileInfo,
                    from: `${i}:${macroRef.from}`
                }
                cache.shellCtx.push(r);
                cache.full.push(r);
            }
            continue
        }
    }
    return cache;
}

export async function LuxCacheListener(
    ctx: vscode.ExtensionContext,
    editor: vscode.TextEditor | undefined
) {
    if (!editor || editor.document.languageId !== LUX_MODE.language) {
        return
    }

    const document = editor.document;

    const fileInfo: FileInfo = {
        file: editor.document.uri.fsPath,
        version: document.version,
    }

    try {
        const cache = await getCacheData(document, {shellCtx: [], macro: {}, fileInfo, full: []});
        ctx.workspaceState.update("cacheShellCtx", cache);
    } catch (error) {
        console.log(error);
    }
}