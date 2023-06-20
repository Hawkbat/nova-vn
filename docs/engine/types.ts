
interface InterpreterStoryContext {
    history: Immutable<InterpreterStoryState[]>
    state: Immutable<InterpreterStoryState>
}

interface InterpreterStoryState {
    passageID: string | null
    backdropID: string | null
    characters: Partial<Record<string, InterpreterCharacterState>>
    variables: Partial<Record<string, VariableValue>>
}

interface InterpreterCharacterState {
    outfitID: string | null
    expressionID: string | null
    location: CharacterLocation
    variables: Partial<Record<string, VariableValue>>
}

interface StoryDefinition {
    characters: Partial<Record<string, CharacterDefinition>>
    backdrops: Partial<Record<string, BackdropDefinition>>
    sounds: Partial<Record<string, SoundDefinition>>
    passages: Partial<Record<string, PassageDefinition>>
    variables: Partial<Record<string, VariableDefinition>>
}

interface CharacterDefinition {
    id: string
    name: string
    outfits: Partial<Record<string, OutfitDefinition>>
    variables: Partial<Record<string, VariableDefinition>>
    range: FileRange
}

interface OutfitDefinition {
    id: string
    expressions: Partial<Record<string, ExpressionDefinition>>
    range: FileRange
}

interface ExpressionDefinition {
    id: string
    path: string
    range: FileRange
}

interface BackdropDefinition {
    id: string
    path: string
    range: FileRange
}

interface SoundDefinition {
    id: string
    path: string
    range: FileRange
}

interface PassageDefinition {
    id: string
    actions: PassageAction[]
    range: FileRange
}

interface VariableDefinition {
    id: string
    scope: VariableScope
    characterID?: string
    type: VariableValueType
    initialValue: VariableValue
    range: FileRange
}

type VariableScope = 'global' | 'cast' | 'character'

type VariableValueType = 'variable' | 'boolean' | 'string' | 'number' | 'list' | 'map' | 'null'

type VariableValue = { variable: string } | { boolean: boolean } | { string: string } | { number: number } | { list: VariableValue[] } | { map: Record<string, VariableValue> } | { null: null }

type VariableValueOfType<T extends VariableValueType> = Extract<VariableValue, Record<T, any>>

type CharacterLocation = 'left' | 'right' | 'center' | 'default'

type CheckComparisonType = '==' | '!=' | '<=' | '<' | '>=' | '>' | 'C' | '!C'

type PassageActionContainer = PassageDefinition | Extract<PassageAction, { actions: PassageAction[] }>

type PassageAction = ({
    range: FileRange
}) & ({
    type: 'continue'
} | {
    type: 'goto'
    passageID: string
    passageRange: FileRange
} | {
    type: 'end'
} | {
    type: 'backdropChange'
    backdropID: string
} | {
    type: 'playSound'
    soundID: string
} | {
    type: 'narration'
    text: string
} | {
    type: 'option'
    text: string
    actions: PassageAction[]
} | {
    type: 'characterEntry'
    characterID: string
    location: CharacterLocation
} | {
    type: 'characterExit'
    characterID: string
    location: CharacterLocation
} | {
    type: 'characterMove'
    characterID: string
    location: CharacterLocation
} | {
    type: 'characterSpeech'
    characterID: string
    text: string
} | {
    type: 'characterExpressionChange'
    characterID: string
    expressionID: string
} | {
    type: 'characterOutfitChange'
    characterID: string
    outfitID: string
} | {
    type: 'check'
    variableID: string
    comparison: CheckComparisonType
    value: VariableValue
    actions: PassageAction[]
    characterID: string | null
} | {
    type: 'varSet'
    variableID: string
    value: VariableValue
    characterID: string | null
} | {
    type: 'varAdd'
    variableID: string
    value: VariableValue
    key?: VariableValue
    characterID: string | null
} | {
    type: 'varSubtract'
    variableID: string
    value: VariableValue
    characterID: string | null
})

type PassageActionType = PassageAction['type']
type PassageActionOfType<T extends PassageActionType> = Extract<PassageAction, { type: T }>

class ParseError extends Error {
    constructor(public file: FileContext, public range: ParseRange, public msg: string) {
        super(`An error was identified in a story file: ${msg}\nin ${file.path} at ${range.row}:${range.start}\n${file.lines[range.row]}\n${' '.repeat(range.start)}${'^'.repeat(Math.max(1, range.end - range.start))}`)
        this.name = 'ParseError'
    }
}

class InterpreterError extends Error {
    constructor(public file: FileContext, public range: ParseRange, public msg: string) {
        super(`An error was identified while processing a story file: ${msg}\nin ${file.path} at ${range.row}:${range.start}\n${file.lines[range.row]}\n${' '.repeat(range.start)}${'^'.repeat(Math.max(1, range.end - range.start))}`)
        this.name = 'InterpreterError'
    }
}

type ParseTokenType = 'unknown' | 'keyword' | 'identifier' | 'variable' | 'string' | 'number'
type ParseTokenSubType = 'character' | 'outfit' | 'expression' | 'backdrop' | 'sound' | 'passage' | 'location' | 'comparison' | 'value'

interface ParsePointer {
    row: number
    col: number
}

interface ParseRange {
    row: number
    start: number
    end: number
}

interface ParseToken {
    type: ParseTokenType
    subType?: ParseTokenSubType
    range: ParseRange
    text: string
}

interface FileRange extends ParseRange {
    file: string
}

interface ProjectContext {
    definition: StoryDefinition
    path: string
    files: Partial<Record<string, FileContext>>
}

interface FileContext {
    path: string
    lines: string[]
    lineStates: ParseState[]
    tokens: ParseToken[]
    cursor: ParsePointer
    states: ParseState[]
    errors: (ParseError | InterpreterError)[]
}

interface ParseState {
    indent: number
    character?: CharacterDefinition
    outfit?: OutfitDefinition
    passage?: PassageDefinition
    actionContainer?: PassageActionContainer
}

interface ChoiceOption {
    text: string
    onSelect: () => void | Promise<void>
}

type LanguageDefinitionNode = {
    type: 'variable'
    definition?: boolean
} | {
    type: 'identifier'
    subType: LanguageDefinitionIdentifierType
    definition?: boolean
} | {
    type: 'number'
} | {
    type: 'string'
} | {
    type: 'keyword'
    keyword: string
} | {
    type: 'any'
    any: LanguageDefinitionNode[]
} | {
    type: 'seq'
    seq: LanguageDefinitionNode[]
} | {
    type: 'optional'
    optional: LanguageDefinitionNode
} | {
    type: 'eol'
}

type LanguageDefinitionIdentifierType = ParseTokenSubType

type PrimitiveLanguageDefinitionNode = Extract<LanguageDefinitionNode, { type: ParseTokenType }>

type LanguageDefinitionSignature = PrimitiveLanguageDefinitionNode[]

type LanguageDefinitionActiveSignatures = {
    signatures: LanguageDefinitionSignature[]
    signature: LanguageDefinitionSignature | null
    signatureIndex: number
    parameterIndex: number
}
