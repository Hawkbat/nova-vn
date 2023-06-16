async function loadProject(projectPath: string) {
    const story = await PARSER.parseStory(projectPath, `${projectPath}/story.nvn`, async path => {
        const response = await fetch(path)
        if (!response.ok) {
            throw new Error(`Failed to fetch project file ${path}`)
        }
        const text = await response.text()
        return text
    })
    for (const file of Object.values(story.files)) {
        if (file?.errors.length) {
            MONACO.makeCodeEditor(file)
        }
    }
    return story
}

requestAnimationFrame(async () => {
    let project: ProjectContext
    try {
        project = await loadProject('project')
    } catch (e) {
        if (String(e).includes('Failed to fetch project file')) {
            console.warn(`Unable to load project file; falling back to showing the docs project`)
            project = await loadProject('engine/docs_project')
        } else {
            throw e
        }
    }
    try {
        await INTERPRETER.runProject(project)
    } catch (e) {
        if (e instanceof ParseError || e instanceof InterpreterError) {
            console.error(e)
            e.file.errors.push(e)
            MONACO.makeCodeEditor(e.file)
        } else {
            throw e
        }
    }
})
