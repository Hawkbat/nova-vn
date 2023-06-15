
interface StoryViewState {
    definition: StoryDefinition
    states: StoryState[]
    backdropID: string | null
    characters: Partial<Record<string, CharacterViewState>>
    text: string
    speaker: string | null
}

interface CharacterViewState {
    outfit: string
    expression: string
}

interface StoryState {
    passageIDs: string[]
    globalVariables: Partial<Record<string, VariableValue>>
    characterVariables: Partial<Record<string, Partial<Record<string, VariableValue>>>>
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
}

interface OutfitDefinition {
    id: string
    expressions: Partial<Record<string, ExpressionDefinition>>
}

interface ExpressionDefinition {
    id: string
    path: string
}

interface BackdropDefinition {
    id: string
    path: string
}

interface SoundDefinition {
    id: string
    path: string
}

interface ChapterDefinition {
    id: string
    name: string
    passages: PassageDefinition[]
}

interface PassageDefinition {
    id: string
    actions: PassageAction[]
}

interface VariableDefinition {
    id: string
    scope: VariableScope
    characterID?: string
    type: VariableValueType
    initialValue: VariableValue
}

type VariableScope = 'global' | 'cast' | 'character'

type VariableValueType = 'variable' | 'boolean' | 'string' | 'number' | 'list' | 'map' | 'null'

type VariableValue = { $: string } | boolean | string | number | VariableValue[] | Partial<{ [key: string]: VariableValue }> | null

type VariableValueOfType<T extends VariableValueType> =
    T extends 'variable' ? { $: string } :
    T extends 'boolean' ? boolean :
    T extends 'string' ? string :
    T extends 'number' ? number :
    T extends 'list' ? VariableValue[] :
    T extends 'map' ? Partial<{ [key: string]: VariableValue }> :
    T extends 'null' ? null :
    never

type CharacterLocation = 'left' | 'right' | 'center' | 'default'

type CheckComparisonType = '==' | '!=' | '<=' | '<' | '>=' | '>' | 'C' | '!C'

type PassageActionContainer = PassageDefinition | Extract<PassageAction, { actions: PassageAction[] }>

type PassageAction = {
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
    type: 'characterMove'
    characterID: string
    location: CharacterLocation
} | {
    type: 'continue'
} | {
    type: 'goto'
    passageID: string
} | {
    type: 'end'
} | {
    type: 'check'
    variableID: string
    comparison: CheckComparisonType
    value: VariableValue
    actions: PassageAction[]
    characterID?: string
} | {
    type: 'varSet'
    variableID: string
    value: VariableValue
    characterID?: string
} | {
    type: 'varAdd'
    variableID: string
    value: VariableValue
    characterID?: string
} | {
    type: 'varSubtract'
    variableID: string
    value: VariableValue
    characterID?: string
}

type PassageActionType = PassageAction['type']
type PassageActionOfType<T extends PassageActionType> = Extract<PassageAction, { type: T }>

class ParseError extends Error {
    constructor(public file: ParseFileContext, public range: ParseRange, public msg: string) {
        super(`An error was identified in a story file: ${msg}\nin ${file.path} at ${range.row}:${range.start}\n${file.lines[range.row]}\n${' '.repeat(range.start)}${'^'.repeat(Math.max(1, range.end - range.start))}`)
        this.name = 'ParseError'
    }
}

type ParseTokenType = 'unknown' | 'keyword' | 'identifier' | 'variable' | 'string' | 'number'

type VariableEvalResult<T extends VariableValueType> = [type: T, value: VariableValueOfType<T>]

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
    range: ParseRange
    text: string
}

interface ParseProjectContext {
    definition: StoryDefinition
    path: string
    files: Partial<Record<string, ParseFileContext>>
}

interface ParseFileContext {
    project: ParseProjectContext
    path: string
    lines: string[]
    tokens: ParseToken[]
    cursor: ParsePointer
    states: ParseState[]
    errors: ParseError[]
}

interface ParseState {
    indent: number
    character?: CharacterDefinition
    outfit?: OutfitDefinition
    passage?: PassageDefinition
    actionContainer?: PassageActionContainer
}
