
const INTERPRETER = (() => {
    let currentProject: ProjectContext | null = null
    let currentStory: InterpreterStoryContext | null = null
    let currentAction: PassageAction | null = null

    async function runProject(project: ProjectContext) {
        currentProject = project
        await INTERFACE.loadStory(project)
        const story: InterpreterStoryContext = {
            history: [],
            state: {
                passageID: null,
                backdropID: null,
                characters: {},
                variables: {},
            },
        }
        currentStory = story
        const initialPassage = Object.values(project.definition.passages)[0]
        if (!initialPassage) {
            throw new InterpreterError(Object.values(project.files)[0]!, { row: 0, start: 0, end: 1 }, `This story contains no passage definitions! You must have at least one passage.`)
        }
        updateStoryState(story, s => ({
            ...s,
            passageID: initialPassage.id,
        }))
        await runPassage(project, story, initialPassage)
    }

    async function runPassage(project: ProjectContext, story: InterpreterStoryContext, passage: PassageDefinition) {
        await runActionList(project, story, passage.actions)
    }

    async function runActionList(project: ProjectContext, story: InterpreterStoryContext, actions: PassageAction[]) {
        for (let i = 0; i < actions.length; i++) {
            const action = actions[i]
            currentAction = action
            const actionMap: { [K in PassageActionType]: (action: PassageActionOfType<K>) => Promise<void> } = {
                continue: async a => {
                    const passages = Object.values(project.definition.passages)
                    const currentIndex = passages.findIndex(p => p?.id === story.state.passageID)
                    const nextPassage = passages[currentIndex + 1]
                    if (!nextPassage) {
                        throw new InterpreterError(project.files[a.range.file]!, a.range, `There is no passage after '${story.state.passageID}' to continue to!`)
                    }
                    pushState(story, nextPassage.id)
                    await runPassage(project, story, nextPassage)
                },
                goto: async a => {
                    const nextPassage = project.definition.passages[a.passageID]
                    if (!nextPassage) {
                        throw new InterpreterError(project.files[a.range.file]!, a.range, `There is no passage named '${a.passageID}' to go to!`)
                    }
                    pushState(story, nextPassage.id)
                    await runPassage(project, story, nextPassage)
                },
                end: async a => {
                    throw new InterpreterError(project.files[a.range.file]!, a.range, `End of story reached!`)
                },
                backdropChange: async a => {
                    const backdrop = project.definition.backdrops[a.backdropID]
                    if (!backdrop) throw new InterpreterError(project.files[a.range.file]!, a.range, `There are no defined backdrops named '${a.backdropID}'!`)
                    await INTERFACE.changeBackdrop(backdrop)
                },
                playSound: async a => {
                    const sound = project.definition.sounds[a.soundID]
                    if (!sound) throw new InterpreterError(project.files[a.range.file]!, a.range, `There are no defined sounds named '${a.soundID}'!`)
                    await INTERFACE.playSound(sound)
                },
                narration: async a => {
                    const text = resolveVariableValue(project, story, a.textRange, a.text, null, true)
                    if (!isVariableValueType(text, 'string')) {
                        throw new InterpreterError(project.files[a.range.file]!, a.textRange, `Narration actions must be given a text value but instead this was a '${getVariableValueType(text)}'`)
                    }
                    await INTERFACE.displayText(text.string, null)
                },
                option: async a => {
                    const options = [a]
                    while (actions[i + 1]?.type === 'option') {
                        options.push(actions[i + 1] as PassageActionOfType<'option'>)
                        i++
                    }
                    const choices: ChoiceOption[] = []
                    for (const o of options) {
                        const text = resolveVariableValue(project, story, o.textRange, o.text, null, true)
                        if (!isVariableValueType(text, 'string')) {
                            throw new InterpreterError(project.files[o.range.file]!, o.textRange, `Option actions must be given a text value but instead this was a '${getVariableValueType(text)}'`)
                        }
                        choices.push({
                            text: text.string,
                            onSelect: async () => await runActionList(project, story, o.actions),
                        })
                    }
                    await INTERFACE.presentChoice(choices)
                },
                characterEntry: async a => {
                    const character = project.definition.characters[a.characterID]
                    if (!character) throw new InterpreterError(project.files[a.range.file]!, a.range, `There are no defined characters named '${a.characterID}'!`)
                    const outfit = Object.values(character.outfits)[0]
                    if (!outfit) throw new InterpreterError(project.files[a.range.file]!, a.range, `There are no defined outfits for character named '${character.id}'!`)
                    const expression = Object.values(outfit.expressions)[0]
                    if (!expression) throw new InterpreterError(project.files[a.range.file]!, a.range, `There are no defined expressions for outfit named '${outfit.id}' in character named '${character.id}'!`)
                    await INTERFACE.addCharacter(character, outfit, expression, a.location)
                },
                characterExit: async a => {
                    const character = project.definition.characters[a.characterID]
                    if (!character) throw new InterpreterError(project.files[a.range.file]!, a.range, `There are no defined characters named '${a.characterID}'!`)
                    await INTERFACE.removeCharacter(character, a.location)
                },
                characterMove: async a => {
                    const character = project.definition.characters[a.characterID]
                    if (!character) throw new InterpreterError(project.files[a.range.file]!, a.range, `There are no defined characters named '${a.characterID}'!`)
                    await INTERFACE.moveCharacter(character, a.location)
                },
                characterSpeech: async a => {
                    const character = project.definition.characters[a.characterID]
                    if (!character) throw new InterpreterError(project.files[a.range.file]!, a.range, `There are no defined characters named '${a.characterID}'!`)
                    const text = resolveVariableValue(project, story, a.textRange, a.text, a.characterID, true)
                    if (!isVariableValueType(text, 'string')) {
                        throw new InterpreterError(project.files[a.range.file]!, a.textRange, `Character speech actions must be given a text value but instead this was a '${getVariableValueType(text)}'`)
                    }
                    await INTERFACE.displayText(text.string, character.name)
                },
                characterExpressionChange: async a => {
                    const character = project.definition.characters[a.characterID]
                    if (!character) throw new InterpreterError(project.files[a.range.file]!, a.range, `There are no defined characters named '${a.characterID}'!`)
                    const outfit = character.outfits[story.state.characters[a.characterID]?.outfitID ?? ''] ?? Object.values(character.outfits)[0]
                    if (!outfit) throw new InterpreterError(project.files[a.range.file]!, a.range, `There are no defined outfits in character named '${character.id}'!`)
                    const expression = outfit.expressions[a.expressionID]
                    if (!expression) throw new InterpreterError(project.files[a.range.file]!, a.range, `There are no defined expressions named '${a.expressionID}' for outfit named '${outfit.id}' in character named '${character.id}'!`)
                    await INTERFACE.changeCharacterSprite(character, outfit, expression)
                },
                characterOutfitChange: async a => {
                    const character = project.definition.characters[a.characterID]
                    if (!character) throw new InterpreterError(project.files[a.range.file]!, a.range, `There are no defined characters named '${a.characterID}'!`)
                    const outfit = character.outfits[a.outfitID]
                    if (!outfit) throw new InterpreterError(project.files[a.range.file]!, a.range, `There are no defined outfits named '${a.outfitID}' in character named '${character.id}'!`)
                    const expression = outfit.expressions[story.state.characters[a.characterID]?.expressionID ?? ''] ?? Object.values(outfit.expressions)[0]
                    if (!expression) throw new InterpreterError(project.files[a.range.file]!, a.range, `There are no defined expressions for outfit named '${outfit.id}' in character named '${character.id}'!`)
                    await INTERFACE.changeCharacterSprite(character, outfit, expression)
                },
                check: async a => {
                    const left = getVariableValue(project, story, a.range, a.variableID, a.characterID, false)
                    const right = resolveVariableValue(project, story, a.range, a.value, a.characterID, true)
                    let valid = false
                    let comparisonMap: Partial<Record<CheckComparisonType, () => boolean>> = {}
                    if (getVariableValueType(left) === getVariableValueType(right)) {
                        comparisonMap = {
                            ...comparisonMap,
                            '==': () => structuralEquality(left, right),
                            '!=': () => !structuralEquality(left, right),
                        }
                    }
                    if (isVariableValueType(left, 'number') && isVariableValueType(right, 'number')) {
                        comparisonMap = {
                            ...comparisonMap,
                            '<': () => left.number < right.number,
                            '<=': () => left.number <= right.number,
                            '>': () => left.number > right.number,
                            '>=': () => left.number >= right.number,
                        }
                    } else if (isVariableValueType(left, 'string') && isVariableValueType(right, 'string')) {
                        comparisonMap = {
                            ...comparisonMap,
                            'C': () => left.string.includes(right.string),
                            '!C': () => !left.string.includes(right.string),
                        }
                    } else if (isVariableValueType(left, 'list')) {
                        comparisonMap = {
                            ...comparisonMap,
                            'C': () => left.list.some(v => structuralEquality(v, right)),
                            '!C': () => !left.list.some(v => structuralEquality(v, right)),
                        }
                    } else if (isVariableValueType(left, 'map')) {
                        comparisonMap = {
                            ...comparisonMap,
                            'C': () => Object.values(left.map).some(v => structuralEquality(v, right)),
                            '!C': () => !Object.values(left.map).some(v => structuralEquality(v, right)),
                        }
                    }
                    const comparisonOp = comparisonMap[a.comparison]
                    if (comparisonOp) {
                        valid = comparisonOp()
                    } else {
                        throw new InterpreterError(project.files[a.range.file]!, a.range, `Variable '${a.variableID}' is a '${getVariableValueType(left)}', which cannot be compared with a '${getVariableValueType(right)}' in this way!`)
                    }
                    if (valid) {
                        await runActionList(project, story, a.actions)
                    }
                },
                varSet: async a => {
                    const left = getVariableValue(project, story, a.range, a.variableID, a.characterID, false)
                    const right = resolveVariableValue(project, story, a.range, a.value, a.characterID, true)
                    updateVariableValue(story, a.variableID, right, a.characterID)
                },
                varAdd: async a => {
                    const left = getVariableValue(project, story, a.range, a.variableID, a.characterID, false)
                    const right = resolveVariableValue(project, story, a.range, a.value, a.characterID, true)
                    if (isVariableValueType(left, 'number') && isVariableValueType(right, 'number')) {
                        updateVariableValue(story, a.variableID, { number: left.number + right.number }, a.characterID)
                    } else if (isVariableValueType(left, 'string') && isVariableValueType(right, 'string')) {
                        updateVariableValue(story, a.variableID, { string: left.string + right.string }, a.characterID)
                    } else if (isVariableValueType(left, 'list')) {
                        updateVariableValue(story, a.variableID, { list: [...left.list, right] }, a.characterID)
                    } else if (isVariableValueType(left, 'map')) {
                        if (!a.key) throw new InterpreterError(project.files[a.range.file]!, a.range, `Variable '${a.variableID}' is a 'map' variable, which means any additions to it must have a text key specified!`)
                        const key = resolveVariableValue(project, story, a.range, a.key, a.characterID, true)
                        if (!isVariableValueType(key, 'string')) throw new InterpreterError(project.files[a.range.file]!, a.range, `Variable '${a.variableID}' is a 'map' variable, which means any additions to it must have a text key specified, but the key value had type '${getVariableValueType(key)}' instead!`)
                        updateVariableValue(story, a.variableID, { map: { ...left.map, [key.string]: right } }, a.characterID)
                    } else {
                        throw new InterpreterError(project.files[a.range.file]!, a.range, `Variable '${a.variableID}' is a '${getVariableValueType(left)}', which cannot have a value of type '${getVariableValueType(right)}' added to it!`)
                    }
                },
                varSubtract: async a => {
                    const left = getVariableValue(project, story, a.range, a.variableID, a.characterID, false)
                    const right = resolveVariableValue(project, story, a.range, a.value, a.characterID, true)
                    if (isVariableValueType(left, 'number') && isVariableValueType(right, 'number')) {
                        updateVariableValue(story, a.variableID, { number: left.number - right.number }, a.characterID)
                    } else if (isVariableValueType(left, 'list')) {
                        updateVariableValue(story, a.variableID, { list: [...left.list, right] }, a.characterID)
                    } else if (isVariableValueType(left, 'map') && isVariableValueType(right, 'string')) {
                        const map = { ...left.map }
                        delete map[right.string]
                        updateVariableValue(story, a.variableID, { map }, a.characterID)
                    } else {
                        throw new InterpreterError(project.files[a.range.file]!, a.range, `Variable '${a.variableID}' is a '${getVariableValueType(left)}', which cannot have a value of type '${getVariableValueType(right)}' subtracted from it!`)
                    }
                },
            }
            const actionFunc = actionMap[action.type]
            if (actionFunc) {
                await actionFunc(action as any)
            } else {
                throw new InterpreterError(project.files[action.range.file]!, action.range, `The passage action type '${action.type}' is not yet supported!`)
            }
        }
    }

    function updateCharacterState(story: InterpreterStoryContext, characterID: string, updater: (existingValue: InterpreterCharacterState) => InterpreterCharacterState) {
        updateStoryState(story, s => ({
            ...s,
            characters: {
                ...s.characters,
                [characterID]: {
                    ...(updater((story.state.characters[characterID] ?? { expressionID: null, outfitID: null, location: 'default', variables: {} }) as InterpreterCharacterState)),
                },
            }
        }))
    }

    function updateStoryState(story: InterpreterStoryContext, updater: (existingValue: InterpreterStoryState) => InterpreterStoryState) {
        story.state = {
            ...updater(story.state as InterpreterStoryState)
        }
    }

    function updateVariableValue(story: InterpreterStoryContext, variableID: string, newValue: VariableValue, characterID: string | null) {
        if (characterID) {
            updateCharacterState(story, characterID, c => ({
                ...c,
                variables: {
                    ...c.variables,
                    [variableID]: newValue
                }
            })) 
        } else {
            updateStoryState(story, s => ({
                ...s,
                variables: {
                    ...s.variables,
                    [variableID]: newValue,
                }
            }))
        }
    }

    function getVariableValue(project: ProjectContext, story: InterpreterStoryContext, range: FileRange, variableID: string, characterID: string | null, allowGlobals: boolean): VariableValue {
        const rawValue = getVariableValueRaw(project, story, variableID, characterID, allowGlobals)
        if (!rawValue) {
            throw new InterpreterError(project.files[range.file]!, range, `No variable named '${variableID}' is defined!`)
        }
        const resolvedValue = resolveVariableValue(project, story, range, rawValue, characterID, allowGlobals)
        return resolvedValue
    }

    function resolveVariableValue(project: ProjectContext, story: InterpreterStoryContext, range: FileRange, value: VariableValue, characterID: string | null, allowGlobals: boolean): VariableValue {
        let unrollCount = 100
        while ((unrollCount--) > 0 && isVariableValueType(value, 'variable')) {
            const unrolledValue = getVariableValueRaw(project, story, value.variable, characterID, allowGlobals)
            if (!unrolledValue) {
                throw new InterpreterError(project.files[range.file]!, range, `No variable named '${value.variable}' is defined!`)
            }
            value = unrolledValue
        }
        if (isVariableValueType(value, 'string')) {
            const file = project.files[range.file]!
            const subTokens = file.tokens.filter(t => t.range.row === range.row && t.range.start > range.start && t.range.end < range.end)
            if (subTokens.length) {
                let resolvedValue = ''
                for (let i = range.start + 1; i < range.end - 1; i++) {
                    const subToken = subTokens.find(t => t.range.start === i)
                    if (subToken) {
                        if (subToken.type === 'variable') {
                            const value = getVariableValue(project, story, { file: file.path, ...subToken.range }, subToken.text, characterID, allowGlobals)
                            const str = printVariableValue(value)
                            resolvedValue += str
                            i = subToken.range.end - 1
                        } else {
                            throw new InterpreterError(file, subToken.range, `Cannot handle this kind of element within a text value: ${subToken.type}`)
                        }
                    } else {
                        resolvedValue += file.lines[range.row][i]
                    }
                }
                return { string: resolvedValue }
            }
        }
        return value
    }

    function getVariableValueRaw(project: ProjectContext, story: InterpreterStoryContext, variableID: string, characterID: string | null, allowGlobals: boolean): VariableValue | null {
        if (characterID) {
            const characterVariables = story.state.characters[characterID]?.variables
            if (characterVariables) {
                const characterVariable = characterVariables[variableID]
                if (characterVariable) {
                    return characterVariable as VariableValue
                }
            }
            const characterDef = project.definition.characters[characterID]
            if (characterDef) {
                const characterVariableDef = characterDef.variables[variableID]
                if (characterVariableDef) {
                    return characterVariableDef.initialValue
                }
            }
            const castVariableDef = project.definition.variables[variableID]
            if (castVariableDef && castVariableDef.scope === 'cast') {
                return castVariableDef.initialValue
            }
        }
        if (!characterID || allowGlobals) {
            const globalVariable = story.state.variables[variableID]
            if (globalVariable) {
                return globalVariable as VariableValue
            }
            const globalVariableDef = project.definition.variables[variableID]
            if (globalVariableDef && globalVariableDef.scope === 'global') {
                return globalVariableDef.initialValue
            }
        }
        return null
    }

    function isVariableValueType<T extends VariableValueType>(value: VariableValue, type: T): value is VariableValueOfType<T> {
        return getVariableValueType(value) === type
    }

    function getVariableValueType(value: VariableValue): VariableValueType {
        return Object.keys(value)[0] as VariableValueType
    }

    function getVariableJsonValue(value: VariableValue): any {
        return Object.values(value)[0]
    }

    function printVariableValue(value: VariableValue): string {
        if (isVariableValueType(value, 'string')) {
            return value.string
        } else if (isVariableValueType(value, 'number')) {
            return value.number.toString()
        } else if (isVariableValueType(value, 'boolean')) {
            return value.boolean ? 'Yes' : 'No'
        } else if (isVariableValueType(value, 'null')) {
            return 'Nothing'
        } else if (isVariableValueType(value, 'list')) {
            return value.list.length ? prettyJoin(value.list.map(v => printVariableValue(v)), 'and') : 'Nothing'
        } else if (isVariableValueType(value, 'map')) {
            return Object.keys(value.map).length ? prettyJoin(Object.entries(value.map).map(([k, v]) => `${printVariableValue(v)} as ${k}`), 'and') : 'Nothing'
        } else if (isVariableValueType(value, 'variable')) {
            return value.variable
        } else {
            return String(getVariableJsonValue(value))
        }
    }

    function structuralEquality(left: VariableValue, right: VariableValue): boolean {
        if (getVariableValueType(left) !== getVariableValueType(right)) return false
        if (isVariableValueType(left, 'list') && isVariableValueType(right, 'list')) {
            return left.list.length === right.list.length && left.list.every((a, i) => structuralEquality(a, right.list[i]))
        } else if (isVariableValueType(left, 'map') && isVariableValueType(right, 'map')) {
            return Object.keys(left.map).length === Object.keys(right.map).length && Object.keys(left.map).every(k => structuralEquality(left.map[k], right.map[k]))
        } else {
            return getVariableJsonValue(left) === getVariableJsonValue(right)
        }
    }

    function pushState(story: InterpreterStoryContext, newPassageID: string) {
        story.history = [...story.history, story.state]
        story.state = {
            ...story.state,
            passageID: newPassageID,
        }
    }

    function getCurrentProject() {
        return currentProject
    }

    function getCurrentStory() {
        return currentStory
    }

    function getCurrentAction() {
        return currentAction
    }

    return {
        runProject,
        getCurrentProject,
        getCurrentStory,
        getCurrentAction,
    }
})()
