/// <reference path="../../node_modules/monaco-editor/monaco.d.ts" />

const MONACO = (() => {
    const LANG_ID = 'nova-vn'

    let loadingPromise = createExposedPromise<void>()
    let currentFile: ParseFileContext | null = null
    let currentEditor: monaco.editor.IStandaloneCodeEditor | null = null
    
    require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.26.1/min/vs' }})
    
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
    
    async function makeCodeEditor(file: ParseFileContext) {
        await loadingPromise

        if (currentEditor) {
            currentEditor.dispose()
            currentEditor = null
        }

        const uri = monaco.Uri.parse(file.path)
        const value = file.lines.join('\n')
        const model = monaco.editor.createModel(value, LANG_ID, uri)
    
        let wasReset = false
        model.onDidChangeContent(e => {
            if (wasReset) {
                wasReset = false
                return
            }
            requestAnimationFrame(() => {
                wasReset = true
                model.setValue(value)
            })
        })
        
        const markers = file.errors.map(e => ({
            message: e.msg,
            severity: monaco.MarkerSeverity.Error,
            startLineNumber: e.range.row + 1,
            endLineNumber: e.range.row + 1,
            startColumn: e.range.start + 1,
            endColumn: e.range.end + 1,
        }))
        monaco.editor.setModelMarkers(model, LANG_ID, markers)
    
        currentEditor = monaco.editor.create(errorEditor, {
            model: model,
            theme: 'vs-dark',
        })
    }

    return {
        makeCodeEditor,
    }
})()