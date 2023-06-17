
const INTERFACE = (() => {
    const BACKDROP_HIDE_DURATION = 1000
    const CHARACTER_HIDE_DURATION = 1000
    const CHARACTER_MOVE_DURATION = 1000
    const TEXT_HIDE_DURATION = 1000
    const CHOICE_HIDE_DURATION = 1000

    let audioContext: AudioContext | null = null
    const characterElements: Partial<Record<string, HTMLElement>> = {}
    let textRevealPromise: ExposedPromise<void> | null = null
    let advancePromise: ExposedPromise<void> | null = null

    async function reset() {
        changeBackdrop(null)
        for (const el of Object.values(characterElements)) {
            if (el) {
                el.remove()
            }
        }
        nameplate.textContent = ''
        dialogue.textContent = ''
        choiceList.innerHTML = ''
    }
    
    async function changeBackdrop(backdrop: BackdropDefinition | null) {
        const oldElement = currentBackdrop
        const newElement = currentBackdrop.cloneNode() as HTMLDivElement
        currentBackdrop = newElement
        oldElement.parentNode?.insertBefore(newElement, oldElement.nextSibling)
        newElement.style.backgroundImage = backdrop ? `url(${backdrop.path})` : 'transparent'
    
        setTimeout(() => {
            oldElement.remove()
        }, BACKDROP_HIDE_DURATION)
    }
    
    async function playSound(sound: SoundDefinition) {
        await playSoundRaw(sound.path, false)
    }
    
    async function addCharacter(character: CharacterDefinition, outfit: OutfitDefinition, expression: ExpressionDefinition, location: CharacterLocation) {    
        const element = <div className="character" />
        element.style.backgroundImage = `url(${expression.path})`
        characterBounds.append(element)
        characterElements[character.id] = element
    }

    async function removeCharacter(character: CharacterDefinition, location: CharacterLocation) {
        const element = characterElements[character.id]!
        element.classList.add('hide')
        await wait(CHARACTER_HIDE_DURATION)
        element.remove()
    }

    async function moveCharacter(character: CharacterDefinition, location: CharacterLocation) {
        await wait(CHARACTER_MOVE_DURATION)
    }
    
    async function changeCharacterSprite(character: CharacterDefinition, outfit: OutfitDefinition, expression: ExpressionDefinition) {        
        const imgUrl = expression.path

        await new Promise<void>((resolve, reject) => {
            const img = new Image()
            img.onload = e => resolve()
            img.onerror = e => reject(e) 
            img.src = imgUrl
        })
    
        const oldElement = characterElements[character.id]!
        const newElement = oldElement.cloneNode() as JSX.Element
        oldElement.parentNode?.insertBefore(newElement, oldElement.nextSibling)
        newElement.style.backgroundImage = `url(${imgUrl})`
    
        characterElements[character.id] = newElement
    
        oldElement.classList.add('hide')
    
        setTimeout(() => {
            oldElement.remove()
        }, CHARACTER_HIDE_DURATION)
    }
    
    async function displayText(text: string, speaker: string | null) {    
        const skipPromise = createExposedPromise<void>()
        textRevealPromise = skipPromise
    
        if (speaker) {
            nameplate.textContent = speaker
            nameplate.classList.remove('hide')
        } else {
            nameplate.classList.add('hide')
        }

        dialogue.textContent = ''
        caret.classList.add('hide')
        
        const parts = text.split(/\b/g)
        for (const part of parts) {
            for (const char of part) {
                await Promise.any([skipPromise, waitForNextFrame()])
                const span = <span>{char}</span>
                dialogue.append(span)
                Promise.any([skipPromise, wait(TEXT_HIDE_DURATION)]).then(() => {
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

        await INTERFACE.waitForAdvance()
    }

    async function presentChoice(options: ChoiceOption[]) {
        const promise = createExposedPromise<ChoiceOption>()

        caret.classList.add('hide')

        let choiceElements = options.map(o => <div className="choice" onclick={e => {
            e.preventDefault()
            e.stopPropagation()
            playSoundRaw('./engine/assets/click.mp3', true)
            promise.resolve(o)
        }}>{o.text}</div>)

        for (const el of choiceElements) {
            choiceList.append(el)
        }

        const chosenOption = await promise

        for (const el of choiceElements) {
            el.classList.add('hide')
        }
        setTimeout(() => {
            for (const el of choiceElements) {
                el.remove()
            }
        }, CHOICE_HIDE_DURATION)

        await chosenOption.onSelect()
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
        reset,
        addCharacter,
        removeCharacter,
        moveCharacter,
        changeCharacterSprite,
        changeBackdrop,
        playSound,
        displayText,
        presentChoice,
        waitForAdvance,
    }
})()
