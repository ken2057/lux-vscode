interface Block {
    line: number;
    col: number;
    chilren: Block[];
}

interface DocBlock extends Block {
    start: number;
    end?: number;
}

interface MacroBlock extends Block {
    name: string;
    args: string[];
}

interface LoopBlock extends Block {
    var: string;
    items: string[];
}

interface ShellBlock extends Block {
    name: string;
}

interface CleanupBlock extends ShellBlock {
}

interface VarBlock extends Block {
    name: string;
    type: "global" | "local" | "my";

}

interface IncludeBlock extends Block {
}