
const INTERFACE = (() => {
    let audioContext: AudioContext | null = null
    const characterElements: Partial<Record<string, HTMLElement>> = {}
    let textRevealPromise: ExposedPromise<void> | null = null
    let advancePromise: ExposedPromise<void> | null = null
    
    let viewState: Immutable<StoryViewState> = {
        definition: {
            characters: {},
            backdrops: {},
            sounds: {},
            passages: {},
            variables: {},
        },
        states: [],
        backdropID: null,
        characters: {},
        text: '',
        speaker: null,
    }
    
    function updateViewState(updater: (state: Immutable<StoryViewState>) => Immutable<StoryViewState>) {
        viewState = updater(viewState)
    }
    
    async function changeBackdrop(backdropID: string | null) {
        const backdropDef = backdropID ? viewState.definition.backdrops[backdropID] : null
        if (backdropDef === undefined) throw new Error(`There are no defined backdrops named '${backdropID}'!`)
    
        updateViewState(viewState => {
            return { ...viewState, backdropID: backdropID }   
        })
    
        const oldElement = backdrop
        const newElement = backdrop.cloneNode() as JSX.Element
        newElement.classList.add('hide')
        oldElement.parentNode?.insertBefore(newElement, oldElement.nextSibling)
        newElement.style.backgroundImage = backdropDef ? `url(${backdropDef.path})` : 'transparent'
    
        requestAnimationFrame(() => {
            oldElement.classList.add('hide')
            newElement.classList.remove('hide')
        })
    
        setTimeout(() => {
            oldElement.remove()
        }, 1000)
    }
    
    async function playSound(soundID: string) {
        const soundDef = viewState.definition.sounds[soundID]
        if (!soundDef) throw new Error(`There are no defined sounds named '${soundID}'!`)
        await playSoundRaw(soundDef.path, false)
    }
    
    async function addCharacter(characterID: string) {
        const characterDef = viewState.definition.characters[characterID]
        if (!characterDef) throw new Error(`There are no defined characters named '${characterID}'!`)
    
        const [outfitID, outfitDef] = Object.entries(characterDef.outfits)[0]
        if (!outfitDef) throw new Error(`There are no defined outfits for character named '${characterID}'!`)
    
        const [expressionID, expressionDef] = Object.entries(outfitDef.expressions)[0]
        if (!expressionDef) throw new Error(`There are no defined expressions for outfit named '${outfitID}' in character named '${characterID}'!`)
    
        updateViewState(viewState => {
            if (viewState.characters[characterID]) {
                return viewState
            }
            return {
                ...viewState,
                characters: {
                    ...viewState.characters,
                    [characterID]: {
                        outfit: outfitID,
                        expression: expressionID,
                    }
                }
            }
        })
    
        const element = <div className="character hide" />
        element.style.backgroundImage = `url(${expressionDef.path})`
        characterBounds.append(element)
        characterElements[characterID] = element
    
        requestAnimationFrame(() => {
            element.classList.remove('hide')
        })
    }
    
    async function changeCharacterOutfit(characterID: string, outfitID: string) {
        if (!viewState.characters[characterID]) {
            await addCharacter(characterID)
        }
    
        const characterState = viewState.characters[characterID]!
    
        const characterDef = viewState.definition.characters[characterID]!
        const outfitDef = characterDef.outfits[outfitID]
        
        if (!outfitDef) throw new Error(`There are no defined outfits named '${outfitID}' in character named '${characterID}'!`)
    
        const [expressionID, expressionDef] = characterState.expression in outfitDef.expressions ? [characterState.expression, outfitDef.expressions[characterState.expression]] : Object.entries(outfitDef.expressions)[0]
        if (!expressionDef) throw new Error(`There are no defined expressions for outfit named '${outfitID}' in character named '${characterID}'!`)
    
        updateViewState(viewState => {
            if (characterState.outfit === outfitID) {
                return viewState
            }
            return {
                ...viewState,
                characters: {
                    ...viewState.characters,
                    [characterID]: {
                        ...viewState.characters[characterID]!,
                        outfit: outfitID,
                        expression: expressionID,
                    }
                }
            }
        })
    
        const imgUrl = expressionDef.path
        await updateCharacterRaw(characterID, imgUrl)
    }
    
    async function changeCharacterExpression(characterID: string, expressionID: string) {
        if (!viewState.characters[characterID]) {
            await addCharacter(characterID)
        }
    
        const characterState = viewState.characters[characterID]!
        
        const characterDef = viewState.definition.characters[characterID]!
        const outfitDef = characterDef.outfits[characterState.outfit]!
        const expressionDef = outfitDef.expressions[expressionID]
        if (!expressionDef) throw new Error(`There are no defined expressions named '${expressionID}' for outfit named '${characterState.outfit}' in character named '${characterID}'!`)
    
        updateViewState(viewState => {
            if (characterState.expression === expressionID) {
                return viewState
            }
            return {
                ...viewState,
                characters: {
                    ...viewState.characters,
                    [characterID]: {
                        ...viewState.characters[characterID]!,
                        expression: expressionID,
                    }
                }
            }
        })
    
        const imgUrl = expressionDef.path
        await updateCharacterRaw(characterID, imgUrl)
    }
    
    async function updateCharacterRaw(characterID: string, imgUrl: string) {
        await new Promise<void>((resolve, reject) => {
            const img = new Image()
            img.onload = e => resolve()
            img.onerror = e => reject(e) 
            img.src = imgUrl
        })
    
        const oldElement = characterElements[characterID]!
        const newElement = oldElement.cloneNode() as JSX.Element
        newElement.classList.add('hide')
        oldElement.parentNode?.insertBefore(newElement, oldElement.nextSibling)
        newElement.style.backgroundImage = `url(${imgUrl})`
    
        characterElements[characterID] = newElement
    
        requestAnimationFrame(() => {
            oldElement.classList.add('hide')
            newElement.classList.remove('hide')
        })
    
        setTimeout(() => {
            oldElement.remove()
        }, 1000)
    }
    
    async function displayText(text: string, speaker: string | null) {
        updateViewState(viewState => {
            return {
                ...viewState,
                text,
                speaker,
            }
        })
    
        const skipPromise = createExposedPromise<void>()
        textRevealPromise = skipPromise
    
        nameplate.textContent = speaker
        dialogue.textContent = ''
        caret.classList.add('hide')
        
        const parts = text.split(/\b/g)
        for (const part of parts) {
            for (const char of part) {
                await Promise.any([skipPromise, waitForNextFrame()])
                const span = <span className="hide">{char}</span>
                dialogue.append(span)
                await Promise.any([skipPromise, waitForNextFrame()])
                span.classList.remove('hide')
                Promise.any([skipPromise, wait(1000)]).then(() => {
                    const textNode = document.createTextNode(char)
                    span.replaceWith(textNode)
                    textNode.parentElement?.normalize()
                })
                await Promise.any([skipPromise, wait(({
                    ' ': 16,
                    ',': 256,
                    '.': 512,
                    '?': 512,
                    '!': 512,
                    '\n': 512,
                })[char] ?? 32)])
            }
        }
        if (textRevealPromise === skipPromise) {
            textRevealPromise.resolve()
            textRevealPromise = null
            caret.classList.remove('hide')
        }
    }
    
    function clickAdvance(e: MouseEvent) {
        e.preventDefault()
        e.stopPropagation()
        playSoundRaw('./engine/assets/click.mp3', true)
        if (textRevealPromise) {
            textRevealPromise.resolve()
        } else if (advancePromise) {
            advancePromise.resolve()
        }
    }
    
    async function waitForAdvance() {
        const promise = createExposedPromise<void>()
        advancePromise = promise
        await promise
        if (advancePromise === promise)
            advancePromise = null
    }
    
    async function tryInitializeAudio() {
        if (!audioContext) {
            audioContext = new AudioContext()
        }
        if (audioContext.state !== 'running') {
            await audioContext.resume()
        }
    }

    const audioBufferCache: Record<string, AudioBuffer> = {}
    
    async function playSoundRaw(path: string, cache: boolean) {
        let audioData: AudioBuffer
        if (audioBufferCache[path]) {
            audioData = audioBufferCache[path]
        } else {
            const response = await fetch(path)
            const buffer = await response.arrayBuffer()
            await tryInitializeAudio()
            audioData = await audioContext!.decodeAudioData(buffer)
            if (cache) {
                audioBufferCache[path] = audioData
            }
        }
        const srcNode = new AudioBufferSourceNode(audioContext!, { buffer: audioData })
        const gainNode = new GainNode(audioContext!, { gain: 1 })
        srcNode.connect(gainNode)
        gainNode.connect(audioContext!.destination)
        srcNode.start()
    }

    requestAnimationFrame(() => {
        main.addEventListener('click', clickAdvance)
    })

    return {
        addCharacter,
        changeCharacterOutfit,
        changeCharacterExpression,
        changeBackdrop,
        playSound,
        displayText,
        waitForAdvance,
    }
})()
