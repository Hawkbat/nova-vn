declare function require(paths: string[], body: () => void)
declare namespace require {
    declare function config(config: any)
}