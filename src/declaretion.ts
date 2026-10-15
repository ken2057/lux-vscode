/*---------------------------------------------------------
 * This code based from
 * https://github.com/microsoft/vscode-go/blob/master/src/goDeclaration.ts
 *--------------------------------------------------------*/

import * as vscode from 'vscode';
import { dirname, relative } from 'path';
import { WordType, getWordFromPosition, convertIncludePath, skipLine } from './util';
import { PATH_SEPARATOR } from './const';
import { CachedLocation, CacheLuxFile, getCachedFiles, getOtherCachedFiles, pinCacheFile, updateCache } from './cache';
import { isCache } from './configuration';

export interface DefinitionInformation {
    column: number;
    line: number;
}

export interface GoDefinitionInformation {
    file: string;
    declarationlines: DefinitionInformation[];
}

export async function definitionLocation(
    ctx: vscode.ExtensionContext,
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
): Promise<GoDefinitionInformation[] | null> {
    const wordType = getWordFromPosition(document, position);
    if (!wordType || token.isCancellationRequested) {
        return null;
    }

    if (wordType.type === "link") {
        const file = await convertIncludePath(document, wordType.value);
        return file ? [{file, declarationlines: [{line: 0, column: 0}]}] : null;
    }

    if (!isCache()) {
        return textDefinitionLocation(document, position, wordType, token);
    }

    const release = pinCacheFile(ctx, document);
    try {
        await updateCache(ctx, document);
        if (token.isCancellationRequested) {
            return null;
        }

        const files = getCachedFiles(ctx, document);
        if (wordType.type === "invoke") {
            return findCachedMacroUses(ctx, document, wordType, position, token, files);
        }
        const searchFiles = wordType.find_on_same_folder
            ? await getSameFolderCaches(ctx, document, token)
            : files;
        if (token.isCancellationRequested) {
            return null;
        }
        const matches = findCachedMatches(searchFiles, wordType, position);
        if (matches.length > 0) {
            return toDefinitionInformation(matches);
        }
        let scopedFiles = searchFiles;
        if (!wordType.find_on_same_folder) {
            scopedFiles = await getSameFolderCaches(ctx, document, token);
            if (token.isCancellationRequested) {
                return null;
            }
            const includedPaths = new Set(files.map(file => file.fileInfo.file));
            const siblings = scopedFiles.filter(file => !includedPaths.has(file.fileInfo.file));
            const siblingMatches = findCachedMatches(siblings, wordType, position, true);
            if (siblingMatches.length > 0) {
                return toDefinitionInformation(wordType.find_all ? siblingMatches : siblingMatches.slice(0, 1));
            }
        }
        const otherFiles = getOtherCachedFiles(ctx, scopedFiles);
        if (!wordType.find_all) {
            otherFiles.sort((a, b) =>
                fileDistance(document.fileName, a.fileInfo.file) - fileDistance(document.fileName, b.fileInfo.file) ||
                a.fileInfo.file.localeCompare(b.fileInfo.file)
            );
        }
        const otherMatches = findCachedMatches(otherFiles, wordType, position, true);
        return toDefinitionInformation(wordType.find_all ? otherMatches : otherMatches.slice(0, 1));
    } catch {
        return token.isCancellationRequested
            ? null
            : textDefinitionLocation(document, position, wordType, token);
    } finally {
        release();
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function textDefinitionLocation(
    document: vscode.TextDocument,
    position: vscode.Position,
    wordType: WordType,
    token: vscode.CancellationToken
): Promise<GoDefinitionInformation[] | null> {
    const name = escapeRegExp(wordType.value);
    const checkedFiles = new Set<string>();
    let regs: RegExp[];

    switch (wordType.type) {
        case "variable":
            regs = [
                new RegExp(`\\[(?:global|local|my)\\s+${name}(?=\\s*=)`),
                new RegExp(`\\[macro\\s+[^\\]]*\\s+${name}(?=\\s|\\])`),
                new RegExp(`\\[loop\\s+${name}(?=\\s)`)
            ];
            break;
        case "use_variable":
            regs = [new RegExp(`\\$${name}\\b`), new RegExp(`\\$\\{${name}\\}`)];
            break;
        case "macro": {
            const pattern = wordType.find_all
                ? wordType.value.split(/\$(?:\{\w+\}|\w+)/).map(escapeRegExp).join("[-_\\w]+")
                : name;
            regs = [new RegExp(`\\[macro\\s+${pattern}(?=\\s|\\])`)];
            break;
        }
        case "invoke":
            regs = [new RegExp(`\\[invoke\\s+${name}(?=\\s|\\])`)];
            break;
        default:
            return null;
    }

    const current = await findDeclaretion(document, position, wordType, regs, token, checkedFiles);
    if (token.isCancellationRequested) {
        return null;
    }
    if (!wordType.find_all) {
        return current?.length
            ? current
            : fineDeclareionInSameFolder(document, wordType, regs, token, checkedFiles, false);
    }
    if (current?.length || !wordType.find_on_same_folder) {
        return current;
    }
    return fineDeclareionInSameFolder(document, wordType, regs, token, checkedFiles);
}

type CacheIndex = "variableDeclarations" | "macroDeclarations" | "variableUses" | "invokes";

function fileDistance(from: string, to: string): number {
    const path = relative(dirname(from), dirname(to));
    return path ? path.split(/[\\/]/).length : 0;
}

async function mapConcurrent<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    await Promise.all(Array.from({length: Math.min(items.length, 8)}, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index]);
        }
    }));
    return results;
}

function findCachedMatches(
    files: CacheLuxFile[],
    wordType: WordType,
    position: vscode.Position,
    all = false
): CachedLocation[] {
    switch (wordType.type) {
        case "variable":
            return all
                ? findMatches(files, "variableDeclarations", wordType.value)
                : findNearest(files, "variableDeclarations", wordType.value, position);
        case "macro":
            if (wordType.find_all) {
                return findMatchingMacros(files, wordType.value);
            }
            return all
                ? findMatches(files, "macroDeclarations", wordType.value)
                : findNearest(files, "macroDeclarations", wordType.value, position);
        case "invoke":
            return findMatches(files, "invokes", wordType.value);
        case "use_variable":
            return findMatches(files, "variableUses", wordType.value);
        default:
            return [];
    }
}

function findMatches(files: CacheLuxFile[], index: CacheIndex, name: string): CachedLocation[] {
    return files.flatMap(file => (file[index] || []).filter(location => location.name === name));
}

function findNearest(
    files: CacheLuxFile[],
    index: CacheIndex,
    name: string,
    position: vscode.Position
): CachedLocation[] {
    const currentFile = files[0];
    if (currentFile) {
        const matches = findMatches([currentFile], index, name)
            .sort((a, b) => a.line - b.line || a.col - b.col);
        if (matches.length > 0) {
            const before = matches.filter(location =>
                location.line < position.line ||
                (location.line === position.line && location.col <= position.character)
            );
            return [before.length > 0 ? before[before.length - 1] : matches[0]];
        }
    }

    return findMatches(files.slice(1), index, name).slice(0, 1);
}

function findMatchingMacros(files: CacheLuxFile[], namePattern: string): CachedLocation[] {
    const source = namePattern.split(/\$(?:\{\w+\}|\w+)/)
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join("[-_\\w]+");
    const pattern = new RegExp(`^${source}$`);
    return files.flatMap(file => (file.macroDeclarations || [])
        .filter(location => pattern.test(location.name)));
}

function toDefinitionInformation(locations: CachedLocation[]): GoDefinitionInformation[] | null {
    return locations.length > 0 ? locations.map(location => ({
        file: location.file,
        declarationlines: [{line: location.line, column: location.col}]
    })) : null;
}

async function findCachedMacroUses(
    ctx: vscode.ExtensionContext,
    document: vscode.TextDocument,
    wordType: WordType,
    position: vscode.Position,
    token: vscode.CancellationToken,
    files: CacheLuxFile[]
): Promise<GoDefinitionInformation[] | null> {
    const current = toDefinitionInformation(findCachedMatches(files, wordType, position)) || [];
    if (current.length > 0 && !wordType.find_on_same_folder) {
        return current;
    }

    const checkedFiles = new Set(files.map(file => file.fileInfo.file));
    const pattern = new RegExp(`\\[invoke\\s+${escapeRegExp(wordType.value)}(?=\\s|\\])`);
    const sameFolder = await fineDeclareionInSameFolder(document, wordType, [pattern], token, checkedFiles);
    if (token.isCancellationRequested) {
        return null;
    }
    const matches = wordType.find_on_same_folder
        ? [...current, ...(sameFolder || [])]
        : (sameFolder || []);
    if (matches.length > 0) {
        return matches;
    }

    const otherFiles = getOtherCachedFiles(ctx, files)
        .filter(file => !checkedFiles.has(file.fileInfo.file));
    return toDefinitionInformation(findCachedMatches(otherFiles, wordType, position, true));
}

async function getSameFolderCaches(
    ctx: vscode.ExtensionContext,
    document: vscode.TextDocument,
    token: vscode.CancellationToken
): Promise<CacheLuxFile[]> {
    const checkedFiles = new Set<string>();
    const caches = getCachedFiles(ctx, document, checkedFiles);
    const dir = document.fileName.substring(0, document.fileName.lastIndexOf(PATH_SEPARATOR));
    const files = (await vscode.workspace.findFiles(new vscode.RelativePattern(dir, "*.{lux,luxinc,lux.tmpl}")))
        .sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    const siblings = files.filter(file => !checkedFiles.has(file.fsPath));
    const found = await mapConcurrent(siblings, async file => {
        if (token.isCancellationRequested) {
            return [];
        }
        const sibling = await vscode.workspace.openTextDocument(file);
        const release = pinCacheFile(ctx, sibling);
        try {
            await updateCache(ctx, sibling);
            return getCachedFiles(ctx, sibling);
        } finally {
            release();
        }
    });
    for (const group of found) {
        for (const cached of group) {
            if (!checkedFiles.has(cached.fileInfo.file)) {
                checkedFiles.add(cached.fileInfo.file);
                caches.push(cached);
            }
        }
    }
    return caches;
}

async function fineDeclareionInSameFolder(
    document: vscode.TextDocument,
    wordType: WordType,
    regs: RegExp[],
    token: vscode.CancellationToken,
    checkedFiles: Set<string>,
    all = true
): Promise<GoDefinitionInformation[] | null> {
    const dir = document.fileName.substring(0, document.fileName.lastIndexOf(PATH_SEPARATOR))
    const relativePattern = new vscode.RelativePattern(dir, "*.{lux,luxinc,lux.tmpl}")
    const files = (await vscode.workspace.findFiles(relativePattern))
        .filter(file => !checkedFiles.has(file.fsPath))
        .sort((a, b) => a.fsPath.localeCompare(b.fsPath));

    let allResult: GoDefinitionInformation[] = []
    const searchWordType = {...wordType, find_all: all};

    const found = await Promise.all(files.map(async file => {
        const visited = new Set(checkedFiles);
        if (token.isCancellationRequested) {
            return {result: null, visited};
        }
        const doc = await vscode.workspace.openTextDocument(file);
        const result = await findDeclaretion(doc, new vscode.Position(0, 0), searchWordType, regs, token, visited);
        return {result, visited};
    }));
    if (token.isCancellationRequested) {
        return null;
    }
    const seen = new Set<string>();
    for (const {result: group, visited} of found) {
        for (const file of visited) {
            checkedFiles.add(file);
        }
        if (!all && group?.length) {
            return group;
        }
        for (const result of group || []) {
            const lines = result.declarationlines.filter(line => {
                const key = `${result.file}:${line.line}:${line.column}`;
                if (seen.has(key)) {
                    return false;
                }
                seen.add(key);
                return true;
            });
            if (lines.length > 0) {
                allResult.push({...result, declarationlines: lines});
            }
        }
    }
    return allResult.length > 0 ? allResult : null
}

function getDeclaretionLine(
    document: vscode.TextDocument,
    matchIdx: number,
    word: string
): DefinitionInformation {
    const pos = document.positionAt(matchIdx)
    const textLine = document.lineAt(pos.line).text

    const exclude = "[^-_\\w]"

    const name = escapeRegExp(word)
    const surrounded = textLine.search(new RegExp(`${exclude}${name}${exclude}`))
    const col = surrounded >= 0 ? surrounded + 1 : textLine.search(new RegExp(`\\b${name}\\b`))

    return {
        line: pos.line,
        column: col
    }
}

async function findDeclaretion(
    document: vscode.TextDocument,
    position: vscode.Position,
    wordType: WordType,
    regs: RegExp[],
    token: vscode.CancellationToken,
    checkedFiles: Set<string>
): Promise<GoDefinitionInformation[] | null> {
    if (checkedFiles.has(document.fileName)) {
        return null
    }
    checkedFiles.add(document.fileName)

    var defInfo: GoDefinitionInformation = {
        file: document.fileName,
        declarationlines: new Array<DefinitionInformation>(),
    }

    const offsetCursor = document.offsetAt(position)

    for (let regIdx = 0; regIdx < regs.length; regIdx++) {
        let cutTextCount = 0
        if (token.isCancellationRequested) {
            return Promise.resolve(null)
        }

        let curText = document.getText()
        let matchIdx = curText.search(regs[regIdx])

        if (matchIdx === -1) {
            continue
        }

        while (true) {
            if (matchIdx === -1) {
                break
            }
            if (token.isCancellationRequested) {
                return Promise.resolve(null)
            }

            const declaretionLine = getDeclaretionLine(document, matchIdx, wordType.value)
            if (declaretionLine.column < 0 && wordType.type === "macro") {
                const textLine = document.lineAt(declaretionLine.line).text;
                const macro = textLine.match(/\[macro\s+([^\s\]]+)/);
                if (macro) {
                    declaretionLine.column = textLine.indexOf(macro[1], macro.index! + 6);
                }
            }
            if (!skipLine(document.lineAt(declaretionLine.line).text)) {
                if (wordType.find_all)  {
                    defInfo.declarationlines.push(declaretionLine)
                } else {
                    if (matchIdx > offsetCursor) {
                        if (defInfo.declarationlines.length == 0) {
                            defInfo.declarationlines.push(declaretionLine)
                        }
                        break
                    }
                    defInfo.declarationlines = [declaretionLine]
                }
            }

            const cut = matchIdx - cutTextCount + 1
            curText = curText.substring(cut)
            cutTextCount += cut
            matchIdx = curText.search(regs[regIdx])
            matchIdx = matchIdx != -1 ? matchIdx + cutTextCount : -1

        }
    }

    if (defInfo.declarationlines.length != 0) {
        if (wordType.find_all) {
            const included = await findIncludeDeclaretion(document, wordType, regs, token, checkedFiles);
            return [defInfo, ...(included || [])];
        }
        return [defInfo];
    }

    return findIncludeDeclaretion(document, wordType, regs, token, checkedFiles)
}

async function findIncludeDeclaretion(
    document: vscode.TextDocument,
    wordType: WordType,
    regs: RegExp[],
    token: vscode.CancellationToken,
    checkedFiles: Set<string>
): Promise<GoDefinitionInformation[] | null> {
    const includes = [...document.getText().matchAll(/\[include (.+)\]/g)].map(match => match[1]);
    const found = await mapConcurrent(includes, async includeFile => {
        const visited = new Set(checkedFiles);
        if (token.isCancellationRequested) {
            return {result: null, visited};
        }
        const filePath = await convertIncludePath(document, includeFile);
        const path = filePath || includeFile;
        if (visited.has(path)) {
            return {result: null, visited};
        }
        try {
            const included = await vscode.workspace.openTextDocument(path);
            const result = await findDeclaretion(included, new vscode.Position(0, 0), wordType, regs, token, visited);
            return {result, visited};
        } catch (reason) {
            let error = String(reason);
            error = error.includes("cannot open file") ? `[include ${path}] file not found` : error;
            vscode.window.showErrorMessage(error);
            return {result: null, visited};
        }
    });
    if (token.isCancellationRequested) {
        return null;
    }
    const results: GoDefinitionInformation[] = [];
    const seen = new Set<string>();
    for (const {result, visited} of found) {
        for (const file of visited) {
            checkedFiles.add(file);
        }
        if (result?.length && !wordType.find_all) {
            return result;
        }
        for (const info of result || []) {
            const lines = info.declarationlines.filter(line => {
                const key = `${info.file}:${line.line}:${line.column}`;
                if (seen.has(key)) {
                    return false;
                }
                seen.add(key);
                return true;
            });
            if (lines.length > 0) {
                results.push({...info, declarationlines: lines});
            }
        }
    }
    return results.length > 0 ? results : null;
}

export class LuxDefinitionProvider implements vscode.DefinitionProvider {
    private ctx: vscode.ExtensionContext;

    constructor(ctx: vscode.ExtensionContext) {
        this.ctx = ctx;
    }

    public provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Thenable<vscode.Location[]> {
        if (token.isCancellationRequested) {
            return Promise.resolve([]);
        }

        return definitionLocation(this.ctx,document, position, token).then(
            (defInfos) => {
                if (token.isCancellationRequested) {
                    return Promise.resolve([]);
                }
                if (defInfos == null || defInfos.length === 0) {
                    return [];
                }
                let locations = new Array<vscode.Location>()
                defInfos.forEach(defInfo => {
                    const definitionResource = vscode.Uri.file(defInfo.file);
                    defInfo.declarationlines.forEach((value) => {
                        const declarationline = value
                        try {
                            locations.push(
                                new vscode.Location(
                                    definitionResource,
                                    new vscode.Position(declarationline.line, declarationline.column)
                                )
                            )
                        } catch (error) {
                        }
                    });
                });
                return locations;
            },
            (err) => {
                vscode.window.showErrorMessage(err);
                return Promise.reject(err);
            }
        );
    }
}
