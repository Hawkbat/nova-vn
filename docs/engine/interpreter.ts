
const INTERPRETER = (() => {
    let currentProject: ProjectContext | null = null
    let currentStory: InterpreterStoryContext | null = null
    let currentAction: PassageAction | null = null

    async function runProject(project: ProjectContext) {
        currentProject = project
        await INTERFACE.reset()
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
                    await INTERFACE.displayText(a.text, null)
                },
                option: async a => {
                    let options = [a]
                    while (actions[i + 1]?.type === 'option') {
                        options.push(actions[i + 1] as PassageActionOfType<'option'>)
                        i++
                    }
                    await INTERFACE.presentChoice(options.map(o => ({
                        text: o.text,
                        onSelect: async () => await runActionList(project, story, o.actions),
                    })))
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
                    await INTERFACE.displayText(a.text, project.definition.characters[a.characterID]?.name ?? null)
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
                    const left = getVariableValue(project, story, a.range, a.variableID, a.characterID)
                    const right = resolveVariableValue(project, story, a.range, a.value, a.characterID)
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
                    const left = getVariableValue(project, story, a.range, a.variableID, a.characterID)
                    const right = resolveVariableValue(project, story, a.range, a.value, a.characterID)
                    updateVariableValue(story, a.variableID, right, a.characterID)
                },
                varAdd: async a => {
                    const left = getVariableValue(project, story, a.range, a.variableID, a.characterID)
                    const right = resolveVariableValue(project, story, a.range, a.value, a.characterID)
                    if (isVariableValueType(left, 'number') && isVariableValueType(right, 'number')) {
                        updateVariableValue(story, a.variableID, { number: left.number + right.number }, a.characterID)
                    } else if (isVariableValueType(left, 'string') && isVariableValueType(right, 'string')) {
                        updateVariableValue(story, a.variableID, { string: left.string + right.string }, a.characterID)
                    } else if (isVariableValueType(left, 'list')) {
                        updateVariableValue(story, a.variableID, { list: [...left.list, right] }, a.characterID)
                    } else if (isVariableValueType(left, 'map')) {
                        if (!a.key) throw new InterpreterError(project.files[a.range.file]!, a.range, `Variable '${a.variableID}' is a 'map' variable, which means any additions to it must have a text key specified!`)
                        const key = resolveVariableValue(project, story, a.range, a.key, a.characterID)
                        if (!isVariableValueType(key, 'string')) throw new InterpreterError(project.files[a.range.file]!, a.range, `Variable '${a.variableID}' is a 'map' variable, which means any additions to it must have a text key specified, but the key value had type '${getVariableValueType(key)}' instead!`)
                        updateVariableValue(story, a.variableID, { map: { ...left.map, [key.string]: right } }, a.characterID)
                    } else {
                        throw new InterpreterError(project.files[a.range.file]!, a.range, `Variable '${a.variableID}' is a '${getVariableValueType(left)}', which cannot have a value of type '${getVariableValueType(right)}' added to it!`)
                    }
                },
                varSubtract: async a => {
                    const left = getVariableValue(project, story, a.range, a.variableID, a.characterID)
                    const right = resolveVariableValue(project, story, a.range, a.value, a.characterID)
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

    function getVariableValue(project: ProjectContext, story: InterpreterStoryContext, range: FileRange, variableID: string, characterID: string | null): VariableValue {
        const rawValue = getVariableValueRaw(project, story, variableID, characterID)
        if (!rawValue) {
            throw new InterpreterError(project.files[range.file]!, range, `No variable named '${variableID}' is defined!`)
        }
        const resolvedValue = resolveVariableValue(project, story, range, rawValue, characterID)
        return resolvedValue
    }

    function resolveVariableValue(project: ProjectContext, story: InterpreterStoryContext, range: FileRange, value: VariableValue, characterID: string | null): VariableValue {
        let unrollCount = 100
        while ((unrollCount--) > 0 && isVariableValueType(value, 'variable')) {
            const unrolledValue = getVariableValueRaw(project, story, value.variable, characterID)
            if (!unrolledValue) {
                throw new InterpreterError(project.files[range.file]!, range, `No variable named '${value.variable}' is defined!`)
            }
            value = unrolledValue
        }
        return value
    }

    function getVariableValueRaw(project: ProjectContext, story: InterpreterStoryContext, variableID: string, characterID: string | null): VariableValue | null {
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
        } else {
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

    function getVariableActualValue(value: VariableValue): any {
        return Object.values(value)[0]
    }

    function structuralEquality(left: VariableValue, right: VariableValue): boolean {
        if (getVariableValueType(left) !== getVariableValueType(right)) return false
        if (isVariableValueType(left, 'list') && isVariableValueType(right, 'list')) {
            return left.list.length === right.list.length && left.list.every((a, i) => structuralEquality(a, right.list[i]))
        } else if (isVariableValueType(left, 'map') && isVariableValueType(right, 'map')) {
            return Object.keys(left.map).length === Object.keys(right.map).length && Object.keys(left.map).every(k => structuralEquality(left.map[k], right.map[k]))
        } else {
            return getVariableActualValue(left) === getVariableActualValue(right)
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
