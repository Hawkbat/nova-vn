
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
        MARKUP.nameplate.textContent = ''
        MARKUP.dialogue.textContent = ''
        MARKUP.choiceList.innerHTML = ''
    }
    
    async function changeBackdrop(backdrop: BackdropDefinition | null) {
        const oldElement = MARKUP.currentBackdrop
        const newElement = MARKUP.currentBackdrop.cloneNode() as HTMLDivElement
        MARKUP.currentBackdrop = newElement
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
        MARKUP.characterBounds.append(element)
        characterElements[character.id] = element
        moveCharacterRaw(character.id, location)
    }

    async function removeCharacter(character: CharacterDefinition, location: CharacterLocation) {
        const element = characterElements[character.id]!
        element.classList.add('hide')
        moveCharacterRaw(character.id, location)
        await wait(CHARACTER_HIDE_DURATION)
        element.remove()
    }

    async function moveCharacter(character: CharacterDefinition, location: CharacterLocation) {
        moveCharacterRaw(character.id, location)
        await wait(CHARACTER_MOVE_DURATION)
    }

    function moveCharacterRaw(characterID: string, location: CharacterLocation) {
        const element = characterElements[characterID]!
        const percentage: number = {
            center: 0,
            left: -50,
            right: 50,
            default: safeFloatParse(element.style.left, 0),
        }[location]
        element.style.left = `${percentage}%`
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
            MARKUP.nameplate.textContent = speaker
            MARKUP.nameplate.classList.remove('hide')
        } else {
            MARKUP.nameplate.classList.add('hide')
        }

        MARKUP.dialogue.textContent = ''
        MARKUP.caret.classList.add('hide')
        
        const parts = text.split(/\b/g)
        for (const part of parts) {
            for (const char of part) {
                await Promise.any([skipPromise, waitForNextFrame()])
                const span = <span>{char}</span>
                MARKUP.dialogue.append(span)
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
            MARKUP.caret.classList.remove('hide')
        }

        await INTERFACE.waitForAdvance()
    }

    async function presentChoice(options: ChoiceOption[]) {
        const promise = createExposedPromise<ChoiceOption>()

        MARKUP.caret.classList.add('hide')

        let choiceElements = options.map(o => <div className="choice" onclick={e => {
            e.preventDefault()
            e.stopPropagation()
            playSoundRaw('./engine/assets/click.mp3', true)
            promise.resolve(o)
        }}>{o.text}</div>)

        for (const el of choiceElements) {
            MARKUP.choiceList.append(el)
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
        MARKUP.main.addEventListener('click', clickAdvance)

        window.addEventListener('keydown', e => {
            let isHandled = true
            if (e.key === 'Escape') {
                if (MONACO.isCodeEditorOpen()) {
                    MONACO.setCodeEditorOpen(false)
                } else {
                    MONACO.setCodeEditorOpen(true)
                    const project = INTERPRETER.getCurrentProject()
                    const story = INTERPRETER.getCurrentStory()
                    const action = INTERPRETER.getCurrentAction()
                    if (project && story && action) {
                        MONACO.loadFile(project, project.files[action.range.file]!, action.range)
                    }
                }
            } else {
                isHandled = false
            }
            if (isHandled) {
                e.preventDefault()
                e.stopPropagation()
            }
        })
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
