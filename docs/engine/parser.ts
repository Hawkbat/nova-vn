
const PARSER = (() => {
    // The default in OSX TextEdit and Windows Notepad; editors where it's configurable usually can just normalize on spaces or tabs
    const TABS_TO_SPACES = 8

    async function parseStory(projectPath: string, mainFilePath: string, fileLookup: (path: string) => Promise<string>) {
        const project: ProjectContext = {
            definition: {
                characters: {},
                backdrops: {},
                sounds: {},
                passages: {},
                variables: {},
            },
            path: projectPath,
            files: {},
        }
        await parseFile(project, mainFilePath, fileLookup)
        return project
    }

    async function parseFile(project: ProjectContext, path: string, fileLookup: (path: string) => Promise<string>) {
        const text = await fileLookup(path)
        const lines = text.split(/\r?\n/g)
        const file: FileContext = {
            path,
            lines,
            tokens: [],
            cursor: { row: 0, col: 0 },
            states: [],
            errors: [],
        }
        project.files[path] = file
        while (file.cursor.row < file.lines.length) {
            parseLine(project, file)
        }
        return file
    }

    function checkEndOfLine(file: FileContext, error: string) {
        if (!isOutOfBounds(file, file.cursor)) {
            const token = peekAny(file)
            throw new ParseError(file, token.range, `${error}, but this line has '${token.text}'.`)
        }
    }

    function parseKeywordSelect<T>(file: FileContext, optionMap: Record<string, (token: ParseToken) => T>, error: string) {
        const keywords = Object.keys(optionMap)
        for (const keyword of keywords) {
            const token = tryAdvance(file, peekKeyword(file, keyword))
            if (token) {
                return optionMap[keyword](token)
            }
        }
        const keywordList = keywords.map((v, i, a) => a.length && i === a.length - 1 ? `or '${v}'` : `'${v}'`).join(keywords.length > 2 ? ', ' : ' ')
        const token = peekAny(file)
        throw new ParseError(file, token.range, `${error} ${keywordList}, but this line has '${token.text}' instead.`)
    }

    function parseCharacterSubDefinition(project: ProjectContext, file: FileContext, character: CharacterDefinition, indent: number) {
        advance(file, peekKeyword(file, 'has'), `Character sub-definitions must start with 'has'`)
        parseKeywordSelect(file, {
            outfit: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file), `Outfit definitions must have a name that starts with a letter here`)
                const id = identifierToken.text
                if (character.outfits[id]) {
                    throw new ParseError(file, identifierToken.range, `Outfits names must be unique, but you already have a outfit named '${id}' defined elsewhere for this character.`)
                }
                character.outfits[id] = {
                    id,
                    expressions: {},
                }
                file.states.push({ indent, character, outfit: character.outfits[id] })
                checkEndOfLine(file, `Outfit definitions must not have anything here after the outfit name`)
            },
            variable: () => {
                parseVariableDefinition(project, file, 'character', character)
            },
        }, `Character sub-definitions must be an`)
    }

    function parseOutfitSubDefinition(project: ProjectContext, file: FileContext, character: CharacterDefinition, outfit: OutfitDefinition, indent: number) {
        advance(file, peekKeyword(file, 'with'), `Outfit sub-definitions must start with 'with'`)
        parseKeywordSelect(file, {
            expression: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file), `Expression definitions must have a name that starts with a letter here`)
                const id = identifierToken.text
                if (outfit.expressions[id]) {
                    throw new ParseError(file, identifierToken.range, `Expression names must be unique, but you already have an expression named '${id}' defined elsewhere for this outfit.`)
                }
                outfit.expressions[id] = {
                    id,
                    path: `${project.path}/characters/${character.id}/${outfit.id}/${id}.png`,
                }
                checkEndOfLine(file, `Expression definitions must not have anything here after the expression name`)
            }
        }, `Outfit sub-definitions must be an`)
    }

    function parseVariableDefinition(project: ProjectContext, file: FileContext, scope: VariableScope, character?: CharacterDefinition) {
        const scopeDisplay = scope.substring(0, 1).toUpperCase() + scope.substring(1)
        const varToken = advance(file, peekVariable(file), `${scopeDisplay} variable definitions must have a variable name that starts with the '$' symbol here`)
        tryAdvance(file, peekKeyword(file, 'which'))
        advance(file, peekKeyword(file, 'is'), `${scopeDisplay} variable definitions must have a default value here, starting with the word 'is'`)
        const valueToken = advance(file, peekVariableValue(file), `${scopeDisplay} variable definitions must have a default value specified here`)
        const id = varToken.text
        const value = processVariableValue(file, valueToken)
        const type = Object.keys(value)[0] as VariableValueType
        const parent = character ? character : project.definition
        if (parent.variables[id]) {
            throw new ParseError(file, varToken.range, `Variable names must be unique, but you already have a variable named '${id}' defined elsewhere.`)
        }
        parent.variables[varToken.text] = {
            id,
            initialValue: value,
            scope,
            characterID: character?.id,
            type,
        }
        checkEndOfLine(file, `${scopeDisplay} variable definitions must not have anything here after the default value`)
    }

    function parseDefinition(project: ProjectContext, file: FileContext, indent: number) {
        advance(file, peekKeyword(file, 'define'), `Lines must start with 'define'`)
        parseKeywordSelect(file, {
            'global variable': () => {
                parseVariableDefinition(project, file, 'global')
            },
            'cast variable': () => {
                parseVariableDefinition(project, file, 'cast')
            },
            character: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file), `Character definitions must have a name that starts with a letter here`)
                advance(file, peekKeyword(file, 'as'), `Character definitions must have a name here, starting with the word 'as', like 'as "Jane"'`)
                const nameToken = advance(file, peekString(file), `Character definitions must have a name here, contained in double-quotes, like 'as "Jane"'`)
                const id = identifierToken.text
                const name = processVariableValueOfType(file, nameToken, 'string', `Character names must be enclosed in double-quotes, like '"Jane"'`).string
                if (project.definition.characters[id]) {
                    throw new ParseError(file, identifierToken.range, `Character names must be unique, but you already have a character named '${id}' defined elsewhere.`)
                }
                project.definition.characters[id] = {
                    id,
                    name,
                    outfits: {},
                    variables: {},
                }
                file.states.push({ indent: indent, character: project.definition.characters[id] })
                checkEndOfLine(file, `Character definitions must not have anything here after the name`)
            },
            backdrop: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file), `Backdrop definitions must have a name that starts with a letter here`)
                const id = identifierToken.text
                let path = `${project.path}/backdrops/${id}.png`
                if (tryAdvance(file, peekKeyword(file, 'from'))) {
                    const filenameToken = advance(file, peekString(file), `Backdrop definitions must have a file path here, enclosed in double-quotes, like 'from "bg.jpg"'`)
                    const filename = processVariableValueOfType(file, filenameToken, 'string', `Backdrop file paths must be enclosed in double-quotes, like '"bg.jpg"'`).string
                    path = `${project.path}/backdrops/${filename}`
                }
                if (project.definition.backdrops[id]) {
                    throw new ParseError(file, identifierToken.range, `Passage names must be unique, but you already have a backdrop named '${id}' defined elsewhere.`)
                }
                project.definition.backdrops[id] = {
                    id,
                    path,
                }
                checkEndOfLine(file, `Backdrop definitions must not have anything here after the name`)
            },
            sound: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file), `Sound definitions must have a name that starts with a letter here`)
                const id = identifierToken.text
                let path = `${project.path}/sound/${id}.mp3`
                if (tryAdvance(file, peekKeyword(file, 'from'))) {
                    const filenameToken = advance(file, peekString(file), `Sound definitions must have a file path here, enclosed in double-quotes, like 'from "snd.wav"'`)
                    const filename = processVariableValueOfType(file, filenameToken, 'string', `Sound file paths must be enclosed in double-quotes, like '"snd.wav"'`).string
                    path = `${project.path}/sounds/${filename}`
                }
                if (project.definition.sounds[id]) {
                    throw new ParseError(file, identifierToken.range, `Sound names must be unique, but you already have a sound named '${id}' defined elsewhere.`)
                }
                project.definition.sounds[id] = {
                    id,
                    path,
                }
                checkEndOfLine(file, `Sound definitions must not have anything here after the name`)
            },
            passage: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file), `Passage definitions must have a name that starts with a letter here`)
                const id = identifierToken.text
                if (project.definition.passages[id]) {
                    throw new ParseError(file, identifierToken.range, `Passage names must be unique, but you already have a passage named '${id}' defined elsewhere.`)
                }
                project.definition.passages[id] = {
                    id,
                    actions: [],
                }
                file.states.push({ indent: indent, passage: project.definition.passages[id] })
                checkEndOfLine(file, `Passage definitions must not have anything here after the name`)
            },
        }, `Definitions must be a`)
    }

    function parsePassageAction(project: ProjectContext, file: FileContext, passage: PassageDefinition, parent: PassageActionContainer, indent: number) {
        const identifierToken = peekAnyIdentifier(file)
        if (identifierToken && project.definition.characters[identifierToken.text]) {
            advance(file, identifierToken, '')
            const character = project.definition.characters[identifierToken.text]!
            const characterID = character.id
            const optionMap: Record<string, (token: ParseToken) => void> = {
                enter: t => {
                    let location: CharacterLocation = 'default'
                    if (tryAdvance(file, peekKeyword(file, 'from'))) {
                        location = parseKeywordSelect(file, {
                            left: () => 'left',
                            right: () => 'right',
                            center: () => 'center',
                        }, `Character entry location must be`)
                        checkEndOfLine(file, `Character entry actions must not have anything here after the location`)
                    } else {
                        checkEndOfLine(file, `Character entry actions must not have anything here after the action name unless it's the word 'from' and a location, like 'from left'`)
                    }
                    parent.actions.push({ type: 'characterEntry', range: getFileRange(file, t), characterID, location })
                },
                enters: t => optionMap.enter(t),
                exit: t => {
                    let location: CharacterLocation = 'default'
                    if (tryAdvance(file, peekKeyword(file, 'to'))) {
                        location = parseKeywordSelect(file, {
                            left: () => 'left',
                            right: () => 'right',
                            center: () => 'center',
                        }, `Character exit location must be`)
                        checkEndOfLine(file, `Character exit actions must not have anything here after the location`)
                    } else {
                        checkEndOfLine(file, `Character exit actions must not have anything here after the action name unless it's the word 'to' and a location, like 'to left'`)
                    }
                    parent.actions.push({ type: 'characterExit', range: getFileRange(file, t), characterID, location })
                },
                exits: t => optionMap.exit(t),
                move: t => {
                    tryAdvance(file, peekKeyword(file, 'to'))
                    const location: CharacterLocation = parseKeywordSelect(file, {
                        left: () => 'left',
                        right: () => 'right',
                        center: () => 'center',
                    }, `Character movement location must be`)
                    checkEndOfLine(file, `Character movement actions must not have anything here after the location`)
                    parent.actions.push({ type: 'characterMove', range: getFileRange(file, t), characterID, location })
                },
                moves: t => optionMap.move(t),
                say: t => {
                    const text = processVariableValueOfType(file, advance(file, peekString(file), `Character speech actions must have the text to display here, enclosed in double-quotes, like '"Hello!"'`), 'string', `Character speech action text must be enclosed in double-quotes, like '"Hello!"'`).string
                    checkEndOfLine(file, `Character speech actions must not have anything here after the speech text`)
                    parent.actions.push({ type: 'characterSpeech', range: getFileRange(file, t), characterID, text })
                },
                says: t => optionMap.say(t),
                emote: t => {
                    const identifierToken = advance(file, peekAnyIdentifier(file), `Character expression change actions must have an expression name here`)
                    const expression = Object.values(character.outfits).flatMap(o => Object.values(o?.expressions ?? [])).find(e => e?.id === identifierToken.text)
                    if (!expression) {
                        throw new ParseError(file, identifierToken.range, `Character expression change actions must have a defined expression name here`)
                    }
                    checkEndOfLine(file, `Character expression change actions must not have anything here after the expression name`)
                    parent.actions.push({ type: 'characterExpressionChange', range: getFileRange(file, t), characterID, expressionID: expression.id })
                },
                emotes: t => optionMap.emote(t),
                wear: t => {
                    const identifierToken = advance(file, peekAnyIdentifier(file), `Character outfit change actions must have an expression name here`)
                    const outfit = Object.values(character.outfits).find(o => o?.id === identifierToken.text)
                    if (!outfit) {
                        throw new ParseError(file, identifierToken.range, `Character outfit change actions must have a defined outfit name here`)
                    }
                    checkEndOfLine(file, `Character outfit change actions must not have anything here after the outfit name`)
                    parent.actions.push({ type: 'characterOutfitChange', range: getFileRange(file, t), characterID, outfitID: outfit.id })
                },
                wears: t => optionMap.wear(t),
                check: t => {
                    advance(file, peekKeyword(file, 'if'), `Character check actions must start with the word 'if' here`)
                    const variableToken = advance(file, peekVariable(file), `Character check actions must have a variable name that starts with the '$' symbol here`)
                    const variableID = variableToken.text
                    const variable = character.variables[variableID] ?? project.definition.variables[variableID]
                    if (!variable || variable.scope === 'global') {
                        throw new ParseError(file, variableToken.range, `Character check actions must have a defined character or cast variable name here`)
                    }
                    const comparison = parseComparison(file, `Character check actions must have a comparison here that is`)
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Character check actions must have a value specified here to compare against`))
                    checkEndOfLine(file, `Character check actions must not have anything here after the value`)
                    const checkAction: PassageActionOfType<'check'> = { type: 'check', range: getFileRange(file, t), variableID, comparison, value, actions: [], characterID }
                    parent.actions.push(checkAction)
                    file.states.push({ indent, passage, actionContainer: checkAction })
                },
                checks: t => optionMap.check(t),
                set: t => {
                    const variableToken = advance(file, peekVariable(file), `Character set actions must have a global variable name that starts with the '$' symbol here`)
                    const variableID = variableToken.text
                    const variable = character.variables[variableID] ?? project.definition.variables[variableID]
                    if (!variable || variable.scope === 'global') {
                        throw new ParseError(file, variableToken.range, `Character set actions must have a defined global variable name here`)
                    }
                    advance(file, peekKeyword(file, 'to'), `Character set actions must have the word 'to' here`)
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Character set actions must have a value specified here to store in the variable`))
                    checkEndOfLine(file, `Character set actions must not have anything here after the value`)
                    parent.actions.push({ type: 'varSet', range: getFileRange(file, t), variableID, value, characterID })
                },
                sets: t => optionMap.set(t),
                add: t => {
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Character add actions must have a value specified here to add to the variable`))
                    advance(file, peekKeyword(file, 'to'), `Character add actions must have the word 'to' here`)
                    const variableToken = advance(file, peekVariable(file), `Character add actions must have a global variable name that starts with the '$' symbol here`)
                    const variableID = variableToken.text
                    const variable = character.variables[variableID] ?? project.definition.variables[variableID]
                    if (!variable || variable.scope === 'global') {
                        throw new ParseError(file, variableToken.range, `Character add actions must have a defined global variable name here`)
                    }
                    let key: VariableValue | undefined = undefined
                    if (variable.type === 'map') {
                        advance(file, peekKeyword(file, 'as'), `Character add actions for map variables must have a key name here after the word 'as', like 'as "foo"'`)
                        key = processVariableValue(file, advance(file, peekVariableValue(file), `Character add actions must have a key name here after the word 'as', like 'as "foo"'`))
                    }
                    checkEndOfLine(file, `Character add actions must not have anything here after the value`)
                    parent.actions.push({ type: 'varAdd', range: getFileRange(file, t), variableID, value, key, characterID })
                },
                adds: t => optionMap.add(t),
                subtract: t => {
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Character subtract actions must have a value specified here to subtract from the variable`))
                    advance(file, peekKeyword(file, 'from'), `Character subtract actions must have the word 'form' here`)
                    const variableToken = advance(file, peekVariable(file), `Character subtract actions must have a global variable name that starts with the '$' symbol here`)
                    const variableID = variableToken.text
                    const variable = character.variables[variableID] ?? project.definition.variables[variableID]
                    if (!variable || variable.scope === 'global') {
                        throw new ParseError(file, variableToken.range, `Character subtract actions must have a defined global variable name here`)
                    }
                    checkEndOfLine(file, `Character subtract actions must not have anything here after the value`)
                    parent.actions.push({ type: 'varSubtract', range: getFileRange(file, t), variableID, value, characterID })
                },
                subtracts: t => optionMap.subtract(t),
            }
            parseKeywordSelect(file, optionMap, `Character actions must be`)
        } else {
            parseKeywordSelect(file, {
                continue: t => {
                    checkEndOfLine(file, `Continuation options must not have anything here after 'continue'`)
                    parent.actions.push({ type: 'continue', range: getFileRange(file, t) })
                },
                'go to': t => {
                    const identifierToken = advance(file, peekAnyIdentifier(file), `Go-To actions must have a passage name here`)
                    const passageID = identifierToken.text
                    // Target passages are typically going to be defined later in the file, so don't try to resolve them immediately
                    if (false) {
                        const passage = project.definition.passages[passageID]
                        if (!passage) {
                            throw new ParseError(file, identifierToken.range, `Go-To actions must have a defined passage name here`)
                        }
                    }
                    checkEndOfLine(file, `Go-To actions must not have anything here after the passage name`)
                    parent.actions.push({ type: 'goto', range: getFileRange(file, t), passageID })
                },
                end: t => {
                    checkEndOfLine(file, `Ending options must not have anything here after 'end'`)
                    parent.actions.push({ type: 'end', range: getFileRange(file, t) })
                },
                display: t => {
                    const identifierToken = advance(file, peekAnyIdentifier(file), `Display actions must have a backdrop name here`)
                    const backdrop = project.definition.backdrops[identifierToken.text]
                    if (!backdrop) {
                        throw new ParseError(file, identifierToken.range, `Display actions must have a defined backdrop name here`)
                    }
                    checkEndOfLine(file, `Display actions must not have anything here after the backdrop name`)
                    parent.actions.push({ type: 'backdropChange', range: getFileRange(file, t), backdropID: backdrop.id })
                },
                play: t => {
                    const identifierToken = advance(file, peekAnyIdentifier(file), `Play Sound actions must have a sound name here`)
                    const sound = project.definition.sounds[identifierToken.text]
                    if (!sound) {
                        throw new ParseError(file, identifierToken.range, `Play Sound actions must have a defined sound name here`)
                    }
                    checkEndOfLine(file, `Play Sound actions must not have anything here after the sound name`)
                    parent.actions.push({ type: 'playSound', range: getFileRange(file, t), soundID: sound.id })
                },
                narrate: t => {
                    const text = processVariableValueOfType(file, advance(file, peekString(file), `Narration actions must have the text to display here, enclosed in double-quotes, like '"Hello!"'`), 'string', `Narration text must be enclosed in double-quotes, like '"Hello!"'`).string
                    checkEndOfLine(file, `Narration actions must not have anything here after the narration text`)
                    parent.actions.push({ type: 'narration', range: getFileRange(file, t), text })
                },
                option: t => {
                    const text = processVariableValueOfType(file, advance(file, peekString(file), `Passage options must have the text to display here, enclosed in double-quotes, like '"Pick Me"'`), 'string', `Passage option text must be enclosed in double-quotes, like '"Pick Me"'`).string
                    checkEndOfLine(file, `Passage options must not have anything here after the option text`)
                    const optionDefinition: PassageActionOfType<'option'> = { type: 'option', range: getFileRange(file, t), text, actions: [] }
                    parent.actions.push(optionDefinition)
                    file.states.push({ indent, passage, actionContainer: optionDefinition })
                },
                check: t => {
                    advance(file, peekKeyword(file, 'if'), `Check actions must start with the word 'if' here`)
                    const variableToken = advance(file, peekVariable(file), `Check actions must have a global variable name that starts with the '$' symbol here`)
                    const variableID = variableToken.text
                    const variable = project.definition.variables[variableID]
                    if (!variable || variable.scope !== 'global') {
                        throw new ParseError(file, variableToken.range, `Check actions must have a defined global variable name here`)
                    }
                    const comparison = parseComparison(file, `Check actions must have a comparison here that is`)
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Check actions must have a value specified here to compare against`))
                    checkEndOfLine(file, `Check actions must not have anything here after the value`)
                    const checkAction: PassageActionOfType<'check'> = { type: 'check', range: getFileRange(file, t), variableID, comparison, value, actions: [], characterID: null }
                    parent.actions.push(checkAction)
                    file.states.push({ indent, passage, actionContainer: checkAction })
                },
                set: t => {
                    const variableToken = advance(file, peekVariable(file), `Set actions must have a global variable name that starts with the '$' symbol here`)
                    const variableID = variableToken.text
                    const variable = project.definition.variables[variableID]
                    if (!variable || variable.scope !== 'global') {
                        throw new ParseError(file, variableToken.range, `Set actions must have a defined global variable name here`)
                    }
                    advance(file, peekKeyword(file, 'to'), `Set actions must have the word 'to' here`)
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Set actions must have a value specified here to store in the variable`))
                    checkEndOfLine(file, `Set actions must not have anything here after the value`)
                    parent.actions.push({ type: 'varSet', range: getFileRange(file, t), variableID, value, characterID: null })
                },
                add: t => {
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Add actions must have a value specified here to add to the variable`))
                    advance(file, peekKeyword(file, 'to'), `Add actions must have the word 'to' here`)
                    const variableToken = advance(file, peekVariable(file), `Add actions must have a global variable name that starts with the '$' symbol here`)
                    const variableID = variableToken.text
                    const variable = project.definition.variables[variableID]
                    if (!variable || variable.scope !== 'global') {
                        throw new ParseError(file, variableToken.range, `Add actions must have a defined global variable name here`)
                    }
                    let key: VariableValue | undefined = undefined
                    if (variable.type === 'map') {
                        advance(file, peekKeyword(file, 'as'), `Add actions for map variables must have a key name here after the word 'as', like 'as "foo"'`)
                        key = processVariableValue(file, advance(file, peekVariableValue(file), `Add actions must have a key name here after the word 'as', like 'as "foo"'`))
                    }
                    checkEndOfLine(file, `Add actions must not have anything here after the value`)
                    parent.actions.push({ type: 'varAdd', range: getFileRange(file, t), variableID, value, characterID: null })
                },
                subtract: t => {
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Subtract actions must have a value specified here to subtract from the variable`))
                    advance(file, peekKeyword(file, 'from'), `Subtract actions must have the word 'from' here`)
                    const variableToken = advance(file, peekVariable(file), `Subtract actions must have a global variable name that starts with the '$' symbol here`)
                    const variableID = variableToken.text
                    const variable = project.definition.variables[variableID]
                    if (!variable || variable.scope !== 'global') {
                        throw new ParseError(file, variableToken.range, `Subtract actions must have a defined global variable name here`)
                    }
                    checkEndOfLine(file, `Subtract actions must not have anything here after the value`)
                    parent.actions.push({ type: 'varSubtract', range: getFileRange(file, t), variableID, value, characterID: null })
                },
            }, `Passage actions must start with a defined character's name or be`)
        }
    }

    function parseComparison(file: FileContext, error: string) {
        const comparison: CheckComparisonType = parseKeywordSelect<CheckComparisonType>(file, {
            'is not less than or equal to': () => '>',
            'is less than or equal to': () => '<=',
            'is not less than': () => '>=',
            'is less than': () => '<',
            'is not greater than or equal to': () => '<',
            'is greater than or equal to': () => '>=',
            'is not greater than': () => '<=',
            'is greater than': () => '>',
            'is not': () => '!=',
            'is': () => '==',
            'does not contain': () => '!C',
            'contains': () => 'C',
        }, error)
        return comparison
    }

    function parseLine(project: ProjectContext, file: FileContext) {
        if (!file.lines[file.cursor.row].trim().length) {
            file.cursor.row++
            file.cursor.col = 0
            return
        }
        const indent = parseNextIndent(file)
        while (file.states.length && indent <= file.states[file.states.length - 1].indent) {
            file.states.pop()
        }
        const currentState = file.states.length ? file.states[file.states.length - 1] : null
        try {
            if (currentState?.actionContainer && currentState.passage) {
                parsePassageAction(project, file, currentState.passage, currentState.actionContainer, indent)
            } else if (currentState?.passage) {
                parsePassageAction(project, file, currentState.passage, currentState.passage, indent)
            } else if (currentState?.character && !currentState.outfit) {
                parseCharacterSubDefinition(project, file, currentState.character, indent)
            } else if (currentState?.outfit && currentState.character) {
                parseOutfitSubDefinition(project, file, currentState.character, currentState.outfit, indent)
            } else {
                parseDefinition(project, file, indent)
            }
        } catch (e) {
            if (e instanceof ParseError) {
                file.errors.push(e)
            } else {
                throw e
            }
        }
        file.cursor.row++
        file.cursor.col = 0
    }

    function getCharAt(file: FileContext, cursor: ParsePointer) {
        return file.lines[cursor.row][cursor.col]
    }

    function isChar(file: FileContext, cursor: ParsePointer, char: string) {
        if (isOutOfBounds(file, cursor)) return false
        return getCharAt(file, cursor) === char
    }

    function isOutOfBounds(file: FileContext, cursor: ParsePointer) {
        return cursor.row < 0 || cursor.row >= file.lines.length || cursor.col < 0 || cursor.col >= file.lines[cursor.row].length
    }

    function isWhitespace(file: FileContext, cursor: ParsePointer) {
        if (isOutOfBounds(file, cursor)) return false
        const s = getCharAt(file, cursor)
        return s === ' ' || s === '\t'
    }

    function isAlpha(file: FileContext, cursor: ParsePointer) {
        if (isOutOfBounds(file, cursor)) return false
        const s = getCharAt(file, cursor)
        return (s >= 'a' && s <= 'z') || (s >= 'A' && s <= 'Z')
    }

    function isNumeric(file: FileContext, cursor: ParsePointer) {
        if (isOutOfBounds(file, cursor)) return false
        const s = getCharAt(file, cursor)
        return (s >= '0' && s <= '9')
    }

    function isIdentifierChar(file: FileContext, cursor: ParsePointer) {
        return isAlpha(file, cursor) || isNumeric(file, cursor) || isChar(file, cursor, '_')
    }

    // If the left-hand side of the character at this position is a word boundary
    function isWordBoundary(file: FileContext, cursor: ParsePointer) {
        if (isOutOfBounds(file, cursor)) return true
        const previousCursor: ParsePointer = { row: cursor.row, col: cursor.col - 1 }

        if (isOutOfBounds(file, previousCursor)) return true
        if (isIdentifierChar(file, cursor) && !isIdentifierChar(file, previousCursor)) return true
        if (!isIdentifierChar(file, cursor) && isIdentifierChar(file, previousCursor)) return true
        return false
    }

    function isWord(file: FileContext, cursor: ParsePointer, word: string) {
        if (!isWordBoundary(file, cursor)) return false
        if (!isWordBoundary(file, { row: cursor.row, col: cursor.col + word.length })) return false
        for (let i = 0; i < word.length; i++) {
            if (isOutOfBounds(file, { row: cursor.row, col: cursor.col + i })) return false
            if (!isChar(file, { row: cursor.row, col: cursor.col + i }, word[i])) return false
        }
        return true
    }

    function readRange(file: FileContext, range: ParseRange) {
        return file.lines[range.row].slice(range.start, range.end)
    }

    function parseNextIndent(file: FileContext) {
        let indent = 0
        while (!isOutOfBounds(file, file.cursor)) {
            const s = getCharAt(file, file.cursor)
            if (s === ' ') indent++
            else if (s === '\t') indent += TABS_TO_SPACES
            else break
            file.cursor.col++
        }
        return indent
    }

    function parseNextWhitespace(file: FileContext) {
        while (isWhitespace(file, file.cursor)) {
            file.cursor.col++
        }
        return
    }

    function parseToken(file: FileContext, type: ParseTokenType, row: number, start: number, end: number) {
        const range: ParseRange = { row, start, end }
        const token: ParseToken = { type, range, text: readRange(file, range) }
        return token
    }

    function peek(file: FileContext, type: ParseTokenType, length: number) {
        const token = parseToken(file, type, file.cursor.row, file.cursor.col, file.cursor.col + length)
        return token
    }

    function peekAny(file: FileContext) {
        const valueToken = peekVariableValue(file)
        if (valueToken) return valueToken
        if (isIdentifierChar(file, file.cursor) && isWordBoundary(file, file.cursor)) {
            const cursor = { ...file.cursor }
            do {
                cursor.col++
            }
            while (!isWordBoundary(file, cursor))
            return peek(file, 'identifier', cursor.col - file.cursor.col)
        } else {
            return peek(file, 'unknown', 1)
        }
    }

    function advance(file: FileContext, token: ParseToken | null | undefined, error: string) {
        if (!token) {
            const token = peekAny(file)
            throw new ParseError(file, token.range, `${error}, but this line has '${token.text}' instead.`)
        }
        file.tokens.push(token)
        file.cursor.col = token.range.end
        parseNextWhitespace(file)
        return token
    }

    function tryAdvance(file: FileContext, token: ParseToken | null | undefined) {
        if (!token) return null
        return advance(file, token, '')
    }

    function peekKeyword(file: FileContext, keyword: string) {
        if (isWord(file, file.cursor, keyword)) {
            return peek(file, 'keyword', keyword.length)
        }
        return null
    }

    function peekIdentifier(file: FileContext, identifier: string) {
        if (isWord(file, file.cursor, identifier)) {
            return peek(file, 'identifier', identifier.length)
        }
        return null
    }

    function peekAnyIdentifier(file: FileContext) {
        if (isIdentifierChar(file, file.cursor) && isWordBoundary(file, file.cursor)) {
            let cursor: ParsePointer = { row: file.cursor.row, col: file.cursor.col + 1 }
            while (isIdentifierChar(file, cursor)) {
                cursor.col++
            }
            const token = peek(file, 'identifier', cursor.col - file.cursor.col)
            return token
        }
        return null
    }

    function peekVariable(file: FileContext) {
        if (isChar(file, file.cursor, '$')) {
            let cursor: ParsePointer = { row: file.cursor.row, col: file.cursor.col + 1 }
            while (isIdentifierChar(file, cursor)) {
                cursor.col++
            }
            const token = peek(file, 'variable', cursor.col - file.cursor.col)
            return token
        }
        return null
    }

    function peekNumber(file: FileContext) {
        if (isNumeric(file, file.cursor)) {
            let cursor: ParsePointer = { row: file.cursor.row, col: file.cursor.col + 1 }
            while (isNumeric(file, cursor)) {
                cursor.col++
            }
            if (isChar(file, cursor, '.')) {
                cursor.col++
                while (isNumeric(file, cursor)) {
                    cursor.col++
                }
            }
            const token = peek(file, 'number', cursor.col - file.cursor.col)
            return token
        }
        return null
    }

    function peekString(file: FileContext) {
        if (isChar(file, file.cursor, '"')) {
            let cursor: ParsePointer = { row: file.cursor.row, col: file.cursor.col + 1 }
            while (!isChar(file, cursor, '"') && !isOutOfBounds(file, cursor)) {
                cursor.col++
            }
            if (isChar(file, cursor, '"')) {
                cursor.col++
            }
            const token = peek(file, 'string', cursor.col - file.cursor.col)
            return token
        }
        return null
    }

    function peekVariableValue(file: FileContext) {
        return peekVariable(file) ?? peekNumber(file) ?? peekString(file) ?? peekIdentifier(file, 'a list') ?? peekIdentifier(file, 'a map') ?? peekIdentifier(file, 'yes') ?? peekIdentifier(file, 'no') ?? peekIdentifier(file, 'nothing') ?? null
    }

    function processVariableValue(file: FileContext, token: ParseToken): VariableValue {
        if (token.type === 'string') return { string: JSON.parse(token.text) }
        else if (token.type === 'number') return { number: JSON.parse(token.text) }
        else if (token.type === 'variable') return { variable: token.text }
        else if (token.type === 'identifier') {
            if (token.text === 'yes') return { boolean: true }
            else if (token.text === 'no') return { boolean: false }
            else if (token.text === 'nothing') return { null: null }
            else if (token.text === 'a list') return { list: [] }
            else if (token.text === 'a map') return { map: {} }
        }
        throw new ParseError(file, token.range, `Could not determine the value of this expression: '${token.text}'`)
    }

    function processVariableValueOfType<T extends VariableValueType>(file: FileContext, token: ParseToken, type: T, error: string): VariableValueOfType<T> {
        const value = processVariableValue(file, token)
        const actualType = Object.keys(value)[0]
        if (actualType !== type) {
            throw new ParseError(file, token.range, `${error}, but this line has '${token.text}'.`)
        }
        return value as VariableValueOfType<T>
    }

    function getFileRange(file: FileContext, token: ParseToken): FileRange {
        return { file: file.path, row: token.range.row, start: token.range.start, end: token.range.end }
    }

    return {
        parseStory,
    }
})()
