import * as vscode from 'vscode';
import { basename, isAbsolute, join } from 'path';
import { getActiveLuxRootPath, getCachedFiles, logLuxError, logLuxInfo, pinCacheFile, updateCache } from './cache';
import { isCache, isShowFullMacroBlockInFailureTrace } from './configuration';
import { IncludeBlock } from './types/lux.interface';
import { convertIncludePath } from './util';

interface FailureLocation {
    file?: string;
    lines: number[];
}

interface IncludeLine {
    line: number;
    raw: string;
    file?: string;
}

interface MacroRange {
    name: string;
    start: number;
    end: number;
}

interface LoopRange {
    start: number;
    end: number;
}

interface SourceFile {
    document: vscode.TextDocument;
    includes: IncludeLine[];
    macros: MacroRange[];
    loops: LoopRange[];
}

interface TraceLine {
    file: string;
    line: number;
}

interface TraceDocument {
    content: string;
    targets: Map<number, TraceLine>;
    labels: Map<number, {line: number; width: number; active: boolean}>;
}

interface TraceLogger {
    info(message: string): void;
    error(message: string): void;
}

const traceScheme = 'lux-failure';
const traceLanguage = 'lux-failure';

class FailureLocationDocuments implements vscode.TextDocumentContentProvider, vscode.DefinitionProvider {
    private readonly traces = new Map<string, TraceDocument>();
    private nextId = 0;

    add(trace: TraceDocument): vscode.Uri {
        const uri = vscode.Uri.parse(`${traceScheme}:/failure-${++this.nextId}.luxtrace`);
        this.traces.set(uri.toString(), trace);
        return uri;
    }

    remove(uri: vscode.Uri): void {
        this.traces.delete(uri.toString());
    }

    get(uri: vscode.Uri): TraceDocument | undefined {
        return this.traces.get(uri.toString());
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.traces.get(uri.toString())?.content || '';
    }

    provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Location | undefined {
        const target = this.traces.get(document.uri.toString())?.targets.get(position.line);
        return target && new vscode.Location(
            vscode.Uri.file(target.file),
            new vscode.Position(target.line - 1, 0)
        );
    }
}

function parseLocation(input: string): FailureLocation | undefined {
    const match = input.trim().match(/^(?:(.+?\.lux(?:\.tmpl)?):)?([1-9]\d*(?::-?[1-9]\d*)*)$/);
    if (!match) {
        return undefined;
    }
    const lines = match[2].split(':').map(Number);
    return lines.every(Number.isSafeInteger) ? {file: match[1], lines} : undefined;
}

function isLuxRoot(file: string): boolean {
    return file.endsWith('.lux') || file.endsWith('.lux.tmpl');
}

async function openSource(file: string): Promise<vscode.TextDocument | undefined> {
    try {
        return await vscode.workspace.openTextDocument(file);
    } catch {
        return undefined;
    }
}

async function selectRoot(file: string | undefined, log: TraceLogger): Promise<vscode.TextDocument | undefined> {
    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    const current = active && isLuxRoot(active) ? active : getActiveLuxRootPath();
    if (!file) {
        if (!current) {
            log.error('No active Lux root for a line-only failure location.');
            return undefined;
        }
        const document = await openSource(current);
        if (!document) {
            log.error(`Root file not found or cannot be opened: ${current}`);
        }
        return document;
    }

    if (!isAbsolute(file) && !file.includes('/') && !file.includes('\\') &&
        current && basename(current) === file) {
        const document = await openSource(current);
        if (document) {
            return document;
        }
    }

    const paths = isAbsolute(file)
        ? [file]
        : file.includes('/') || file.includes('\\')
            ? (vscode.workspace.workspaceFolders || []).map(folder => join(folder.uri.fsPath, file))
            : (await vscode.workspace.findFiles(`**/${file}`, undefined, 200)).map(uri => uri.fsPath);
    if (paths.length === 0) {
        log.error(`Root file not found in the workspace: ${file}`);
    }
    const documents = (await Promise.all([...new Set(paths)].map(async path => {
        const document = await openSource(path);
        if (!document) {
            log.error(`Root file not found or cannot be opened: ${path}`);
        }
        return document;
    })))
        .filter((doc): doc is vscode.TextDocument => !!doc);
    if (documents.length < 2) {
        return documents[0];
    }
    const selected = await vscode.window.showQuickPick(
        documents.map(document => ({label: document.uri.fsPath, document})),
        {placeHolder: `Select ${file}`}
    );
    log.info(selected ? `Selected root file: ${selected.document.uri.fsPath}` : `Root file selection cancelled: ${file}`);
    return selected?.document;
}

async function resolveInclude(document: vscode.TextDocument, raw: string, line: number, log: TraceLogger): Promise<vscode.TextDocument | undefined> {
    const path = await convertIncludePath(document, raw);
    const direct = await openSource(path);
    if (direct) {
        return direct;
    }
    if (!raw.includes('$')) {
        log.error(`Include file not found: ${document.uri.fsPath}:${line} [include ${raw}] resolved to ${path}`);
        return undefined;
    }
    const suffix = raw.replace(/"/g, '').replace(/^\$(?:\{[^}]+\}|\w+)\/?/, '');
    const found = await vscode.workspace.findFiles(`**/${suffix}`, undefined, 20);
    if (found.length === 1) {
        const fallback = await openSource(found[0].fsPath);
        if (fallback) {
            log.info(`Resolved include ${document.uri.fsPath}:${line} through workspace search: ${fallback.uri.fsPath}`);
            return fallback;
        }
    }
    log.error(`Include file not found: ${document.uri.fsPath}:${line} [include ${raw}]; resolved path ${path}; workspace matches ${found.length}`);
    return undefined;
}

async function readSource(document: vscode.TextDocument, log: TraceLogger): Promise<{source: SourceFile; children: vscode.TextDocument[]}> {
    const includes: IncludeLine[] = [];
    const macros: MacroRange[] = [];
    const loops: LoopRange[] = [];
    const openMacros: Array<{name: string; start: number}> = [];
    const openLoops: number[] = [];
    for (let i = 0; i < document.lineCount; i++) {
        const text = document.lineAt(i).text;
        const include = text.match(/^\s*\[include\s+(.+?)\s*\]/);
        if (include) {
            includes.push({line: i + 1, raw: include[1]});
        }
        const macro = text.match(/^\s*\[macro\s+([^\s\]]+)/);
        if (macro) {
            openMacros.push({name: macro[1], start: i + 1});
        } else if (/^\s*\[endmacro\]/.test(text)) {
            const started = openMacros.pop();
            if (started) {
                macros.push({...started, end: i + 1});
            }
        }
        if (/^\s*\[loop(?:\s|\])/.test(text)) {
            openLoops.push(i + 1);
        } else if (/^\s*\[endloop\]/.test(text)) {
            const started = openLoops.pop();
            if (started !== undefined) {
                loops.push({start: started, end: i + 1});
            }
        }
    }
    const children = await Promise.all(includes.map(async include => {
        const child = await resolveInclude(document, include.raw, include.line, log);
        include.file = child?.uri.fsPath;
        return child;
    }));
    return {
        source: {document, includes, macros, loops},
        children: children.filter((doc): doc is vscode.TextDocument => !!doc)
    };
}

async function loadCachedSources(
    ctx: vscode.ExtensionContext,
    root: vscode.TextDocument,
    log: TraceLogger
): Promise<Map<string, SourceFile> | undefined> {
    if (!isCache()) {
        log.info('Cache is disabled; reading Lux source files.');
        return undefined;
    }
    const release = pinCacheFile(ctx, root);
    try {
        if (root.uri.fsPath === getActiveLuxRootPath()) {
            await updateCache(ctx, root);
        }
        const files = getCachedFiles(ctx, root);
        if (files.length === 0) {
            log.info(`No cached files found for ${root.uri.fsPath}; reading source files.`);
            return undefined;
        }
        const byPath = new Map(files.map(file => [file.fileInfo.file, file]));
        if (files.some(file => !Array.isArray(file.includes) || !Array.isArray(file.lux?.run) ||
            !Array.isArray(file.macroDeclarations) || !Array.isArray(file.decorationBlocks) ||
            file.includes.some(include => !byPath.has(include)))) {
            log.info(`Cached include or block data is incomplete for ${root.uri.fsPath}; reading source files.`);
            return undefined;
        }
        const documents = await Promise.all(files.map(file => openSource(file.fileInfo.file)));
        const sources = new Map<string, SourceFile>();
        for (let i = 0; i < files.length; i++) {
            const cache = files[i];
            const document = documents[i];
            if (!document) {
                log.error(`Cached source file not found or cannot be opened: ${cache.fileInfo.file}; reading source files.`);
                return undefined;
            }
            if (document.version !== cache.fileInfo.version) {
                log.info(`Cached source changed: ${cache.fileInfo.file}; reading source files.`);
                return undefined;
            }
            const includeBlocks = cache.lux.run.filter((block): block is IncludeBlock => block.type === 'include');
            if (includeBlocks.length !== cache.includes.length ||
                includeBlocks.some(block => !byPath.has(block.cachePath))) {
                log.info(`Cached includes are incomplete for ${cache.fileInfo.file}; reading source files.`);
                return undefined;
            }
            const ranges = new Map(cache.decorationBlocks!
                .filter(block => block.type === 'macro')
                .map(block => [block.startLine, block.endLine]));
            const macros: MacroRange[] = [];
            for (const declaration of cache.macroDeclarations) {
                const end = ranges.get(declaration.line);
                if (end === undefined) {
                    log.info(`Cached macro range is incomplete for ${cache.fileInfo.file}:${declaration.line + 1}; reading source files.`);
                    return undefined;
                }
                macros.push({name: declaration.name, start: declaration.line + 1, end: end + 1});
            }
            sources.set(document.uri.fsPath, {
                document,
                includes: includeBlocks.map(block => ({line: block.line + 1, raw: block.path, file: block.cachePath})),
                macros,
                loops: cache.decorationBlocks!
                    .filter(block => block.type === 'loop')
                    .map(block => ({start: block.startLine + 1, end: block.endLine + 1}))
            });
        }
        log.info(`Using ${sources.size} cached ${sources.size === 1 ? 'file' : 'files'} for failure trace.`);
        return sources;
    } catch (error) {
        log.error(`Could not use cached failure trace data: ${String(error)}; reading source files.`);
        return undefined;
    } finally {
        release();
    }
}

async function loadSources(root: vscode.TextDocument, log: TraceLogger): Promise<Map<string, SourceFile>> {
    const sources = new Map<string, SourceFile>();
    const queued = new Set([root.uri.fsPath]);
    let batch = [root];
    while (batch.length > 0) {
        const read = await Promise.all(batch.map(document => readSource(document, log)));
        batch = [];
        for (const {source, children} of read) {
            sources.set(source.document.uri.fsPath, source);
            for (const child of children) {
                if (!queued.has(child.uri.fsPath)) {
                    queued.add(child.uri.fsPath);
                    batch.push(child);
                }
            }
        }
    }
    log.info(`Read ${sources.size} ${sources.size === 1 ? 'file' : 'files'} for failure trace.`);
    return sources;
}

function orderedSources(root: string, sources: Map<string, SourceFile>): SourceFile[] {
    const seen = new Set<string>();
    const ordered: SourceFile[] = [];
    function visit(file: string) {
        if (seen.has(file)) {
            return;
        }
        seen.add(file);
        const source = sources.get(file);
        if (source) {
            ordered.push(source);
            source.includes.forEach(include => include.file && visit(include.file));
        }
    }
    visit(root);
    return ordered;
}

async function chooseSource(candidates: SourceFile[], line: number, reason: string, log: TraceLogger): Promise<SourceFile | undefined> {
    const commands = candidates.filter(source => isMacroCommand(source, line));
    if (commands.length > 0) {
        candidates.filter(source => !isMacroCommand(source, line)).forEach(source =>
            log.info(`Eliminated ${source.document.uri.fsPath}:${line}: ${invalidMacroCommandReason(source, line)}`));
    } else if (candidates.length > 0) {
        log.info(`No command-valid candidates at line ${line}; retaining ${candidates.length} candidate files for selection.`);
    }
    const viable = commands.length > 0 ? commands : candidates;
    const unique = [...new Map(viable.map(source => [source.document.uri.fsPath, source])).values()];
    if (unique.length < 2) {
        if (unique[0]) {
            log.info(`Resolved failure path to ${unique[0].document.uri.fsPath}:${line}.`);
        }
        return unique[0];
    }
    log.info(`Choosing among ${unique.length} possible files for line ${line}: ${reason}`);
    const selected = await vscode.window.showQuickPick(
        unique.map(source => {
            const macro = source.macros.find(macro => macro.start <= line && line <= macro.end);
            return {
                label: source.document.uri.fsPath,
                description: macro ? `[macro ${macro.name}] lines ${macro.start}-${macro.end}` : '',
                detail: line <= source.document.lineCount
                    ? `Line ${line}: ${source.document.lineAt(line - 1).text.trim()}`
                    : `Line ${line} is outside this file`,
                source
            };
        }),
        {placeHolder: `Select the file for Lux line ${line}`, prompt: reason, matchOnDescription: true}
    );
    log.info(selected ? `Selected failure path ${selected.source.document.uri.fsPath}:${line}.` : `Failure path selection cancelled at line ${line}.`);
    return selected?.source;
}

function literalInvokeArguments(text: string): string[] {
    const invoke = text.match(/^\s*\[invoke\s+(.+)\]\s*$/);
    const words = invoke?.[1].match(/"(?:\\.|[^"\\])*"|[^\s"]+/g);
    return words?.slice(1).filter(word => !word.startsWith('"') && !word.includes('$')) || [];
}

function invalidMacroCommandReason(source: SourceFile, line: number): string | undefined {
    if (line < 1 || line > source.document.lineCount) {
        return `line is outside the file (${source.document.lineCount} lines)`;
    }
    const text = source.document.lineAt(line - 1).text.trim();
    if (text === '') {
        return 'blank line';
    }
    if (text.startsWith('#')) {
        return 'comment line';
    }
    if (/^\[(?:macro|endmacro|endloop)\b/.test(text)) {
        return 'macro or block boundary';
    }
    return undefined;
}

function isMacroCommand(source: SourceFile, line: number): boolean {
    return invalidMacroCommandReason(source, line) === undefined;
}

function canReachFollowingLine(source: SourceFile, line: number, followingLine: number, ordered: SourceFile[]): boolean {
    const text = source.document.lineAt(line - 1).text;
    const invoke = text.match(/^\s*\[invoke\s+([^\s\]]+)/);
    if (!invoke || invoke[1].includes('$')) {
        return true;
    }
    const named = ordered.flatMap(candidate => candidate.macros
        .filter(macro => macro.name === invoke[1])
        .map(macro => ({candidate, macro})));
    return named.length === 0 || named.some(({candidate, macro}) =>
        macro.start <= followingLine && followingLine <= macro.end &&
        isMacroCommand(candidate, followingLine));
}

async function nextSource(
    current: SourceFile,
    line: number,
    nextLine: number,
    ordered: SourceFile[],
    log: TraceLogger,
    previous?: {source: SourceFile; line: number},
    followingLine?: number
): Promise<SourceFile | undefined> {
    const include = current.includes.find(item => item.line === line);
    if (include) {
        const resolved = ordered.find(source => source.document.uri.fsPath === include.file);
        if (!resolved) {
            log.error(`Cannot follow include at ${current.document.uri.fsPath}:${line}: ${include.raw}; included file is unavailable.`);
        }
        return resolved;
    }

    const text = current.document.lineAt(line - 1).text;
    const invoke = text.match(/^\s*\[invoke\s+([^\s\]]+)/);
    if (invoke) {
        const named = ordered.flatMap(source => source.macros
            .filter(macro => macro.name === invoke[1])
            .map(macro => ({source, macro})));
        const containing = named.filter(({macro}) => macro.start <= nextLine && nextLine <= macro.end);
        if (containing.length > 0) {
            named.filter(({macro}) => nextLine < macro.start || nextLine > macro.end).forEach(({source, macro}) =>
                log.info(`Eliminated ${source.document.uri.fsPath}:${nextLine}: outside [macro ${macro.name}] lines ${macro.start}-${macro.end}.`));
            return chooseSource(containing.map(({source}) => source), nextLine,
                `Several macros named ${invoke[1]} contain line ${nextLine}. Choose the one used by this failure.`, log);
        }
        if (named.length > 0) {
            log.info(`No [macro ${invoke[1]}] range contains line ${nextLine}; retaining name matches for selection.`);
            return chooseSource(named.map(({source}) => source), nextLine,
                `Several macros named ${invoke[1]} match, but none contains line ${nextLine}. Choose the source file.`, log);
        }
        const anyMacro = ordered.flatMap(source => source.macros
            .filter(macro => macro.start <= nextLine && nextLine <= macro.end)
            .map(macro => ({source, macro})));
        const valid = anyMacro.filter(({source}) => isMacroCommand(source, nextLine));
        anyMacro.filter(({source}) => !isMacroCommand(source, nextLine)).forEach(({source}) =>
            log.info(`Eliminated ${source.document.uri.fsPath}:${nextLine}: ${invalidMacroCommandReason(source, nextLine)}.`));
        if (valid.length > 0) {
            const follows = followingLine === undefined ? valid : valid.filter(({source}) =>
                canReachFollowingLine(source, nextLine, followingLine, ordered));
            if (follows.length > 0) {
                valid.filter(candidate => !follows.includes(candidate)).forEach(({source}) =>
                    log.info(`Eliminated ${source.document.uri.fsPath}:${nextLine}: cannot reach following line ${followingLine}.`));
            } else if (followingLine !== undefined) {
                log.info(`No candidate at line ${nextLine} passes lookahead to line ${followingLine}; retaining command-valid candidates.`);
            }
            const candidates = follows.length > 0 ? follows : valid;
            const caller = previous?.source.document.lineAt(previous.line - 1).text || '';
            const names = literalInvokeArguments(caller);
            const passed = candidates.filter(({macro}) => names.includes(macro.name));
            if (passed.length > 0) {
                candidates.filter(candidate => !passed.includes(candidate)).forEach(({source, macro}) =>
                    log.info(`Eliminated ${source.document.uri.fsPath}:${nextLine}: macro ${macro.name} is not a literal argument of the caller.`));
            }
            if (passed.length === 1) {
                log.info(`Resolved dynamic invoke to ${passed[0].source.document.uri.fsPath}:${nextLine}.`);
                return passed[0].source;
            }
            const reason = invoke[1].includes('$')
                ? `Lux resolves ${invoke[1]} at run time. Several included macros contain line ${nextLine}; choose the one used by this failure.`
                : `Cannot identify the macro ${invoke[1]}. Several included macros contain line ${nextLine}; choose the source file.`;
            return chooseSource((passed.length > 1 ? passed : candidates).map(({source}) => source), nextLine, reason, log);
        }
        log.error(`Cannot resolve invocation ${invoke[1]} at ${current.document.uri.fsPath}:${line}: no valid macro command at line ${nextLine}.`);
        return undefined;
    }

    if (nextLine <= current.document.lineCount) {
        return current;
    }
    const possible = ordered.filter(source => nextLine <= source.document.lineCount);
    if (possible.length !== 1) {
        log.error(`Cannot resolve line ${nextLine} after ${current.document.uri.fsPath}:${line}: ${possible.length} possible files.`);
    }
    return possible.length === 1 ? possible[0] : undefined;
}

async function renderTrace(location: FailureLocation, root: vscode.TextDocument, sources: Map<string, SourceFile>, log: TraceLogger): Promise<TraceDocument> {
    const ordered = orderedSources(root.uri.fsPath, sources);
    const showFullMacroBlock = isShowFullMacroBlockInFailureTrace();
    const output: string[] = [
        `# ${root.uri.fsPath}:${location.lines.join(':')}`,
        '# Use Go to Definition (F12) on a file heading or excerpt line to open its source.',
        ''
    ];
    const targets = new Map<number, TraceLine>();
    const labels = new Map<number, {line: number; width: number; active: boolean}>();
    let source: SourceFile | undefined = sources.get(root.uri.fsPath);
    let previous: {source: SourceFile; line: number} | undefined;
    for (let i = 0; i < location.lines.length; i++) {
        const line = location.lines[i];
        if (line < 0) {
            output.push(`# ${i + 1}. looped ${-line} ${line === -1 ? 'time' : 'times'}`);
            log.info(`Trace index ${i + 1}: looped ${-line} ${line === -1 ? 'time' : 'times'}.`);
            continue;
        }
        const nextLines = location.lines.slice(i + 1).filter(line => line > 0);
        const nextLine = nextLines[0];
        const omitLoopHeader = source && nextLine !== undefined && source.loops.some(loop =>
            loop.start === line && loop.start < nextLine && nextLine < loop.end);
        if (source && line <= source.document.lineCount) {
            targets.set(output.length, {file: source.document.uri.fsPath, line});
        }
        output.push(`# ${i + 1}. ${source ? `${source.document.uri.fsPath}:${line}` : 'Source file unresolved'}${omitLoopHeader ? ' - skipped loop header' : ''}`);
        if (!source) {
            log.error(`Trace index ${i + 1} (line ${line}): source file could not be resolved from the previous index.`);
            output.push(`# ${line}: Source file could not be resolved from the previous line.`, '');
            continue;
        }
        if (line > source.document.lineCount) {
            log.error(`Trace index ${i + 1}: ${source.document.uri.fsPath}:${line} is outside the file (${source.document.lineCount} lines).`);
            output.push(`# ${line}: Line is outside this file (${source.document.lineCount} lines).`, '');
            source = undefined;
            continue;
        }
        log.info(`Trace index ${i + 1}: ${source.document.uri.fsPath}:${line}${omitLoopHeader ? ' (skipped loop header)' : ''}.`);
        if (!omitLoopHeader) {
            const macro = showFullMacroBlock
                ? source.macros.filter(macro => macro.start <= line && line <= macro.end)
                    .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0]
                : undefined;
            const firstLine = Math.max(1, macro?.start ?? line - 2);
            const lastLine = Math.min(source.document.lineCount, macro?.end ?? line + 2);
            const width = String(lastLine).length;
            for (let n = firstLine; n <= lastLine; n++) {
                targets.set(output.length, {file: source.document.uri.fsPath, line: n});
                labels.set(output.length, {line: n, width, active: n === line});
                output.push(source.document.lineAt(n - 1).text);
            }
            output.push('');
        }
        if (nextLine !== undefined) {
            const next = await nextSource(source, line, nextLine, ordered, log, previous, nextLines[1]);
            previous = {source, line};
            source = next;
        }
    }
    return {content: output.join('\n'), targets, labels};
}

export function registerFailureLocationCommand(ctx: vscode.ExtensionContext): void {
    const documents = new FailureLocationDocuments();
    const log: TraceLogger = {
        info: message => logLuxInfo(ctx, `Generate trace: ${message}`),
        error: message => logLuxError(ctx, `Generate trace: ${message}`)
    };
    const lineNumberDecoration = vscode.window.createTextEditorDecorationType({
        before: {margin: '0 0.8em 0 0'}
    });
    const decorateTrace = (editor: vscode.TextEditor): void => {
        const trace = editor.document.uri.scheme === traceScheme
            ? documents.get(editor.document.uri)
            : undefined;
        if (!trace) {
            return;
        }
        editor.setDecorations(lineNumberDecoration, [...trace.labels].map(([row, label]) => {
            const hasText = editor.document.lineAt(row).text.length > 0;
            return {
                range: new vscode.Range(row, 0, hasText ? row : row + 1, hasText ? 1 : 0),
                renderOptions: {
                    before: {
                        contentText: `  ${String(label.line).padStart(label.width)}${label.active ? ':' : ' '} `,
                        color: new vscode.ThemeColor(label.active
                            ? 'editorLineNumber.activeForeground'
                            : 'editorLineNumber.foreground')
                    }
                }
            };
        }));
    };
    ctx.subscriptions.push(lineNumberDecoration);
    ctx.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(traceScheme, documents));
    ctx.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(editors => {
        editors.forEach(decorateTrace);
    }));
    ctx.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
        if (document.uri.scheme !== traceScheme) {
            return;
        }
        setTimeout(() => {
            if (!vscode.workspace.textDocuments.some(open => open.uri.toString() === document.uri.toString())) {
                documents.remove(document.uri);
            }
        }, 0);
    }));
    ctx.subscriptions.push(vscode.languages.registerDefinitionProvider({scheme: traceScheme}, documents));
    ctx.subscriptions.push(vscode.commands.registerCommand('lux.showFailureLocation', async (provided?: string) => {
        const activeEditor = vscode.window.activeTextEditor;
        const selected = activeEditor?.document.getText(activeEditor.selection).trim();
        const input = provided || await vscode.window.showInputBox({
            prompt: 'Enter a Lux failure location',
            placeHolder: 'path/a/b/test.lux:576:53:732:727, test.lux:576:53:732:727, or 576:53:732:727',
            value: selected && parseLocation(selected) ? selected : '',
            validateInput: value => parseLocation(value) ? undefined : 'Enter a Lux file and line numbers, or line numbers for the active Lux file.'
        });
        if (!input) {
            return;
        }
        const location = parseLocation(input);
        if (!location) {
            log.error(`Invalid failure location: ${input}`);
            vscode.window.showErrorMessage('Invalid Lux failure location.');
            return;
        }
        log.info(`Generating ${input.trim()}.`);
        try {
            const root = await selectRoot(location.file, log);
            if (!root) {
                vscode.window.showErrorMessage(location.file
                    ? `Cannot find Lux file ${location.file}.`
                    : 'Open a .lux or .lux.tmpl file before using line numbers alone.');
                return;
            }
            log.info(`Root file: ${root.uri.fsPath}.`);
            const sources = await loadCachedSources(ctx, root, log) || await loadSources(root, log);
            const trace = await renderTrace(location, root, sources, log);
            const uri = documents.add(trace);
            let document = await vscode.workspace.openTextDocument(uri);
            if (document.languageId !== traceLanguage) {
                document = await vscode.languages.setTextDocumentLanguage(document, traceLanguage);
            }
            const editor = await vscode.window.showTextDocument(document, {preview: true});
            decorateTrace(editor);
            log.info(`Generated ${uri.toString()} from ${sources.size} ${sources.size === 1 ? 'file' : 'files'}.`);
        } catch (error) {
            log.error(`Generation failed for ${input.trim()}: ${String(error)}`);
            vscode.window.showErrorMessage(`Cannot generate Lux failure trace: ${String(error)}`);
        }
    }));
}
