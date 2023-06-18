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
        const text = await Neutralino.filesystem.readFile(`${NL_PATH}/${NL_PROJECT_DIR}/${path}`)
        return text
    }

    async function saveFile(path: string, content: string) {
        await waitForInitialize()
        await Neutralino.filesystem.writeFile(`${NL_PATH}/${NL_PROJECT_DIR}/${path}`, content)
    }
    
    return {
        isEnabled,
        waitForInitialize,
        loadFile,
        saveFile,
    }
})()
