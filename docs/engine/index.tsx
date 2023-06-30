
requestAnimationFrame(async () => {
    let project: ProjectContext | null = null
    if (!project) {
        try {
            project = await PARSER.parseStory('project')
        } catch (e) {
            if (String(e).includes('Failed to fetch project file')) {
                console.warn(`Unable to load project file; falling back to showing the docs project`)
            } else {
                throw e
            }
        }
    }
    if (!project) {
        project = await PARSER.parseStory('engine/docs_project')
    }
    try {
        await MONACO.loadProject(project)
        for (const file of Object.values(project.files)) {
            if (file?.errors.length) {
                await MONACO.loadFile(project, file, file.errors[0].range)
                MONACO.setCodeEditorOpen(true)
            }
        }
        await INTERPRETER.runProject(project)
    } catch (e) {
        if (e instanceof ParseError || e instanceof InterpreterError) {
            console.error(e)
            e.file.errors.push(e)
            await MONACO.loadFile(project, e.file, e.range)
            MONACO.setCodeEditorOpen(true)
        } else {
            throw e
        }
    }
})
