/// <reference path="../../node_modules/monaco-editor/monaco.d.ts" />

const MONACO = (() => {
    const LANG_ID = 'nova-vn'
    const SAVE_DELAY = 500

    let loadingPromise = createExposedPromise<void>()
    let currentFile: FileContext | null = null
    let currentEditor: monaco.editor.IStandaloneCodeEditor | null = null
    let fileListItems: Partial<Record<string, HTMLDivElement>> = {}
    
    require.config({ paths: { 'vs': 'engine/monaco-editor' }})
    
    require(["vs/editor/editor.main"], () => {
        monaco.languages.register({ id: LANG_ID })

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

        loadingPromise.resolve()
    })

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

    function setDiagnosticMarkers(file: FileContext, editor: monaco.editor.IStandaloneCodeEditor) {
        const markers = file.errors.map(e => ({
            message: e.msg,
            severity: monaco.MarkerSeverity.Error,
            ...convertRange(e.range),
        }))
        monaco.editor.setModelMarkers(editor.getModel()!, LANG_ID, markers)
    }

    function convertRange(range: ParseRange): monaco.IRange {
        return {
            startLineNumber: range.row + 1,
            endLineNumber: range.row + 1,
            startColumn: range.start + 1,
            endColumn: range.end + 1,
        }
    }

    async function updateCodeEditor(project: ProjectContext, file: FileContext) {
        await loadingPromise
        if (!currentEditor) throw new Error('Invalid editor')
        currentFile = file
        fileListItems[file.path]?.classList.add('selected')
        setDiagnosticMarkers(file, currentEditor)
        const model: any = currentEditor.getModel()
        model?.tokenization.resetTokenization()
    }
    
    async function makeCodeEditor(project: ProjectContext, file: FileContext, range: ParseRange | null) {
        await loadingPromise

        if (currentEditor) {
            currentEditor.getModel()?.dispose()
            currentEditor.dispose()
            currentEditor = null
        }

        if (currentFile) {
            fileListItems[currentFile.path]?.classList.remove('selected')
        }

        currentFile = file
        
        fileListItems[file.path]?.classList.add('selected')

        const uri = monaco.Uri.parse(file.path)
        const value = file.lines.join('\n')
        const model = monaco.editor.createModel(value, LANG_ID, uri)

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
                            await makeFileList(newProject)
                            const newFile = newProject.files[file.path]
                            if (currentEditor && newFile && currentFile?.path === newFile?.path) {
                                await updateCodeEditor(newProject, newFile)
                            } else if (newFile) {
                                await makeCodeEditor(newProject, newFile, null)
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

        setCodeEditorOpen(true)
    
        currentEditor = monaco.editor.create(MARKUP.codePane, {
            model: model,
            theme: 'vs-dark',
        })

        setDiagnosticMarkers(file, currentEditor)
        
        if (range) {
            const monacoRange = convertRange(range)
            currentEditor.revealRangeInCenter(monacoRange)
            currentEditor.setPosition({ lineNumber: monacoRange.startLineNumber, column: monacoRange.startColumn })
            currentEditor.focus()
        }
    }

    function isCodeEditorOpen() {
        return !MARKUP.codeEditor.classList.contains('closed')
    }

    function setCodeEditorOpen(open: boolean) {
        MARKUP.codeEditor.classList.toggle('closed', !open)
    }

    return {
        makeFileList,
        makeCodeEditor,
        isCodeEditorOpen,
        setCodeEditorOpen,
    }
})()