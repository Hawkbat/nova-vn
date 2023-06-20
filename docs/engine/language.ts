
const LANGUAGE = (() => {
    const variable = (definition?: boolean): LanguageDefinitionNode => ({ type: 'variable', definition })
    const identifier = (subType: LanguageDefinitionIdentifierType, definition?: boolean): LanguageDefinitionNode => ({ type: 'identifier', subType, definition })
    const number = (): LanguageDefinitionNode => ({ type: 'number' })
    const string = (): LanguageDefinitionNode => ({ type: 'string' })
    const keyword = (keyword: string): LanguageDefinitionNode => ({ type: 'keyword', keyword })
    const any = (...any: LanguageDefinitionNode[]): LanguageDefinitionNode => ({ type: 'any', any })
    const seq = (...seq: LanguageDefinitionNode[]): LanguageDefinitionNode => ({ type: 'seq', seq })
    const optional = (optional: LanguageDefinitionNode): LanguageDefinitionNode => ({ type: 'optional', optional })
    const eol = (): LanguageDefinitionNode => ({ type: 'eol' })
    const keywordMap = (keywords: Record<string, LanguageDefinitionNode>): LanguageDefinitionNode => ({ type: 'any', any: Object.entries(keywords).map(([k, v]) => seq(keyword(k), v)) })

    const variableValue = () => any(variable(), number(), string(), identifier('value'))

    const comparisons = ['is not less than or equal to', 'is less than or equal to', 'is not less than', 'is less than', 'is not greater than or equal to', 'is greater than or equal to', 'is not greater than', 'is greater than', 'is not', 'is', 'does not contain', 'contains']

    const locations = ['left', 'right', 'center']

    const specialValues = ['yes', 'no', 'a list', 'a map', 'nothing']

    const tokenMatches = (node: LanguageDefinitionNode, token: ParseToken | null | undefined, index: number = 0): boolean => {
        if (!token) return node.type === 'eol'
        switch (node.type) {
            case 'variable': return token.type === 'variable'
            case 'identifier': return token.type === 'identifier' && node.subType === token.subType
            case 'number': return token.type === 'number'
            case 'string': return token.type === 'string'
            case 'keyword': return token.type === 'keyword' && token.text === node.keyword
            case 'any': return node.any.some(n => tokenMatches(n, token))
            case 'seq': return tokenMatches(node.seq[index], token)
            case 'optional': return tokenMatches(node.optional, token)
        }
        return false
    }

    const getExpectedTokens = (node: LanguageDefinitionNode, tokens: ParseToken[], index: number = 0): LanguageDefinitionSignature => {
        const token: ParseToken | undefined = tokens[index]
        switch (node.type) {
            case 'variable':
            case 'identifier':
            case 'number':
            case 'string':
            case 'keyword':
                return !tokenMatches(node, token) ? [node] : []
            case 'any':
                const matched = node.any.find(n => tokenMatches(n, token))
                if (matched) return getExpectedTokens(matched, tokens, index)
                return node.any.flatMap(n => getExpectedTokens(n, tokens, index))
            case 'seq':
                const results: LanguageDefinitionSignature = []
                for (let i = 0; i < node.seq.length; i++) {
                    const c = node.seq[i]
                    if (!tokenMatches(c, tokens[index + i])) {
                        results.push(...getExpectedTokens(c, tokens, index + i))
                        if (c.type !== 'optional') return results
                    }
                }
                return results
            case 'optional':
                return getExpectedTokens(node.optional, tokens, index)
        }
        return []
    }

    const getTokenLabel = (node: PrimitiveLanguageDefinitionNode): string => {
        switch (node.type) {
            case 'number': return 'number'
            case 'string': return 'text'
            case 'keyword': return node.keyword
            case 'variable': return 'variable name'
            case 'identifier':
                switch (node.subType) {
                    case 'character': return 'character name'
                    case 'outfit': return 'outfit name'
                    case 'expression': return 'expression name'
                    case 'backdrop': return 'backdrop name'
                    case 'sound': return 'sound name'
                    case 'passage': return 'passage name'
                    case 'comparison': return 'comparison'
                    case 'location': return 'location'
                    case 'value': return 'value'   
                }
        }
    }

    const getTokenOptions = (project: ProjectContext, node: PrimitiveLanguageDefinitionNode, characterID: string | null): { text: string, template?: boolean }[] => {
        switch (node.type) {
            case 'number': return [{ text: `0`, template: true }]
            case 'string': return [{ text: `""`, template: true }]
            case 'keyword': return [{ text: node.keyword }]
            case 'variable':
                if (node.definition) return [{ text: `$newVar`, template: true }]
                const globalVariables = Object.values(project.definition.variables).filter(filterFalsy).map(v => ({ text: v.id }))
                if (characterID) {
                    const character = project.definition.characters[characterID]
                    if (character) {
                        const characterVariables = Object.values(character.variables).filter(filterFalsy).map(v => ({ text: v.id }))
                        return [...characterVariables, ...globalVariables]
                    }
                }
                return [...globalVariables]
            case 'identifier':
                if (node.definition) return [{ text: `new_${node.subType}`, template: true }]
                switch (node.subType) {
                    case 'character': return Object.values(project.definition.characters).filter(filterFalsy).map(c => ({ text: c.id }))
                    case 'backdrop': return Object.values(project.definition.backdrops).filter(filterFalsy).map(c => ({ text: c.id }))
                    case 'sound': return Object.values(project.definition.sounds).filter(filterFalsy).map(c => ({ text: c.id }))
                    case 'passage': return Object.values(project.definition.passages).filter(filterFalsy).map(c => ({ text: c.id }))
                    case 'outfit': return Object.values(project.definition.characters[characterID ?? '']?.outfits ?? {}).filter(filterFalsy).map(c => ({ text: c.id }))
                    case 'expression': return Object.values(project.definition.characters[characterID ?? '']?.outfits ?? {}).filter(filterFalsy).flatMap(o => Object.values(o.expressions).filter(filterFalsy)).map(c => ({ text: c.id }))
                    case 'comparison': return comparisons.map(c => ({ text: c }))
                    case 'location': return locations.map(l => ({ text: l }))
                    case 'value': return specialValues.map(p => ({ text: p }))
                }
        }
    }

    const getSignatures = (node: LanguageDefinitionNode, prefix: LanguageDefinitionSignature[]): LanguageDefinitionSignature[] => {
        switch (node.type) {
            case 'variable':
            case 'identifier':
            case 'number':
            case 'string':
            case 'keyword':
                return prefix.length ? prefix.map(p => [...p, node]) : [[node]]
            case 'optional':
                return [...getSignatures(node.optional, prefix), ...prefix]
            case 'any':
                return node.any.flatMap(n => getSignatures(n, prefix))
            case 'seq':
                let signatures = prefix
                for (const c of node.seq) {
                    signatures = getSignatures(c, signatures)
                }
                return signatures
            case 'eol':
                return prefix
        }
    }

    const getActiveSignatures = (tokens: ParseToken[], currentIndex: number): LanguageDefinitionActiveSignatures => {
        const results: { signature: LanguageDefinitionSignature, parameterIndex: number }[] = []
        for (let i = 0; i < LANGUAGE.signatures.length; i++) {
            const signature = LANGUAGE.signatures[i]
            let parameterIndex = -1
            for (let j = 0; j < signature.length; j++) {
                const c = signature[j]
                const outOfRange = j >= tokens.length
                const matches = tokenMatches(c, tokens[j])
                if (!outOfRange && matches) {
                    parameterIndex = j
                }
                if (!outOfRange && !matches) {
                    break
                }
            }
            if (tokens.length && parameterIndex < 0) continue
            results.push({ signature, parameterIndex })
        }
        const signatures = results.map(r => r.signature)
        const highestParamIndex = results.reduce((p, c) => Math.max(p, c.parameterIndex), -1)
        const match = results.find(r => r.parameterIndex === highestParamIndex)
        if (match) return { signatures, signatureIndex: signatures.indexOf(match.signature), signature: match.signature, parameterIndex: Math.min(currentIndex, match.parameterIndex) }
        return { signatures, signature: null, signatureIndex: -1, parameterIndex: -1 }
    }
    
    const definition: LanguageDefinitionNode = any(keywordMap({
        define: keywordMap({
            'global variable': seq(variable(true), optional(keyword('which')), keyword('is'), variableValue(), eol()),
            'cast variable': seq(variable(true), optional(keyword('which')), keyword('is'), variableValue(), eol()),
            character: seq(identifier('character', true), keyword('as'), string(), eol()),
            backdrop: seq(identifier('backdrop', true), optional(seq(keyword('from'), string())), eol()),
            sound: seq(identifier('sound', true), optional(seq(keyword('from'), string())), eol()),
            passage: seq(identifier('passage', true), eol()),
        }),
        has: keywordMap({
            outfit: seq(identifier('outfit', true), eol()),
        }),
        with: keywordMap({
            expression: seq(identifier('expression', true), eol()),
        }),
        include: seq(string(), eol()),
        continue: eol(),
        'go to': seq(identifier('passage'), eol()),
        end: eol(),
        display: seq(identifier('backdrop'), eol()),
        play: seq(identifier('sound'), eol()),
        narrate: seq(string(), eol()),
        option: seq(string(), eol()),
        check: seq(keyword('if'), variable(), identifier('comparison'), variableValue(), eol()),
        set: seq(variable(), keyword('to'), variableValue(), eol()),
        add: seq(variableValue(), keyword('to'), variable(), optional(seq(keyword('as'), variableValue())), eol()),
        subtract: seq(variableValue(), keyword('from'), variable(), eol()),
    }),
    seq(identifier('character'), keywordMap({
        enters: seq(optional(seq(keyword('from'), identifier('location'))), eol()),
        enter: seq(optional(seq(keyword('from'), identifier('location'))), eol()),
        exits: seq(optional(seq(keyword('to'), identifier('location'))), eol()),
        exit: seq(optional(seq(keyword('to'), identifier('location'))), eol()),
        moves: seq(optional(seq(keyword('to'), identifier('location'))), eol()),
        move: seq(optional(seq(keyword('to'), identifier('location'))), eol()),
        says: seq(string(), eol()),
        say: seq(string(), eol()),
        emotes: seq(identifier('expression'), eol()),
        emote: seq(identifier('expression'), eol()),
        wears: seq(identifier('outfit'), eol()),
        wear: seq(identifier('outfit'), eol()),
        checks: seq(keyword('if'), variable(), identifier('comparison'), variableValue(), eol()),
        check: seq(keyword('if'), variable(), identifier('comparison'), variableValue(), eol()),
        sets: seq(variable(), keyword('to'), variableValue(), eol()),
        set: seq(variable(), keyword('to'), variableValue(), eol()),
        adds: seq(variableValue(), keyword('to'), variable(), optional(seq(keyword('as'), variableValue())), eol()),
        add: seq(variableValue(), keyword('to'), variable(), optional(seq(keyword('as'), variableValue())), eol()),
        subtracts: seq(variableValue(), keyword('from'), variable(), eol()),
        subtract: seq(variableValue(), keyword('from'), variable(), eol()),
    })))

    const findKeywords = (n: LanguageDefinitionNode, a: string[]): string[] => n.type === 'keyword' ? [...a, n.keyword] : n.type === 'any' ? n.any.reduce((p, c) => findKeywords(c, p), a) : n.type === 'seq' ? n.seq.reduce((p, c) => findKeywords(c, p), a) : n.type === 'optional' ? findKeywords(n.optional, a) : a

    const keywords = [...new Set(findKeywords(definition, [])).values()]
    const identifiers = [...new Set([...comparisons, ...locations, ...specialValues]).values()]

    const signatures = getSignatures(definition, [])

    return {
        definition,
        keywords,
        identifiers,
        specialValues,
        signatures,
        getExpectedTokens,
        getTokenLabel,
        getTokenOptions,
        getActiveSignatures,
    }
})()