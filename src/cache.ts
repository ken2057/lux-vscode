import * as vscode from 'vscode';
import { LUX_MODE } from './const';
import { convertIncludePath, skipLine } from './util';
import * as interfaces from './types/lux.interface';
import { isCache } from './configuration';

export interface FileInfo {
    file: string;
    version: number;
}

export interface CacheLuxFile {
    lux: interfaces.Lux;
    fileInfo: FileInfo;
    variableDeclarations: CachedLocation[];
    macroDeclarations: CachedLocation[];
    variableUses: CachedLocation[];
    invokes: CachedLocation[];
    decorationBlocks?: CachedDecorationBlock[];
    includes: string[];
    cached?: boolean;
}

export interface CachedDecorationBlock {
    type: "macro" | "loop";
    startLine: number;
    startCol: number;
    endLine: number;
}

export interface CachedLocation {
    name: string;
    file: string;
    line: number;
    col: number;
}

interface ConvertHelper {
    block?: interfaces.Block;
    skipLine: number;
}

interface IterateContext {
    ctx: Map<string, any>;
}

interface CacheWalk {
    active: Set<string>;
    files: Map<string, CacheLuxFile>;
    documents: Map<string, vscode.TextDocument>;
    changed: Set<string>;
    failed: Set<string>;
}

let cacheOutput: vscode.OutputChannel | undefined;

function luxOutput(ctx: vscode.ExtensionContext): vscode.OutputChannel {
    if (!cacheOutput) {
        cacheOutput = vscode.window.createOutputChannel("Lux Language Support");
        ctx.subscriptions.push(cacheOutput);
    }
    return cacheOutput;
}

export function logLuxInfo(ctx: vscode.ExtensionContext, message: string): void {
    luxOutput(ctx).appendLine(`[INFO] ${message}`);
}

export function logLuxError(ctx: vscode.ExtensionContext, message: string): void {
    luxOutput(ctx).appendLine(`[ERROR] ${message}`);
}

function cacheInfo(ctx: vscode.ExtensionContext, message: string): void {
    logLuxInfo(ctx, message);
}

export function getCachedFiles(
    ctx: vscode.ExtensionContext,
    document: vscode.TextDocument,
    checkedFiles: Set<string> = new Set<string>()
): CacheLuxFile[] {
    const files: CacheLuxFile[] = [];

    function collect(file: string) {
        if (checkedFiles.has(file)) {
            return;
        }
        checkedFiles.add(file);

        const cached = ctx.workspaceState.get<CacheLuxFile>(file);
        if (!cached || (file === document.uri.fsPath && cached.fileInfo.version !== document.version)) {
            return;
        }

        files.push(cached);
        for (const includedFile of cached.includes || []) {
            collect(includedFile);
        }
    }

    collect(document.uri.fsPath);
    return files;
}

export function getOtherCachedFiles(
    ctx: vscode.ExtensionContext,
    scopedFiles: CacheLuxFile[]
): CacheLuxFile[] {
    const seen = new Set(scopedFiles.map(file => file.fileInfo.file));
    const files: CacheLuxFile[] = [];

    for (const path of ctx.workspaceState.get<string[]>("updateCache") || []) {
        if (seen.has(path)) {
            continue;
        }
        const cached = ctx.workspaceState.get<CacheLuxFile>(path);
        if (cached) {
            seen.add(path);
            files.push(cached);
        }
    }
    return files;
}

function fileIterate(
    startIdx: number,
    document: vscode.TextDocument,
    fn: (line: vscode.TextLine, iterCtx: IterateContext) => ConvertHelper | null,
    curBlock?: interfaces.Block
): ConvertHelper | null {
    if (startIdx >= document.lineCount) {
        return null;
    }

    let iterCtx: IterateContext = { ctx: new Map() };
    if (curBlock) {
        iterCtx.ctx.set("block", curBlock);
    }

    let started = false;
    for (let i = startIdx; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        if (!started && skipLine(line.text)) {
            continue;
        }

        const convertResult = fn(line, iterCtx);
        started = true;
        if (convertResult) {
            if (convertResult.skipLine === 0) {
                return null;
            }
            return {...convertResult, skipLine: i - startIdx + 1};
        }
    }
    return null;
}

function tryConvertToVar(
    line: vscode.TextLine,
    iterCtx: IterateContext,
): ConvertHelper | null {
    const varType = "global|local|my";
    const text = line.text.trim();

    if (iterCtx.ctx.get("isVarBreakLine")) {
        const varLines = iterCtx.ctx.get("varLines") || [];
        let skipLine = iterCtx.ctx.get("skipLine") || 0;

        if (text.startsWith("[")) {
            return {skipLine: 0};
        }

        const lineBreakLine = text.match(/(.*) \\/);
        if (lineBreakLine) {
            varLines.push(lineBreakLine[1]);
            iterCtx.ctx.set("varLines", varLines);
            iterCtx.ctx.set("skipLine", skipLine + 1);
            return null;
        }

        const lineEndLine = text.match(/(.*)\s*\]$/);
        if (!lineEndLine) {
            return {skipLine: 0};
        }
        skipLine++
        varLines.push(lineEndLine[1]);

        const variable = iterCtx.ctx.get("var") as interfaces.VarBlock;
        variable.value = varLines.join(" \\\n")

        iterCtx.ctx.delete("isVarBreakLine");
        iterCtx.ctx.delete("varLines");
        iterCtx.ctx.delete("var");
        iterCtx.ctx.delete("skipLine");

        return {
            block: variable,
            skipLine: skipLine
        } as ConvertHelper;
    }

    if (iterCtx.ctx.get("isVarStringBlock")) {
        const varLines = iterCtx.ctx.get("varLines") || [];
        let skipLine = iterCtx.ctx.get("skipLine") || 0;

        skipLine++
        if (text.match(/"""/)) {
            if (!iterCtx.ctx.get("isVarStringBlockStarted")) {
                iterCtx.ctx.set("isVarStringBlockStarted", true);
                iterCtx.ctx.set("skipLine", skipLine);
                iterCtx.ctx.set("indent", line.firstNonWhitespaceCharacterIndex);
                return null;
            } else {
                const variable = iterCtx.ctx.get("var") as interfaces.VarBlock;
                variable.value = varLines.join("\n")

                iterCtx.ctx.delete("isVarStringBlock");
                iterCtx.ctx.delete("isVarStringBlockStarted");
                iterCtx.ctx.delete("varLines");
                iterCtx.ctx.delete("var");
                iterCtx.ctx.delete("skipLine");
                iterCtx.ctx.delete("indent");

                return {
                    block: variable,
                    skipLine: skipLine
                } as ConvertHelper;
            }
        }

        if (!iterCtx.ctx.get("isVarStringBlockStarted")) {
            return {skipLine: 0};
        }

        varLines.push(line.text.substring(iterCtx.ctx.get("indent") || 0));

        return null
    }

    // Variable in once line
    const varMatch = text.match(new RegExp(`\\[(${varType})\\s+([^\\s]+)\\s*=(.+)?\\]`));
    if (varMatch) {
        const varType = varMatch[1];
        const varName = varMatch[2];
        const varValue = varMatch[3];

        const block: interfaces.VarBlock = {
            type: varType,
            line: line.lineNumber,
            col: line.firstNonWhitespaceCharacterIndex,
            name: varName,
            value: varValue,
            file: ""

        }

        if (varType === "global") {
            return {
                block: {...block as interfaces.GlobalVarBlock},
                skipLine: 1
            } as ConvertHelper;
        } else if (varType === "local") {
            return {
                block: {...block as interfaces.LocalVarBlock},
                skipLine: 1
            } as ConvertHelper;
        } else if (varType === "my") {
            return {
                block: {...block as interfaces.MyVarBlock},
                skipLine: 1
            } as ConvertHelper;
        }
        return null
    }

    // Block with multiple lines
    const varWithBreakLineMatch = text.match(new RegExp(`\\[(${varType})\\s+([^\\s]+)\\s*=(.+) \\\\`));
    if (varWithBreakLineMatch) {
        const variable: interfaces.VarBlock = {
            type: varWithBreakLineMatch[1],
            line: line.lineNumber,
            col: line.firstNonWhitespaceCharacterIndex,
            name: varWithBreakLineMatch[2],
            value: "",
            file: ""
        }
        iterCtx.ctx.set("isVarBreakLine", true);
        iterCtx.ctx.set("varLines", [varWithBreakLineMatch[3]]);
        iterCtx.ctx.set("var", variable);
        iterCtx.ctx.set("skipLine", 1);
        return null
    }

    // Block with """
    const varWithStringBlockMatch = text.match(new RegExp(`\\[(${varType})\\s+([^\\s]+)\\s*=$`));
    if (varWithStringBlockMatch) {
        const variable: interfaces.VarBlock = {
            type: varWithStringBlockMatch[1],
            line: line.lineNumber,
            col: line.firstNonWhitespaceCharacterIndex,
            name: varWithStringBlockMatch[2],
            value: "",
            file: ""
        }
        iterCtx.ctx.set("isVarStringBlock", true);
        iterCtx.ctx.set("isVarStringBlockStarted", false);
        iterCtx.ctx.set("varLines", []);
        iterCtx.ctx.set("var", variable);
        iterCtx.ctx.set("skipLine", 1);
        return null
    }

    return {
        skipLine: 0
    } as ConvertHelper;
}

function tryFindLoopBreakPattern(
    line: vscode.TextLine,
    iterCtx: IterateContext
): ConvertHelper | null {
    const text = line.text.trim();

    if (iterCtx.ctx.get("isLoopBreakPatternStringBlock")) {
        let skipLine = iterCtx.ctx.get("skipLine") || 0;
        const breakPattern = iterCtx.ctx.get("loopBreakPatternLines") || [];

        skipLine++
        if (text.match(/^"""/)) {
            iterCtx.ctx.delete("isLoopBreakPatternStringBlock");
            iterCtx.ctx.delete("loopBreakPatternLines");
            iterCtx.ctx.delete("skipLine");

            const loop: interfaces.LoopBlock = iterCtx.ctx.get("block") as interfaces.LoopBlock;
            loop.match_pattern = breakPattern.join("\n");

            return {
                block: loop,
                skipLine: skipLine
            } as ConvertHelper;

        } else {
            breakPattern.push(line.text.substring(iterCtx.ctx.get("intent") || 0));
            iterCtx.ctx.set("skipLine", skipLine);
            return null;
        }
    }

    const loopMatchLong = text.match(/^"""@(.*)/);
    if (loopMatchLong) {
        iterCtx.ctx.set("isLoopBreakPatternStringBlock", true);
        iterCtx.ctx.set("loopBreakPatternLines", []);
        iterCtx.ctx.set("skipLine", 1);
        iterCtx.ctx.set("intent", line.firstNonWhitespaceCharacterIndex);
        return null;
    }

    const loopMatch1 = text.match(/^@(.*)/);
    if (loopMatch1) {
        const loop = iterCtx.ctx.get("block") as interfaces.LoopBlock;
        loop.match_pattern = loopMatch1[1];
        return {
            block: loop,
            skipLine: 1
        } as ConvertHelper;
    }

    if (text.match(/\[endloop\]/)) {
        return {
            block: iterCtx.ctx.get("block") as interfaces.LoopBlock,
            skipLine: 0
        } as ConvertHelper;
    }
    return {skipLine: 0};
}

function recordVariableDeclaration(
    cache: CacheLuxFile,
    line: vscode.TextLine,
    name: string,
    searchFrom: number
): number {
    const col = line.text.indexOf(name, searchFrom);
    if (col >= 0) {
        cache.variableDeclarations.push({name, file: cache.fileInfo.file, line: line.lineNumber, col});
    }
    return col;
}

function recordReferences(cache: CacheLuxFile, document: vscode.TextDocument) {
    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i).text;
        if (skipLine(line)) {
            continue;
        }

        for (const match of line.matchAll(/\$(?:\{(\w+)\}|(\w+))/g)) {
            cache.variableUses.push({
                name: match[1] || match[2],
                file: cache.fileInfo.file,
                line: i,
                col: match.index + (match[1] ? 2 : 1)
            });
        }

        for (const match of line.matchAll(/\[invoke\s+([^\s\]]+)/g)) {
            cache.invokes.push({
                name: match[1],
                file: cache.fileInfo.file,
                line: i,
                col: match.index + match[0].lastIndexOf(match[1])
            });
        }
    }
}

async function convertDocToCache(
    ctx: vscode.ExtensionContext,
    document: vscode.TextDocument,
    walk: CacheWalk,
    force = false
): Promise<void> {
    if (!document || document.languageId !== LUX_MODE.language) {
        return Promise.reject("Invalid document");
    }

    const path = document.uri.fsPath;
    if (walk.active.has(path) || (walk.files.has(path) && !force)) {
        return;
    }
    walk.active.add(path);
    walk.documents.set(path, document);

    try {
        const cached = ctx.workspaceState.get<CacheLuxFile>(path);
        if (!force && cached?.fileInfo.version === document.version && cached.includes) {
            const includePaths = cached.includes.filter(includePath => !walk.active.has(includePath));
            const includedDocuments = await Promise.all(includePaths.map(async includePath => {
                let includedDocument: vscode.TextDocument;
                try {
                    includedDocument = await vscode.workspace.openTextDocument(includePath);
                } catch (error) {
                    walk.failed.add(includePath);
                    throw error;
                }
                return includedDocument;
            }));
            for (const includedDocument of includedDocuments) {
                await convertDocToCache(ctx, includedDocument, walk);
            }
            if (!cached.includes.some(includePath => walk.changed.has(includePath))) {
                walk.files.set(path, cached);
                return;
            }
        }

    if (!walk.changed.has(path)) {
        cacheInfo(ctx, `Caching ${path}`);
    }

    // Build the replacement before changing workspaceState.
    const decorationBlocks: CachedDecorationBlock[] = [];
    let cache: CacheLuxFile = {
        lux: {
            macros: new Map<string, interfaces.MacroBlock>(),
            includeCount: 0,
            run: [],
            global_vars: []
        },
        fileInfo: {
            file: document.uri.fsPath,
            version: document.version,
        },
        variableDeclarations: [],
        macroDeclarations: [],
        variableUses: [],
        invokes: [],
        decorationBlocks,
        includes: []
    }
    recordReferences(cache, document);

    let runShell: interfaces.ShellBlock | null = null;
    let macroShell: interfaces.ShellBlock | null = null;
    let loopShell: interfaces.ShellBlock | null = null;

    const prefetchedIncludes = new Map<string, Promise<vscode.TextDocument>>();
    await Promise.all([...document.getText().matchAll(/^\s*\[include\s+([^\s]+)\]/gm)].map(async match => {
        const includePath = await convertIncludePath(document, match[1]);
        if (!prefetchedIncludes.has(includePath)) {
            const opening = Promise.resolve(vscode.workspace.openTextDocument(includePath));
            void opening.catch(() => {});
            prefetchedIncludes.set(includePath, opening);
        }
    }));

    // help to keep track macro/loop context when parsing lux file
    let queue: interfaces.BlockHasChildren[] = [];
    let checkLoopBreakPattern = false;

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const text = line.text.trim();

        if (skipLine(text)) {
            continue;
        }

        if (checkLoopBreakPattern) {
            const loop = queue[queue.length - 1] as interfaces.LoopBlock | undefined;
            if (!loop || loop.type !== "loop") {
                return Promise.reject(`Unknown loop break pattern context ${document.fileName}:${i + 1}`);
            }
            const iterResult = fileIterate(i, document, tryFindLoopBreakPattern, loop);
            checkLoopBreakPattern = false;
            if (iterResult) {
                i += iterResult.skipLine - 1;
                continue;
            }
        }

        // Macro
        const macroMatch = text.match(/\[macro\s+([^\s]+)(\s+(.*?))?\s*\]/);
        if (macroMatch) {
            const args = macroMatch[3]?.trim();
            const macro: interfaces.MacroBlock = {
                type: "macro",
                line: i,
                col: line.firstNonWhitespaceCharacterIndex,
                children: Array<interfaces.Block>(),
                name: macroMatch[1],
                args: args ? args.split(/\s+/) : [],
                my_vars: [],
                file: cache.fileInfo.file
            }
            const macroCol = line.text.indexOf(macro.name, line.firstNonWhitespaceCharacterIndex + 6);
            cache.macroDeclarations.push({name: macro.name, file: cache.fileInfo.file, line: i, col: macroCol});
            let argStart = line.text.indexOf(macro.name, line.firstNonWhitespaceCharacterIndex + 6) + macro.name.length;
            for (const arg of macro.args) {
                const col = recordVariableDeclaration(cache, line, arg, argStart);
                if (col >= 0) {
                    argStart = col + arg.length;
                }
            }
            queue.push(macro);
            continue;
        }

        const endMacroMatch = text.match(/\[endmacro\]/);
        if (endMacroMatch) {
            const currentContext = queue.pop();
            if (!currentContext) {
                return Promise.reject(`Unexpected endmacro ${document.fileName}:${i + 1}`);
            }
            if (!(currentContext.type === "macro")) {
                return Promise.reject(`Unknown endmacro context ${document.fileName}:${i + 1}`);
            }

            const macro = currentContext as interfaces.MacroBlock;
            macro.end_line = i;
            decorationBlocks.push({
                type: "macro",
                startLine: macro.line,
                startCol: document.lineAt(macro.line).text.indexOf("[macro", macro.col),
                endLine: i
            });
            if (macroShell) {
                macroShell = null;
            }
            cache.lux.macros.set(macro.name, macro);

            continue;
        }


        const endLoopMatch = text.match(/\[endloop\]/);
        if (endLoopMatch) {
            const currentContext = queue.pop();
            if (!currentContext) {
                return Promise.reject(`Unexpected endloop ${document.fileName}:${i + 1}`);
            }
            if (!(currentContext.type === "loop")) {
                return Promise.reject(`Unknown endloop context ${document.fileName}:${i + 1}`);
            }

            const loop = currentContext as interfaces.LoopBlock;
            loop.end_line = i;
            decorationBlocks.push({
                type: "loop",
                startLine: loop.line,
                startCol: document.lineAt(loop.line).text.indexOf("[loop", loop.col),
                endLine: i
            });

            checkLoopBreakPattern = false
            if (loopShell) {
                loopShell = null;
            }

            if (queue.length > 0) {
                const parentContext = queue[queue.length - 1];
                parentContext.children.push(loop);
                continue
            }
            cache.lux.run.push(loop);
            continue;
        }

        // Loop
        const loopMatch = text.match(/\[loop(\s+([^\s]+)\s+(.*?))?\s*\]/);
        if (loopMatch) {
            const loop: interfaces.LoopBlock = {
                type: "loop",
                line: i,
                col: line.firstNonWhitespaceCharacterIndex,
                children: Array<interfaces.Block>(),
                items: [],
                my_vars: [],
                file: cache.fileInfo.file
            };
            if (loopMatch[1]) {
                loop.var = loopMatch[2];

                if (loopMatch[2]?.includes("..")) {
                    const match = loopMatch[2].match(/([^\.]+)\.\.([^\.]+)(\.\.[^\.]+)?/);
                    if (!match) {
                        return Promise.reject(`Invalid loop items ${document.fileName}:${i + 1}`);
                    }

                    try {
                        const start = parseInt(match[2]) || 0;
                        const end = parseInt(match[3]) || 0;
                        const step = match[4] ? parseInt(match[4].substring(2)) : 1;

                        loop.items = Array.from({ length: Math.floor((end - start) / step) + 1 }, (_, index) => (start + index * step).toString());
                    } catch (error) {
                        console.debug(`Failed to parse int loop item ${loopMatch[2]} or ${loopMatch[3]} or ${loopMatch[4]} at ${document.fileName}:${i + 1} with error ${error}`);
                        loop.items = [match[1], match[2], ...(match[3] ? [match[3].substring(2)] : [])];
                    }
                } else {
                    loop.var = loopMatch[2];
                    loop.items = loopMatch[3]?.split(" ") || [];
                }
                if (loop.var) {
                    recordVariableDeclaration(cache, line, loop.var, line.firstNonWhitespaceCharacterIndex + 5);
                }
            }

            queue.push(loop);
            checkLoopBreakPattern = true;
            continue;
        }

        // Shell
        const shellMatch = text.match(/\[shell\s+([^\s]+)\s*\]/);
        const cleanup = text.match(/\[(cleanup)\]/);
        if (shellMatch || cleanup) {
            const shellName = shellMatch ? shellMatch[1] : "cleanup";

            let shell: interfaces.ShellBlock = {
                line: i,
                col: line.firstNonWhitespaceCharacterIndex,
                name: shellName,
                local_vars: [],
                fail_patterns: [],
                type: "shell",
                file: cache.fileInfo.file
            }

            // Nothign in queue, so this will be running shell
            if (queue.length === 0 ) {
                // Re-use old run shell if exist to keep variable
                const oldShells = cache.lux.run.filter(block => {
                    if (block.type == "shell") {
                        const shell = block as interfaces.ShellBlock
                        return shell.name === shellName;
                    }
                    return false;
                })

                if (oldShells.length > 0) {
                    const oldShell = structuredClone(oldShells[0]) as interfaces.ShellBlock;
                    shell = oldShell
                    shell.line = i;
                    shell.col = line.firstNonWhitespaceCharacterIndex;
                }

                runShell = shell;
                cache.lux.run.push(runShell);
            } else {
                const currentContext = queue[queue.length - 1];

                // Re-use old run shell if exist to keep variable
                const oldShells = currentContext.children.filter(block => {
                    if (block.type == "shell") {
                        const shell = block as interfaces.ShellBlock
                        return shell.name === shellName;
                    }
                    return false;
                })
                if (oldShells.length > 0) {
                    const oldShell = structuredClone(oldShells[0]) as interfaces.ShellBlock;
                    shell = oldShell
                    shell.line = i;
                    shell.col = line.firstNonWhitespaceCharacterIndex;
                }

                if (currentContext.type === "macro") {
                    macroShell = shell;
                } else if (currentContext.type === "loop") {
                    loopShell = shell;
                }

                currentContext.children.push(shell);
            }

            continue;
        }

        // Include
        const includeMatch = text.match(/\[include\s+([^\s]+)\]/);
        if (includeMatch) {
            const includePath = await convertIncludePath(document, includeMatch[1]);

            try {
                const includeDoc = await (prefetchedIncludes.get(includePath) || vscode.workspace.openTextDocument(includePath));
                await convertDocToCache(ctx, includeDoc, walk);

                const include: interfaces.IncludeBlock = {
                    type: "include",
                    line: i,
                    col: line.firstNonWhitespaceCharacterIndex,
                    path: includePath,
                    cachePath: includeDoc.uri.fsPath,
                    file: cache.fileInfo.file
                }
                cache.lux.includeCount++;
                cache.lux.run.push(include);
                cache.includes.push(include.cachePath);

                continue;
            } catch (error) {
                walk.failed.add(includePath);
                return Promise.reject(`Failed to include file ${includePath} at ${document.fileName}:${i + 1} with error ${error}`);
            }
        }

        const varIterResult = /^\[(global|local|my)\s+/.test(text)
            ? fileIterate(i, document, tryConvertToVar)
            : null;
        if (varIterResult) {
            i += varIterResult.skipLine - 1;
            const variable = varIterResult.block as interfaces.VarBlock;
            variable.file = cache.fileInfo.file;
            recordVariableDeclaration(
                cache,
                document.lineAt(variable.line),
                variable.name,
                document.lineAt(variable.line).firstNonWhitespaceCharacterIndex + variable.type.length + 1
            );

            if (variable.type === "global") {
                cache.lux.global_vars.push({...variable as interfaces.GlobalVarBlock});
            } else if (variable.type === "local") {
                if (loopShell) {
                    loopShell.local_vars.push({...variable as interfaces.LocalVarBlock});
                } else if (macroShell) {
                    macroShell.local_vars.push({...variable as interfaces.LocalVarBlock});
                } else if (runShell) {
                    runShell.local_vars.push({...variable as interfaces.LocalVarBlock});
                } else {
                    if (queue.length > 0) {
                        const currentContext = queue[queue.length - 1];
                        currentContext.children.push(variable);
                    } else {
                        cache.lux.run.push(variable);
                    }
                }
            } else if (variable.type === "my") {
                if (queue.length === 0) {
                    if (runShell) {
                        runShell.local_vars.push({...variable as interfaces.LocalVarBlock});
                    } else {
                        cache.lux.run.push(variable);
                    }
                    continue
                }
                const currentContext = queue[queue.length - 1];
                if (currentContext.type === "macro") {
                    const macro = currentContext as interfaces.MacroBlock;
                    macro.my_vars.push({...variable as interfaces.MyVarBlock});
                } else if (currentContext.type === "loop") {
                    const loop = currentContext as interfaces.LoopBlock;
                    loop.my_vars.push({...variable as interfaces.MyVarBlock});
                }
            }
            continue
        }

        // Invoke
        const invokeMatch = text.match(/\[invoke\s+([^\s]+)(\s+(.*?))?\s*\]/);
        if (invokeMatch) {
            const invoke: interfaces.InvokeBlock = {
                type: "invoke",
                line: i,
                col: line.firstNonWhitespaceCharacterIndex,
                name: invokeMatch[1],
                args: invokeMatch[3] ? invokeMatch[3].split(" ") : [],
                file: cache.fileInfo.file
            }
            if (queue.length > 0) {
                const parentContext = queue[queue.length - 1];
                parentContext.children.push(invoke);
            } else {
                cache.lux.run.push(invoke);
            }
            continue;
        }

        // Fail pattern
        const failPatternMatch = text.match(/^-(.*)/);
        if (failPatternMatch) {
            const failPattern: interfaces.FailPattern = {
                type: "fail_pattern",
                line: i,
                col: line.firstNonWhitespaceCharacterIndex,
                pattern: failPatternMatch[1],
                file: cache.fileInfo.file
            }
            if (loopShell) {
                loopShell.fail_patterns.push(failPattern);
            } else if (macroShell) {
                macroShell.fail_patterns.push(failPattern);
            } else if (runShell) {
                runShell.fail_patterns.push(failPattern);
            } else {
                if (queue.length > 0) {
                    const currentContext = queue[queue.length - 1];
                    currentContext.children.push(failPattern);
                } else {
                    cache.lux.run.push(failPattern);
                }
            }
            continue;
        }
    }
    walk.files.set(path, cache);
    walk.changed.add(path);
    } finally {
        walk.active.delete(path);
    }
}

export async function LuxCacheListener(
    ctx: vscode.ExtensionContext,
    editor: vscode.TextEditor | undefined
) {
    const document = editor?.document;
    const file = document && document.languageId === LUX_MODE.language
        ? document.uri.fsPath
        : null;
    activeFilePath = file;
    const switchingRoot = !!file && isLuxRoot(file) && file !== activeRootPath;
    if (switchingRoot) {
        if (activeRootPath) {
            pendingRootPaths.add(activeRootPath);
        }
        activeRootPath = file;
    }
    const generation = ++activeEditorGeneration;

    try {
        if (!switchingRoot) {
            await scheduleCacheCleanup(ctx);
            if (!editor || generation !== activeEditorGeneration) {
                return;
            }
        }
        await updateCache(ctx, document);
    } catch (error) {
        console.error(error);
    } finally {
        if (switchingRoot && activeRootPath === file) {
            pendingRootPaths.clear();
            try {
                await scheduleCacheCleanup(ctx);
            } catch (error) {
                console.error(error);
            }
        }
    }
}

export async function LuxCacheOnChangeListener(
    ctx: vscode.ExtensionContext,
    event: vscode.TextDocumentChangeEvent
) {
    if (!isCache() || !event.document || event.document.languageId !== LUX_MODE.language) {
        return
    }
    luxCacheOnChangeIdle(ctx, event, false);
}

async function luxCacheOnChangeIdle(
    ctx: vscode.ExtensionContext,
    event: vscode.TextDocumentChangeEvent,
    timeout?: boolean
) {
    const key: FileInfo = {
        file: event.document.uri.fsPath,
        version: event.document.version,
    }

    if (!timeout) {
        ctx.workspaceState.update("luxCacheOnChangeIdle", key)
        return setTimeout(() => luxCacheOnChangeIdle(ctx, event, true), 500)
    }

    const cur = ctx.workspaceState.get<FileInfo>("luxCacheOnChangeIdle")
    if (cur && cur.file === key.file && cur.version === key.version) {
        ctx.workspaceState.update("luxCacheOnChangeIdle", undefined);
        void updateCache(ctx, event.document).catch(console.error);
    }
}

const activeLookups = new Map<string, number>();
let activeFilePath: string | null = null;
let activeRootPath: string | null = null;

export function getActiveLuxRootPath(): string | null {
    return activeRootPath;
}
const pendingRootPaths = new Set<string>();
let activeEditorGeneration = 0;
let cacheUpdates: Promise<void> = Promise.resolve();

function scheduleCacheCleanup(ctx: vscode.ExtensionContext): Promise<void> {
    const cleanup = cacheUpdates.then(() => trimCache(ctx));
    cacheUpdates = cleanup.catch(() => {});
    return cleanup;
}

function isLuxRoot(path: string): boolean {
    return path.endsWith(".lux") || path.endsWith(".lux.tmpl");
}

export function pinCacheFile(ctx: vscode.ExtensionContext, document: vscode.TextDocument): () => void {
    const path = document.uri.fsPath;
    activeLookups.set(path, (activeLookups.get(path) || 0) + 1);
    return () => {
        const count = activeLookups.get(path) || 0;
        if (count > 1) {
            activeLookups.set(path, count - 1);
        } else {
            activeLookups.delete(path);
        }
        void scheduleCacheCleanup(ctx);
    };
}

function protectedFiles(ctx: vscode.ExtensionContext, current: Map<string, CacheLuxFile>): Set<string> {
    const protectedPaths = new Set<string>();

    function visit(path: string) {
        if (protectedPaths.has(path)) {
            return;
        }
        protectedPaths.add(path);
        const cached = current.get(path) || ctx.workspaceState.get<CacheLuxFile>(path);
        for (const included of cached?.includes || []) {
            visit(included);
        }
    }

    for (const path of [
        ...current.keys(),
        ...activeLookups.keys(),
        ...(activeFilePath ? [activeFilePath] : []),
        ...(activeRootPath ? [activeRootPath] : []),
        ...pendingRootPaths
    ]) {
        visit(path);
    }
    return protectedPaths;
}

async function trimCache(
    ctx: vscode.ExtensionContext,
    current: Map<string, CacheLuxFile> = new Map()
) {
    const stored = ctx.workspaceState.get<string[]>("updateCache") || [];
    const paths = [...new Set(stored)].filter(path => !!ctx.workspaceState.get<CacheLuxFile>(path));
    const keep = protectedFiles(ctx, current);
    const removed = new Set<string>();

    for (const path of paths) {
        if (!keep.has(path)) {
            await ctx.workspaceState.update(path, undefined);
            removed.add(path);
            cacheInfo(ctx, `Removed ${path} from cache.`);
        }
    }
    await ctx.workspaceState.update("updateCache", paths.filter(path => !removed.has(path)));
}

async function performCacheUpdate(ctx: vscode.ExtensionContext, document: vscode.TextDocument) {
    if (!isCache()) {
        return;
    }
    const walk: CacheWalk = {
        active: new Set(),
        files: new Map(),
        documents: new Map(),
        changed: new Set(),
        failed: new Set()
    };

    try {
        await convertDocToCache(ctx, document, walk);

        // Refresh cached parents, including parents outside this lookup's include graph.
        let rebuilt: boolean;
        do {
            rebuilt = false;
            const stored = ctx.workspaceState.get<string[]>("updateCache") || [];
            const paths = new Set([...stored, ...walk.files.keys()]);
            for (const path of paths) {
                if (walk.changed.has(path)) {
                    continue;
                }
                const cached = walk.files.get(path) || ctx.workspaceState.get<CacheLuxFile>(path);
                if (!cached?.includes?.some(include => walk.changed.has(include))) {
                    continue;
                }
                const parent = walk.documents.get(path) || await vscode.workspace.openTextDocument(path);
                await convertDocToCache(ctx, parent, walk, true);
                rebuilt = true;
            }
        } while (rebuilt);

        for (const [path, cached] of walk.files) {
            if (walk.changed.has(path)) {
                cached.cached = true;
                await ctx.workspaceState.update(path, cached);
            }
        }

        const oldPaths = ctx.workspaceState.get<string[]>("updateCache") || [];
        const currentPaths = [...walk.files.keys()];
        await ctx.workspaceState.update("updateCache", [
            ...oldPaths.filter(path => !walk.files.has(path)),
            ...currentPaths
        ]);
        await trimCache(ctx, walk.files);
        if (walk.changed.size > 0) {
            cacheInfo(ctx, `Cached ${walk.changed.size} ${walk.changed.size === 1 ? "file" : "files"}.`);
        }
    } catch (error) {
        // A failed include invalidates the file and every cached parent that uses it.
        const oldPaths = ctx.workspaceState.get<string[]>("updateCache") || [];
        const invalid = new Set([document.uri.fsPath, ...walk.documents.keys(), ...walk.failed]);
        let foundParent: boolean;
        do {
            foundParent = false;
            for (const path of oldPaths) {
                const cached = ctx.workspaceState.get<CacheLuxFile>(path);
                if (!invalid.has(path) && cached?.includes?.some(include => invalid.has(include))) {
                    invalid.add(path);
                    foundParent = true;
                }
            }
        } while (foundParent);
        for (const path of invalid) {
            await ctx.workspaceState.update(path, undefined);
        }
        await ctx.workspaceState.update("updateCache", oldPaths.filter(path => !invalid.has(path)));
        throw error;
    }
}

export async function updateCache(
    ctx: vscode.ExtensionContext,
    document: vscode.TextDocument | undefined
) {
    if (!isCache() || !document || document.languageId !== LUX_MODE.language) {
        return
    }

    const queued = cacheUpdates.then(() => performCacheUpdate(ctx, document));
    cacheUpdates = queued.catch(() => {});
    return queued;
}
