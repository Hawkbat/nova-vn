/// <reference path="../../node_modules/neutralinojs-types/index.d.ts" />

const NATIVE = (() => {

    const enabled = 'NL_VERSION' in window

    let loadingPromise = createExposedPromise<void>()
    
    if (enabled) {
        console.log('Detected Neutralino')
        Neutralino.init()
        Neutralino.events.on('ready', () => {
            loadingPromise.resolve()
            console.log('Neutralino Initialized')
        })
    } else {
        console.log('Neutralino Not Detected')
    }

    function isEnabled() {
        return enabled
    }
    
    return {
        isEnabled,
    }
})()