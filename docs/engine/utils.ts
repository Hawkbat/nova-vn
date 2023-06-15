
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: { [A in keyof HTMLElementTagNameMap[K]]: HTMLElementTagNameMap[K][A] }, ...children: JSX.Element[]): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag)
    for (const key in props) e[key] = props[key]
    for (const child of children) {
        if (!child) continue
        if (Array.isArray(child)) e.append(...child)
        else e.append(child)
    }
    return e
}

function createExposedPromise<T>() {
    let externResolve: ExposedPromise<T>['resolve']
    let externReject: ExposedPromise<T>['reject']
    let promise: ExposedPromise<T> = new Promise<T>((resolve, reject) => {
        externResolve = resolve
        externReject = reject
    }) as ExposedPromise<T>
    promise.resolve = externResolve!
    promise.reject = externReject!
    return promise
}

function wait(ms: number) {
    return new Promise<void>((resolve) => {
        setTimeout(() => resolve(), ms)
    })
}

function waitForNextFrame() {
    return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

function tuple<T extends any[]>(...args: T) : T {
    return args
}

interface ExposedPromise<T> extends Promise<T> {
    resolve: (value: T | PromiseLike<T>) => void
    reject: (reason?: any) => void
}

type Immutable<T> =
    T extends Array<infer U> ? ReadonlyArray<U> :
    T extends Map<infer K, infer V> ? ReadonlyMap<K, V> :
    T extends Set<infer U> ? ReadonlySet<U> :
    Readonly<T>

declare module JSX {
    type Element = HTMLElementTagNameMap[keyof HTMLElementTagNameMap]
    type IntrinsicElementMap = { [K in keyof HTMLElementTagNameMap]: Partial<{ [A in keyof HTMLElementTagNameMap[K]]: HTMLElementTagNameMap[K][A] }> }
    interface IntrinsicElements extends IntrinsicElementMap { }
}
