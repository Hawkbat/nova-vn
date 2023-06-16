/// <reference path="../../node_modules/neutralinojs-types/index.d.ts" />

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
        await loadingPromise
    }
    
    return {
        isEnabled,
        waitForInitialize,
    }
})()
