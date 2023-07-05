
const ENGINE = (() => {

    async function loadProjects() {
        if (NATIVE.isEnabled()) {
            let projects: ProjectContext[] = []
            for (const dir of await NATIVE.listDirectories('./')) {
                if (dir === 'engine') continue
                try {
                    const project = await PARSER.parseStory(dir)
                    projects.push(project)
                    console.log(`Loaded project '${project.path}'`)
                } catch (e) {
                    if (String(e).includes('Failed to fetch')) {
    
                    } else {
                        throw e
                    }
                }
            }
            if (!projects.length) {
                const project = await PARSER.parseStory('engine/docs_project')
                projects.push(project)
            }
            return projects
        } else {
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
            return project ? [project] : []
        }
    }

    async function runProject(project: ProjectContext) {
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
    }

    return {
        loadProjects,
        runProject,
    }
})()

requestAnimationFrame(async () => {
    const projects = await ENGINE.loadProjects()
    const project = projects.length === 1 ? projects[0] : null
    
    if (project) {
        await ENGINE.runProject(project)
    } else {
        await INTERFACE.loadMainMenu(projects)
    }
})
