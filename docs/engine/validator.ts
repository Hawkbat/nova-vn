
const VALIDATOR = (() => {

    async function validateStory(project: ProjectContext) {
        for (const passage of Object.values(project.definition.passages).filter(filterFalsy)) {
            await validatePassage(project, passage)
        }
        for (const character of Object.values(project.definition.characters).filter(filterFalsy)) {
            await validateCharacter(project, character)
        }
        for (const backdrop of Object.values(project.definition.backdrops).filter(filterFalsy)) {
            await validateBackdrop(project, backdrop)
        }
        for (const sound of Object.values(project.definition.sounds).filter(filterFalsy)) {
            await validateSound(project, sound)
        }
    }

    async function validatePassage(project: ProjectContext, passage: PassageDefinition) {
        await validateActionList(project, passage.actions)
    }

    async function validateActionList(project: ProjectContext, actions: PassageAction[]) {
        for (const action of actions) {
            await validateAction(project, action)
        }
    }

    function validateCharacterAction(project: ProjectContext, file: FileContext, characterID: string, characterRange: FileRange, actionName: string) {
        const character = project.definition.characters[characterID]
        if (!character) {
            throw new ValidationError(file, characterRange, `${actionName} actions must have a defined character name here. Did you forget to define it else where with 'define character ${characterID}'?`)
        }
        return character
    }

    async function validateAction(project: ProjectContext, action: PassageAction) {
        const file = project.files[action.range.file]!
        try {
            const validationMap: Partial<{ [K in PassageActionType]: (action: PassageActionOfType<K>) => Promise<void> }> = {
                backdropChange: async a => {
                    const backdrop = project.definition.backdrops[a.backdropID]
                    if (!backdrop) {
                        throw new ValidationError(file, a.backdropRange, `Display actions must have a defined backdrop name here. Did you forget to define it elsewhere with 'define backdrop ${a.backdropID}'?`)
                    }
                },
                playSound: async a => {
                    const sound = project.definition.sounds[a.soundID]
                    if (!sound) {
                        throw new ValidationError(file, a.soundRange, `Play Sound actions must have a defined sound name here. Did you forget to define it elsewhere with 'define sound ${a.soundID}'?`)
                    }
                },
                goto: async a => {
                    const passage = project.definition.passages[a.passageID]
                    if (!passage) {
                        throw new ValidationError(file, a.passageRange, `Go-To actions must have a valid passage name here, but the passage specified here does not exist. Did you forget to define it elsewhere with 'define passage ${a.passageID}'?`)
                    }
                },
                check: async a => {
                    if (a.characterID && a.characterRange) {
                        const character = validateCharacterAction(project, file, a.characterID, a.characterRange, 'Character check')
                        const variable = character.variables[a.variableID] ?? project.definition.variables[a.variableID]
                        if (!variable || variable.scope === 'global') {
                            throw new ValidationError(file, a.variableRange, `Character check actions must have a defined character or cast variable name here. Did you forget to define it elsewhere with 'has variable ${a.variableID}' under a character definition?`)
                        }
                    } else {
                        const variable = project.definition.variables[a.variableID]
                        if (!variable || variable.scope !== 'global') {
                            throw new ValidationError(file, a.variableRange, `Check actions must have a defined global variable name here. Did you forget to define it with 'define global variable ${a.variableID}'?`)
                        }
                    }
                    await validateActionList(project, a.actions)
                },
                varSet: async a => {
                    if (a.characterID && a.characterRange) {
                        const character = validateCharacterAction(project, file, a.characterID, a.characterRange, 'Character set')
                        const variable = character.variables[a.variableID] ?? project.definition.variables[a.variableID]
                        if (!variable || variable.scope === 'global') {
                            throw new ValidationError(file, a.variableRange, `Character set actions must have a defined character or cast variable name here. Did you forget to define it elsewhere with 'has variable ${a.variableID}' under a character definition?`)
                        }
                    } else {
                        const variable = project.definition.variables[a.variableID]
                        if (!variable || variable.scope !== 'global') {
                            throw new ValidationError(file, a.variableRange, `Set actions must have a defined global variable name here. Did you forget to define it with 'define global variable ${a.variableID}'?`)
                        }
                    }
                },
                varAdd: async a => {
                    if (a.characterID && a.characterRange) {
                        const character = validateCharacterAction(project, file, a.characterID, a.characterRange, 'Character add')
                        const variable = character.variables[a.variableID] ?? project.definition.variables[a.variableID]
                        if (!variable || variable.scope === 'global') {
                            throw new ValidationError(file, a.variableRange, `Character add actions must have a defined character or cast variable name here. Did you forget to define it elsewhere with 'has variable ${a.variableID}' under a character definition?`)
                        }
                        if (variable.type === 'map' && !a.key) {
                            throw new ValidationError(file, a.range, `Character add actions for map variables must have a key name at the end after the word 'as', like 'as "foo"'`)
                        }
                    } else {    
                        const variable = project.definition.variables[a.variableID]
                        if (!variable || variable.scope !== 'global') {
                            throw new ValidationError(file, a.variableRange, `Add actions must have a defined global variable name here. Did you forget to define it with 'define global variable ${a.variableID}'?`)
                        }
                        if (variable.type === 'map' && !a.key) {
                            throw new ValidationError(file, a.range, `Add actions for map variables must have a key name at the end after the word 'as', like 'as "foo"'`)
                        }
                    }
                },
                varSubtract: async a => {
                    if (a.characterID && a.characterRange) {
                        const character = validateCharacterAction(project, file, a.characterID, a.characterRange, 'Character subtract')
                        const variable = character.variables[a.variableID] ?? project.definition.variables[a.variableID]
                        if (!variable || variable.scope === 'global') {
                            throw new ValidationError(file, a.variableRange, `Character subtract actions must have a defined character or cast variable name here. Did you forget to define it elsewhere with 'has variable ${a.variableID}' under a character definition?`)
                        }
                    } else {
                        const variable = project.definition.variables[a.variableID]
                        if (!variable || variable.scope !== 'global') {
                            throw new ValidationError(file, a.variableRange, `Subtract actions must have a defined global variable name here. Did you forget to define it with 'define global variable ${a.variableID}'?`)
                        }
                    }
                },
                characterExpressionChange: async a => {
                    const character = validateCharacterAction(project, file, a.characterID, a.characterRange, 'Character expression change')
                    const expression = Object.values(character.outfits).flatMap(o => Object.values(o?.expressions ?? [])).find(e => e?.id === a.expressionID)
                    if (!expression) {
                        throw new ValidationError(file, a.expressionRange, `Character expression change actions must have a defined expression name here. Did you forget to define it with 'with expression ${a.expressionID}' under an outfit definition for character '${a.characterID}'?`)
                    }
                },
                characterOutfitChange: async a => {
                    const character = validateCharacterAction(project, file, a.characterID, a.characterRange, 'Character outfit change')
                    const outfit = Object.values(character.outfits).find(o => o?.id === a.outfitID)
                    if (!outfit) {
                        throw new ValidationError(file, a.outfitRange, `Character outfit change actions must have a defined outfit name here. Did you forget to define it with 'has outfit ${a.outfitID}' under the character definition for '${a.characterID}'?`)
                    }
                },
                option: async a => {
                    await validateActionList(project, a.actions)
                },
            }
            const validationFunc = validationMap[action.type]
            if (validationFunc) await validationFunc(action as any)
        } catch (e) {
            if (e instanceof ValidationError) {
                file.errors.push(e)
            } else {
                throw e
            }
        }
    }

    async function validateCharacter(project: ProjectContext, character: CharacterDefinition) {
        for (const outfit of Object.values(character.outfits).filter(filterFalsy)) {
            await validateOutfit(project, outfit)
        }
    }

    async function validateOutfit(project: ProjectContext, outfit: OutfitDefinition) {
        for (const expression of Object.values(outfit.expressions).filter(filterFalsy)) {
            await validateExpression(project, expression)
        }
    }

    async function validateExpression(project: ProjectContext, expression: ExpressionDefinition) {
        const file = project.files[expression.range.file]!
        if (!await checkFileExists(expression.path)) {
            file.errors.push(new ValidationError(file, expression.range, `The image file for this expression ('${expression.path}') does not exist! Did you move or rename it?`))
        }
    }

    async function validateBackdrop(project: ProjectContext, backdrop: BackdropDefinition) {
        const file = project.files[backdrop.range.file]!
        if (!await checkFileExists(backdrop.path)) {
            file.errors.push(new ValidationError(file, backdrop.range, `The image file for this backdrop ('${backdrop.path}') does not exist! Did you move or rename it?`))
        }
    }

    async function validateSound(project: ProjectContext, sound: SoundDefinition) {
        const file = project.files[sound.range.file]!
        if (!await checkFileExists(sound.path)) {
            file.errors.push(new ValidationError(file, sound.range, `The audio file for this sound ('${sound.path}') does not exist! Did you move or rename it?`))
        }
    }

    async function checkFileExists(path: string) {
        const response = await fetch(path)
        if (!response.ok) {
            return false
        }
        return true
    }

    return {
        validateStory,
    }
})()