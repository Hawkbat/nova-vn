/// <reference path="../../node_modules/monaco-editor/monaco.d.ts" />

const MONACO = (() => {
    const LANG_ID = 'nova-vn'
    const SAVE_DELAY = 500

    let loadingPromise = createExposedPromise<void>()
    let currentProject: ProjectContext | null = null
    let currentFile: FileContext | null = null
    let currentEditor: monaco.editor.IStandaloneCodeEditor | null = null
    let fileListItems: Partial<Record<string, HTMLDivElement>> = {}

    require.config({ paths: { 'vs': 'engine/monaco-editor' } })

    require(["vs/editor/editor.main"], () => {
        monaco.languages.register({ id: LANG_ID })

        monaco.languages.setMonarchTokensProvider(LANG_ID, {
            keywords: LANGUAGE.keywords,
            identifiers: LANGUAGE.identifiers,
            escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
            tokenizer: {
                root: [
                    [/\$[\w$]*/, 'variable'],
                    [/[a-zA-Z_][\w$]*/, {
                        cases: {
                            '@keywords': 'keyword',
                            '@identifiers': 'type',
                            '@default': 'type',
                        },
                    }],
                    [/[\-+]?\d+(\.\d+)?/, 'number'],
                    [/"([^"\\]|\\.)*$/, 'string.invalid'],
                    [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
                    [/[ \t\r\n]+/, 'white'],
                ],
                string: [
                    [/[^\\"]+/, 'string'],
                    [/@escapes/, 'string.escape'],
                    [/\\./, 'string.escape.invalid'],
                    [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
                ],
            }
        })

        const tokenizerState = { clone: () => tokenizerState, equals: () => true }
        monaco.languages.setTokensProvider(LANG_ID, {
            getInitialState: () => tokenizerState,
            tokenize: (line) => {
                if (!line || !currentFile) return { endState: tokenizerState, tokens: [] }
                const row = currentFile.lines.indexOf(line)
                const fileTokens = currentFile.tokens.filter(t => t.range.row === row)
                const TOKEN_TYPE_MAP = {
                    'unknown': '',
                    'keyword': 'keyword',
                    'identifier': 'type',
                    'variable': 'variable',
                    'string': 'string',
                    'number': 'number',
                }
                const tokens = fileTokens.map(t => ({ scopes: TOKEN_TYPE_MAP[t.type], startIndex: t.range.start }))
                return { endState: tokenizerState, tokens }
            },
        })

        monaco.languages.registerHoverProvider(LANG_ID, {
            async provideHover(model, position, cancellationToken) {
                if (!currentProject || !currentFile) return null
                const token = getTokenAtPosition(currentFile, position)
                if (!token) return null
                const contents: string[] = ({
                    unknown: [],
                    keyword: [],
                    identifier: ({
                        '': [],
                        character: [`(Character) ${token.text}`],
                        outfit: [`(Outfit) ${token.text}`],
                        expression: [`(Expression) ${token.text}`],
                        backdrop: [`(Backdrop) ${token.text}`],
                        sound: [`(Sound) ${token.text}`],
                        passage: [`(Passage) ${token.text}`],
                        location: [`(Location) ${token.text}`],
                        comparison: [`(Comparison) ${token.text}`],
                        value: [`(Value) ${token.text}`],
                    })[token.subType ?? ''],
                    variable: [`(Variable) ${token.text}`],
                    string: [`(Text) ${token.text}`],
                    number: [`(Number) ${token.text}`],
                })[token.type]
                const context = getTokenContext(currentProject, currentFile, token)
                if (context) {
                    if (Array.isArray(context)) {
                        contents.push(context.map(c => `<img height="192" src="${c.path}">`).join(''))
                        contents.push(...context.map(c => c.path))
                    } else if ('outfits' in context) {
                        contents[0] = `(Character) ${token.text} ("${context.name}")`
                        const expr = Object.values(Object.values(context.outfits)[0]?.expressions?? {})[0]
                        if (expr) contents.push(`<img height="192" src="${expr.path}">`)
                    } else if ('expressions' in context) {
                        contents.push(Object.values(context.expressions).filter(filterFalsy).map(c => `<img height="192" src="${c.path}">`).join(''))
                    } else if ('path' in context) {
                        if (context.path.toLowerCase().endsWith('.png') || context.path.toLowerCase().endsWith('.jpg')) {
                            contents.push(`<img height="192" src="${context.path}">`)
                        } else if (context.path.toLowerCase().endsWith('.wav') || context.path.toLowerCase().endsWith('.mp3')) {
                            INTERFACE.playSound(context)
                        }
                        contents.push(context.path)
                    } else if ('scope' in context) {
                        contents[0] = `${context.scope === 'global' ? '(Global Variable)' : context.scope === 'cast' ? '(Cast Variable)' : context.scope === 'character' ? `(Character Variable: ${context.characterID})` : ''} ${token.text} (Initially: ${printVariableValue(context.initialValue)})`
                    }
                }
                return {
                    contents: contents.map(c => ({ value: c, isTrusted: true, supportHtml: true, baseUri: { scheme: 'http' } })),
                    range: convertRangeToRange(token.range),
                }
            },
        })

        monaco.languages.registerDocumentHighlightProvider(LANG_ID, {
            async provideDocumentHighlights(model, position, cancellationToken) {
                if (!currentProject || !currentFile) return null
                const token = getTokenAtPosition(currentFile, position)
                if (!token) return null
                return getRangesWithSameContext(currentProject, currentFile, token).filter(t => t.file === currentFile?.path).map(r => ({ range: convertRangeToRange(r) }))
            },
        })

        monaco.languages.registerDefinitionProvider(LANG_ID, {
            provideDefinition(model, position, cancellationToken) {
                if (!currentProject || !currentFile) return null
                const token = getTokenAtPosition(currentFile, position)
                if (!token) return null

                const ctx = getTokenContext(currentProject, currentFile, token)
                if (ctx) return Array.isArray(ctx) ? ctx.map(c => convertRangeToLocation(c.range)) : convertRangeToLocation(ctx.range)
            },
        })

        monaco.languages.registerReferenceProvider(LANG_ID, {
            provideReferences(model, position, context, cancellationToken) {
                if (!currentProject || !currentFile) return null
                const token = getTokenAtPosition(currentFile, position)
                if (!token) return null
                return getRangesWithSameContext(currentProject, currentFile, token).map(r => convertRangeToLocation(r))
            },
        })

        monaco.languages.registerRenameProvider(LANG_ID, {
            provideRenameEdits(model, position, newName, cancellationToken) {
                if (!currentProject || !currentFile) return null
                const token = getTokenAtPosition(currentFile, position)
                if (!token) return null
                const ranges = getRangesWithSameContext(currentProject, currentFile, token)
                if (!ranges.length) return null
                return { edits: ranges.map(r => ({ resource: monaco.Uri.parse(r.file), textEdit: { range: convertRangeToRange(r), text: newName }, versionId: monaco.editor.getModel(monaco.Uri.parse(r.file))?.getVersionId() })) }
            },
            resolveRenameLocation(model, position, cancellationToken) {
                if (!currentProject || !currentFile) return null
                const token = getTokenAtPosition(currentFile, position)
                if (!token) return null
                const ranges = getRangesWithSameContext(currentProject, currentFile, token)
                if (!ranges.length || (token.type !== 'identifier' && token.type !== 'variable')) return { text: token.text, range: convertRangeToRange(token.range), rejectReason: 'You cannot rename this element.' }
                if (token.type === 'identifier' && (token.subType === 'comparison' || token.subType === 'location' || token.subType === 'value')) return { text: token.text, range: convertRangeToRange(token.range), rejectReason: 'You cannot rename this element.' }
                return { text: token.text, range: convertRangeToRange(token.range) }
            },
        })

        monaco.languages.registerSignatureHelpProvider(LANG_ID, {
            signatureHelpTriggerCharacters: [' ', '\t'],
            signatureHelpRetriggerCharacters: [' ', '\t'],
            provideSignatureHelp(model, position, cancellationToken, context) {
                if (!currentProject || !currentFile) return null
                const token = getTokenAtPosition(currentFile, position)
                const lineTokens = currentFile.tokens.filter(t => t.range.row === position.lineNumber - 1)
                const previousTokens = lineTokens.filter(t => t.range.start <= position.column - 1)

                const isOnLastToken = previousTokens.length && previousTokens[previousTokens.length - 1] === token

                const currentIndex = isOnLastToken ? previousTokens.length - 1 : previousTokens.length

                const activeSig = LANGUAGE.getActiveSignatures(lineTokens, currentIndex)

                const signatures: monaco.languages.SignatureInformation[] = activeSig.signatures.map(s => {
                    let paramSubsets: [number, number][] = []
                    let label = ''
                    for (const p of s) {
                        const start = label.length
                        label += p.type === 'keyword' ? p.keyword : `'${LANGUAGE.getTokenLabel(p)}'`
                        const end = label.length
                        label += ' '
                        paramSubsets.push([start, end])
                    }
                    return {
                        label,
                        parameters: paramSubsets.map(p => ({ label: p })),
                    }
                })

                return {
                    value: {
                        signatures,
                        activeParameter: activeSig.parameterIndex + (isOnLastToken ? 0 : 1),
                        activeSignature: activeSig.signatureIndex,
                    },
                    dispose: () => {},
                }
            },
        })

        monaco.languages.registerCompletionItemProvider(LANG_ID, {
            triggerCharacters: [' ', '\t'],
            provideCompletionItems(model, position, context, cancellationToken) {
                if (!currentProject || !currentFile) return { suggestions: [] }
                const token = getTokenAtPosition(currentFile, position)
                
                const previousTokens = currentFile.tokens.filter(t => t.range.row === position.lineNumber - 1 && t.range.end <= position.column - 1)

                const expected = LANGUAGE.getExpectedTokens(LANGUAGE.definition, previousTokens)

                const characterID = previousTokens.find(p => p.type === 'identifier' && p.subType === 'character')?.text ?? null

                const options = expected.flatMap(e => LANGUAGE.getTokenOptions(currentProject!, e, characterID))

                const range: monaco.IRange = token ? convertRangeToRange(token.range) : { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: position.column, endColumn: position.column }

                return {
                    suggestions: options.map(o => ({ label: o.text, kind: monaco.languages.CompletionItemKind.Variable, range, insertText: o.text, insertTextRules: o.template ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined })),
                }
            },
        })

        monaco.editor.registerEditorOpener({
            openCodeEditor(source, resource, selectionOrPosition) {
                if (!currentProject || !currentFile) return false
                const targetFile = Object.values(currentProject.files).filter(filterFalsy).find(f => monaco.Uri.parse(f.path).path === resource.path)
                if (targetFile) {
                    let range: ParseRange | null = null
                    if (!selectionOrPosition) range = null
                    else if ('column' in selectionOrPosition) range = getTokenAtPosition(targetFile, selectionOrPosition)?.range ?? null
                    else range = getTokenAtPosition(targetFile, { column: selectionOrPosition.startColumn, lineNumber: selectionOrPosition.startLineNumber })?.range ?? null
                    loadFile(currentProject, targetFile, range)
                    return true
                }
                return false
            },
        })

        loadingPromise.resolve()
    })

    function getTokenAtPosition(file: FileContext, position: monaco.IPosition) {
        const token: ParseToken | undefined = file.tokens.find(t => t.range.row + 1 === position.lineNumber && t.range.start + 1 <= position.column && t.range.end + 1 >= position.column)
        return token
    }

    function getTokenContext(project: ProjectContext, file: FileContext, token: ParseToken) {
        if (token.type === 'identifier' && token.subType) {
            if (token.subType === 'character') {
                const character = project.definition.characters[token.text]
                if (character) return character
            } else if (token.subType === 'outfit') {
                const characterID = file.tokens.find(t => t.range.row === token.range.row && t.subType === 'character')?.text
                const character = project.definition.characters[characterID ?? '']
                if (character) {
                    const outfit = character.outfits[token.text]
                    if (outfit) return outfit
                }
            } else if (token.subType === 'expression') {
                const characterID = file.tokens.find(t => t.range.row === token.range.row && t.subType === 'character')?.text
                const character = project.definition.characters[characterID ?? '']
                if (character) {
                    const possibleExpressions = Object.values(character.outfits).flatMap(o => o?.expressions[token.text]).filter(filterFalsy)
                    return possibleExpressions
                }
            } else if (token.subType === 'backdrop') {
                const backdrop = project.definition.backdrops[token.text]
                if (backdrop) return backdrop
            } else if (token.subType === 'sound') {
                const sound = project.definition.sounds[token.text]
                if (sound) return sound
            } else if (token.subType === 'passage') {
                const passage = project.definition.passages[token.text]
                if (passage) return passage
            }
        } else if (token.type === 'variable') {
            const characterID = file.tokens.find(t => t.range.row === token.range.row && t.subType === 'character')?.text
            if (characterID) {
                const character = project.definition.characters[characterID ?? '']
                if (character) {
                    const variable = character.variables[token.text]
                    if (variable) return variable
                }
            }
            const variable = project.definition.variables[token.text]
            if (variable) return variable
        }
        return null
    }

    function getRangesWithSameContext(project: ProjectContext, file: FileContext, token: ParseToken): FileRange[] {
        const context = getTokenContext(project, file, token)
        const match = (a: typeof context, b: typeof context) => Array.isArray(a) && Array.isArray(b) ? a.every(v => b.includes(v)) : a !== null && a === b
        const ranges: FileRange[] = Object.values(project.files).filter(filterFalsy).flatMap(f => f.tokens.filter(t => match(context, getTokenContext(project, f, t))).map(t => ({ file: f.path, ...t.range })))
        return ranges
    }

    function convertRangeToLocation(range: FileRange): monaco.languages.Location {
        return {
            uri: monaco.Uri.parse(range.file),
            range: convertRangeToRange(range),
        }
    }

    function convertRangeToRange(range: ParseRange): monaco.IRange {
        return {
            startLineNumber: range.row + 1,
            endLineNumber: range.row + 1,
            startColumn: range.start + 1,
            endColumn: range.end + 1,
        }
    }

    async function makeFileList(project: ProjectContext) {
        for (const el of Object.values(fileListItems)) {
            if (el) el.remove()
        }
        for (const file of Object.values(project.files)) {
            if (!file) continue
            const el = <div className="file">{file.path}</div> as HTMLDivElement
            el.addEventListener('click', () => {
                makeCodeEditor(project, file, null)
            })
            if (file.path === currentFile?.path) {
                el.classList.add('selected')
            }
            MARKUP.codeFiles.append(el)
            fileListItems[file.path] = el
        }
    }

    async function setDiagnosticMarkers(file: FileContext, editor: monaco.editor.IStandaloneCodeEditor) {
        await loadingPromise
        const markers = file.errors.map(e => ({
            message: e.msg,
            severity: monaco.MarkerSeverity.Error,
            ...convertRangeToRange(e.range),
        }))
        monaco.editor.setModelMarkers(editor.getModel()!, LANG_ID, markers)
    }

    async function upsertModels(project: ProjectContext) {
        await loadingPromise
        for (const file of Object.values(project.files)) {
            if (file) await upsertModel(project, file)
        }
    }

    async function upsertModel(project: ProjectContext, file: FileContext) {
        await loadingPromise
        const uri = monaco.Uri.parse(file.path)
        const value = file.lines.join('\n')

        let model: monaco.editor.ITextModel
        let existingModel = monaco.editor.getModel(uri)
        if (existingModel) {
            model = existingModel
            if (model.getValue() !== value) {
                console.log('File content mismatch; reload might not be triggered properly?')
                //model.setValue(value)
            }
        } else {
            model = monaco.editor.createModel(value, LANG_ID, uri)

            let savingPromise: Promise<void> | null = null
            let saveTime = Date.now()
    
            let wasReset = false
            model.onDidChangeContent(e => {
                if (wasReset) {
                    wasReset = false
                    return
                }
                requestAnimationFrame(() => {
                    if (NATIVE.isEnabled()) {
                        const currentSaveTime = saveTime
                        saveTime = currentSaveTime
                        savingPromise = (async () => {
                            await wait(SAVE_DELAY)
                            if (saveTime === currentSaveTime) {
                                await NATIVE.saveFile(file.path, model.getValue())
                                const newProject = await PARSER.parseStory(project.path, NETWORK_LOADER)
                                await loadProject(newProject)
                                const newFile = newProject.files[file.path]
                                if (newFile) {
                                    await loadFile(newProject, newFile, null)
                                }
                            }
                            savingPromise = null
                        })()
                    } else {
                        wasReset = true
                        model.setValue(value)
                    }
                })
            })
        }
        return model
    }

    async function updateCodeEditor(project: ProjectContext, file: FileContext) {
        await loadingPromise
        if (!currentEditor) return
        currentProject = project
        currentFile = file
        fileListItems[file.path]?.classList.add('selected')
        setDiagnosticMarkers(file, currentEditor)
        const model: any = currentEditor.getModel()
        model?.tokenization.resetTokenization()
    }

    async function makeCodeEditor(project: ProjectContext, file: FileContext, range: ParseRange | null) {
        await loadingPromise

        if (currentEditor) {
            currentEditor.dispose()
            currentEditor = null
        }

        if (currentFile) {
            fileListItems[currentFile.path]?.classList.remove('selected')
        }

        currentProject = project
        currentFile = file

        fileListItems[file.path]?.classList.add('selected')

        const model = await upsertModel(project, file)

        currentEditor = monaco.editor.create(MARKUP.codePane, {
            model: model,
            theme: 'vs-dark',
            automaticLayout: true,
        })

        await setDiagnosticMarkers(file, currentEditor)

        if (range) {
            const monacoRange = convertRangeToRange(range)
            currentEditor.revealRangeInCenter(monacoRange)
            currentEditor.setPosition({ lineNumber: monacoRange.startLineNumber, column: monacoRange.startColumn })
            currentEditor.focus()
        }
    }

    function getVariableValueType(value: VariableValue): VariableValueType {
        return Object.keys(value)[0] as VariableValueType
    }

    function isVariableValueType<T extends VariableValueType>(value: VariableValue, type: T): value is VariableValueOfType<T> {
        return getVariableValueType(value) === type
    }

    function printVariableValue(value: VariableValue) {
        if (isVariableValueType(value, 'boolean')) {
            return value.boolean ? 'yes' : 'no'
        } else if (isVariableValueType(value, 'number')) {
            return JSON.stringify(value.number)
        } else if (isVariableValueType(value, 'string')) {
            return JSON.stringify(value.string)
        } else if (isVariableValueType(value, 'null')) {
            return 'nothing'
        } else if (isVariableValueType(value, 'list')) {
            return 'a list'
        } else if (isVariableValueType(value, 'map')) {
            return 'a map'
        } else if (isVariableValueType(value, 'variable')) {
            return value.variable
        } else {
            return JSON.stringify(value)
        }
    }

    function isCodeEditorOpen() {
        return !MARKUP.codeEditor.classList.contains('closed')
    }

    function setCodeEditorOpen(open: boolean) {
        MARKUP.codeEditor.classList.toggle('closed', !open)
    }

    async function loadProject(project: ProjectContext) {
        await makeFileList(project)
        await upsertModels(project)
    }

    async function loadFile(project: ProjectContext, file: FileContext, range: ParseRange | null) {
        if (currentEditor && currentFile?.path === file?.path) {
            await updateCodeEditor(project, file)
        } else {
            await makeCodeEditor(project, file, range)
        }
    }

    return {
        loadProject,
        loadFile,
        isCodeEditorOpen,
        setCodeEditorOpen,
    }
})()