/// <reference path="../../node_modules/neutralinojs-types/index.d.ts" />

declare const NL_PROJECT_DIR: string

const NATIVE = (() => {
    const enabled = 'NL_VERSION' in window
    let initialized = false

    let loadingPromise = createExposedPromise<void>()
    
    if (enabled) {
        console.log('Detected Neutralino')
        Neutralino.init()
        Neutralino.events.on('ready', () => {
            initialized = true
            loadingPromise.resolve()
            console.log('Neutralino Initialized')
        })
    } else {
        console.log('Neutralino Not Detected')
    }

    function isEnabled() {
        return enabled
    }

    async function waitForInitialize() {
        if (!initialized) {
            await loadingPromise
        }
    }

    async function loadFile(path: string) {
        await waitForInitialize()
        const text = await Neutralino.filesystem.readFile(getProjectPath(path))
        return text
    }

    async function saveFile(path: string, content: string) {
        await waitForInitialize()
        await Neutralino.filesystem.writeFile(getProjectPath(path), content)
    }

    async function listFiles(path: string) {
        await waitForInitialize()
        const stats = await Neutralino.filesystem.readDirectory(getProjectPath(path))
        return stats.filter(s => s.type === 'FILE').map(s => s.entry)
    }

    async function listDirectories(path: string) {
        await waitForInitialize()
        const stats = await Neutralino.filesystem.readDirectory(getProjectPath(path))
        return stats.filter(s => s.type === 'DIRECTORY').map(s => s.entry).filter(s => !['..', '.'].includes(s))
    }

    async function close() {
        await waitForInitialize()
        await Neutralino.app.exit()
    }

    function getProjectPath(path: string) {
        return `${NL_PATH}/${NL_PROJECT_DIR}/${path.replaceAll('..', '')}`
    }
    
    return {
        isEnabled,
        waitForInitialize,
        loadFile,
        saveFile,
        listFiles,
        listDirectories,
        close,
    }
})()
