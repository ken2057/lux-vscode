
export interface Block {
    type: string;
    line: number;
    end_line?: number;
    col: number;
    file: string;
}

export interface BlockHasChildren extends Block {
    children: Block[];
}

export interface MacroBlock extends BlockHasChildren {
    type: "macro";
    name: string;
    args: string[];
    my_vars: MyVarBlock[];
}

export interface LoopBlock extends BlockHasChildren {
    type: "loop";
    var?: string;
    items?: string[];
    match_pattern?: string;
    my_vars: MyVarBlock[];
}

export interface ShellBlock extends Block {
    type: "shell";
    name: string;
    local_vars: LocalVarBlock[];
    fail_patterns: FailPattern[];
}

export interface NewShellBlock extends ShellBlock {
}

export interface CleanupBlock extends ShellBlock {
}

export interface VarBlock extends Block {
    name: string;
    value: string;
}
// Variable for all shell
export interface GlobalVarBlock extends VarBlock {
    type: "global_var";
}
// Variable for current shell
export interface LocalVarBlock extends VarBlock {
    type: "local_var";
}
// Variable only use in macro or loop scope
export interface MyVarBlock extends VarBlock {
    type: "my_var";
}

export interface IncludeBlock extends Block {
    type: "include";
    path: string;
    cachePath: string;
}

export interface FailPattern extends Block {
    type: "fail_pattern";
    pattern: string;
}

export interface InvokeBlock extends Block {
    type: "invoke";
    name: string;
    args: string[];
}

export interface Lux {
    macros: Map<string, MacroBlock>;
    includeCount: number;
    global_vars: GlobalVarBlock[];
    run: Block[];
}