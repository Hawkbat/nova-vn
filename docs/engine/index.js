"use strict";
const ENGINE = (() => {
    async function loadProjects() {
        if (NATIVE.isEnabled()) {
            let projects = [];
            for (const dir of await NATIVE.listDirectories('./')) {
                if (dir === 'engine')
                    continue;
                try {
                    const project = await PARSER.parseStory(dir);
                    projects.push(project);
                    console.log(`Loaded project '${project.path}'`);
                }
                catch (e) {
                    if (String(e).includes('Failed to fetch')) {
                    }
                    else {
                        throw e;
                    }
                }
            }
            if (!projects.length) {
                const project = await PARSER.parseStory('engine/docs_project');
                projects.push(project);
            }
            return projects;
        }
        else {
            let project = null;
            if (!project) {
                try {
                    project = await PARSER.parseStory('project');
                }
                catch (e) {
                    if (String(e).includes('Failed to fetch project file')) {
                        console.warn(`Unable to load project file; falling back to showing the docs project`);
                    }
                    else {
                        throw e;
                    }
                }
            }
            if (!project) {
                project = await PARSER.parseStory('engine/docs_project');
            }
            return project ? [project] : [];
        }
    }
    async function runProject(project) {
        try {
            await MONACO.loadProject(project);
            for (const file of Object.values(project.files)) {
                if (file?.errors.length) {
                    await MONACO.loadFile(project, file, file.errors[0].range);
                    MONACO.setCodeEditorOpen(true);
                }
            }
            await INTERPRETER.runProject(project);
        }
        catch (e) {
            if (e instanceof ParseError || e instanceof InterpreterError) {
                console.error(e);
                e.file.errors.push(e);
                await MONACO.loadFile(project, e.file, e.range);
                MONACO.setCodeEditorOpen(true);
            }
            else {
                throw e;
            }
        }
    }
    return {
        loadProjects,
        runProject,
    };
})();
requestAnimationFrame(async () => {
    const projects = await ENGINE.loadProjects();
    const project = projects.length === 1 ? projects[0] : null;
    if (project) {
        await ENGINE.runProject(project);
    }
    else {
        await INTERFACE.loadMainMenu(projects);
    }
});
const INTERFACE = (() => {
    const BACKDROP_HIDE_DURATION = 1000;
    const CHARACTER_HIDE_DURATION = 1000;
    const CHARACTER_MOVE_DURATION = 1000;
    const TEXT_HIDE_DURATION = 1000;
    const CHOICE_HIDE_DURATION = 1000;
    let audioContext = null;
    const characterElements = {};
    let textRevealPromise = null;
    let advancePromise = null;
    async function loadMainMenu(projects) {
        MARKUP.mainMenu.classList.remove('closed');
        MARKUP.viewport.classList.add('closed');
        MARKUP.textbox.classList.add('closed');
        MARKUP.mainMenu.innerHTML = '';
        for (const project of projects) {
            MARKUP.mainMenu.append(h("div", { className: "button", onclick: () => ENGINE.runProject(project) },
                "Play ",
                project.definition.name));
        }
        if (NATIVE.isEnabled()) {
            MARKUP.mainMenu.append(h("div", { className: "button", onclick: () => NATIVE.close() }, "Quit to Desktop"));
        }
    }
    async function loadStory(project) {
        MARKUP.mainMenu.classList.add('closed');
        MARKUP.viewport.classList.remove('closed');
        MARKUP.textbox.classList.remove('closed');
        await resetStory();
    }
    async function resetStory() {
        changeBackdrop(null);
        for (const el of Object.values(characterElements)) {
            if (el) {
                el.remove();
            }
        }
        MARKUP.nameplate.textContent = '';
        MARKUP.dialogue.textContent = '';
        MARKUP.choiceList.innerHTML = '';
    }
    async function changeBackdrop(backdrop) {
        const oldElement = MARKUP.currentBackdrop;
        const newElement = MARKUP.currentBackdrop.cloneNode();
        MARKUP.currentBackdrop = newElement;
        oldElement.parentNode?.insertBefore(newElement, oldElement.nextSibling);
        newElement.style.backgroundImage = backdrop ? `url(${backdrop.path})` : 'transparent';
        setTimeout(() => {
            oldElement.remove();
        }, BACKDROP_HIDE_DURATION);
    }
    async function playSound(sound) {
        await playSoundRaw(sound.path, false);
    }
    async function addCharacter(character, outfit, expression, location) {
        const element = h("div", { className: "character" });
        element.style.backgroundImage = `url(${expression.path})`;
        MARKUP.characterBounds.append(element);
        characterElements[character.id] = element;
        moveCharacterRaw(character.id, location);
    }
    async function removeCharacter(character, location) {
        const element = characterElements[character.id];
        element.classList.add('hide');
        moveCharacterRaw(character.id, location);
        await wait(CHARACTER_HIDE_DURATION);
        element.remove();
    }
    async function moveCharacter(character, location) {
        moveCharacterRaw(character.id, location);
        await wait(CHARACTER_MOVE_DURATION);
    }
    function moveCharacterRaw(characterID, location) {
        const element = characterElements[characterID];
        const percentage = {
            center: 0,
            left: -50,
            right: 50,
            default: safeFloatParse(element.style.left, 0),
        }[location];
        element.style.left = `${percentage}%`;
    }
    async function changeCharacterSprite(character, outfit, expression) {
        const imgUrl = expression.path;
        await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = e => resolve();
            img.onerror = e => reject(e);
            img.src = imgUrl;
        });
        const oldElement = characterElements[character.id];
        const newElement = oldElement.cloneNode();
        oldElement.parentNode?.insertBefore(newElement, oldElement.nextSibling);
        newElement.style.backgroundImage = `url(${imgUrl})`;
        characterElements[character.id] = newElement;
        oldElement.classList.add('hide');
        setTimeout(() => {
            oldElement.remove();
        }, CHARACTER_HIDE_DURATION);
    }
    async function displayText(text, speaker) {
        const skipPromise = createExposedPromise();
        textRevealPromise = skipPromise;
        if (speaker) {
            MARKUP.nameplate.textContent = speaker;
            MARKUP.nameplate.classList.remove('hide');
        }
        else {
            MARKUP.nameplate.classList.add('hide');
        }
        MARKUP.dialogue.textContent = '';
        MARKUP.caret.classList.add('hide');
        const parts = text.split(/\b/g);
        for (const part of parts) {
            for (const char of part) {
                await Promise.any([skipPromise, waitForNextFrame()]);
                const span = h("span", null, char);
                MARKUP.dialogue.append(span);
                Promise.any([skipPromise, wait(TEXT_HIDE_DURATION)]).then(() => {
                    const textNode = document.createTextNode(char);
                    span.replaceWith(textNode);
                    textNode.parentElement?.normalize();
                });
                await Promise.any([skipPromise, wait(({
                        ' ': 16,
                        ',': 256,
                        '.': 512,
                        '?': 512,
                        '!': 512,
                        '\n': 512,
                    })[char] ?? 32)]);
            }
        }
        if (textRevealPromise === skipPromise) {
            textRevealPromise.resolve();
            textRevealPromise = null;
            MARKUP.caret.classList.remove('hide');
        }
        await INTERFACE.waitForAdvance();
    }
    async function presentChoice(options) {
        const promise = createExposedPromise();
        MARKUP.caret.classList.add('hide');
        let choiceElements = options.map(o => h("div", { className: "choice", onclick: e => {
                e.preventDefault();
                e.stopPropagation();
                playSoundRaw('./engine/assets/click.mp3', true);
                promise.resolve(o);
            } }, o.text));
        for (const el of choiceElements) {
            MARKUP.choiceList.append(el);
        }
        const chosenOption = await promise;
        for (const el of choiceElements) {
            el.classList.add('hide');
        }
        setTimeout(() => {
            for (const el of choiceElements) {
                el.remove();
            }
        }, CHOICE_HIDE_DURATION);
        await chosenOption.onSelect();
    }
    function clickAdvance(e) {
        e.preventDefault();
        e.stopPropagation();
        playSoundRaw('./engine/assets/click.mp3', true);
        if (textRevealPromise) {
            textRevealPromise.resolve();
        }
        else if (advancePromise) {
            advancePromise.resolve();
        }
    }
    async function waitForAdvance() {
        const promise = createExposedPromise();
        advancePromise = promise;
        await promise;
        if (advancePromise === promise)
            advancePromise = null;
    }
    async function tryInitializeAudio() {
        if (!audioContext) {
            audioContext = new AudioContext();
        }
        if (audioContext.state !== 'running') {
            await audioContext.resume();
        }
    }
    const audioBufferCache = {};
    async function playSoundRaw(path, cache) {
        let audioData;
        if (audioBufferCache[path]) {
            audioData = audioBufferCache[path];
        }
        else {
            const response = await fetch(path);
            const buffer = await response.arrayBuffer();
            await tryInitializeAudio();
            audioData = await audioContext.decodeAudioData(buffer);
            if (cache) {
                audioBufferCache[path] = audioData;
            }
        }
        const srcNode = new AudioBufferSourceNode(audioContext, { buffer: audioData });
        const gainNode = new GainNode(audioContext, { gain: 1 });
        srcNode.connect(gainNode);
        gainNode.connect(audioContext.destination);
        srcNode.start();
    }
    requestAnimationFrame(() => {
        MARKUP.main.addEventListener('click', clickAdvance);
        window.addEventListener('keydown', e => {
            let isHandled = true;
            if (e.key === 'Escape') {
                if (MONACO.isCodeEditorOpen()) {
                    MONACO.setCodeEditorOpen(false);
                }
                else {
                    MONACO.setCodeEditorOpen(true);
                    const project = INTERPRETER.getCurrentProject();
                    const story = INTERPRETER.getCurrentStory();
                    const action = INTERPRETER.getCurrentAction();
                    if (project && story && action) {
                        MONACO.loadFile(project, project.files[action.range.file], action.range);
                    }
                }
            }
            else {
                isHandled = false;
            }
            if (isHandled) {
                e.preventDefault();
                e.stopPropagation();
            }
        });
    });
    return {
        loadMainMenu,
        loadStory,
        resetStory,
        addCharacter,
        removeCharacter,
        moveCharacter,
        changeCharacterSprite,
        changeBackdrop,
        playSound,
        displayText,
        presentChoice,
        waitForAdvance,
    };
})();
const INTERPRETER = (() => {
    let currentProject = null;
    let currentStory = null;
    let currentAction = null;
    async function runProject(project) {
        currentProject = project;
        await INTERFACE.loadStory(project);
        const story = {
            history: [],
            state: {
                passageID: null,
                backdropID: null,
                characters: {},
                variables: {},
            },
        };
        currentStory = story;
        const initialPassage = Object.values(project.definition.passages)[0];
        if (!initialPassage) {
            throw new InterpreterError(Object.values(project.files)[0], { row: 0, start: 0, end: 1 }, `This story contains no passage definitions! You must have at least one passage.`);
        }
        updateStoryState(story, s => ({
            ...s,
            passageID: initialPassage.id,
        }));
        await runPassage(project, story, initialPassage);
    }
    async function runPassage(project, story, passage) {
        await runActionList(project, story, passage.actions);
    }
    async function runActionList(project, story, actions) {
        for (let i = 0; i < actions.length; i++) {
            const action = actions[i];
            currentAction = action;
            const actionMap = {
                continue: async (a) => {
                    const passages = Object.values(project.definition.passages);
                    const currentIndex = passages.findIndex(p => p?.id === story.state.passageID);
                    const nextPassage = passages[currentIndex + 1];
                    if (!nextPassage) {
                        throw new InterpreterError(project.files[a.range.file], a.range, `There is no passage after '${story.state.passageID}' to continue to!`);
                    }
                    pushState(story, nextPassage.id);
                    await runPassage(project, story, nextPassage);
                },
                goto: async (a) => {
                    const nextPassage = project.definition.passages[a.passageID];
                    if (!nextPassage) {
                        throw new InterpreterError(project.files[a.range.file], a.range, `There is no passage named '${a.passageID}' to go to!`);
                    }
                    pushState(story, nextPassage.id);
                    await runPassage(project, story, nextPassage);
                },
                end: async (a) => {
                    throw new InterpreterError(project.files[a.range.file], a.range, `End of story reached!`);
                },
                backdropChange: async (a) => {
                    const backdrop = project.definition.backdrops[a.backdropID];
                    if (!backdrop)
                        throw new InterpreterError(project.files[a.range.file], a.range, `There are no defined backdrops named '${a.backdropID}'!`);
                    await INTERFACE.changeBackdrop(backdrop);
                },
                playSound: async (a) => {
                    const sound = project.definition.sounds[a.soundID];
                    if (!sound)
                        throw new InterpreterError(project.files[a.range.file], a.range, `There are no defined sounds named '${a.soundID}'!`);
                    await INTERFACE.playSound(sound);
                },
                narration: async (a) => {
                    const text = resolveVariableValue(project, story, a.textRange, a.text, null, true);
                    if (!isVariableValueType(text, 'string')) {
                        throw new InterpreterError(project.files[a.range.file], a.textRange, `Narration actions must be given a text value but instead this was a '${getVariableValueType(text)}'`);
                    }
                    await INTERFACE.displayText(text.string, null);
                },
                option: async (a) => {
                    const options = [a];
                    while (actions[i + 1]?.type === 'option') {
                        options.push(actions[i + 1]);
                        i++;
                    }
                    const choices = [];
                    for (const o of options) {
                        const text = resolveVariableValue(project, story, o.textRange, o.text, null, true);
                        if (!isVariableValueType(text, 'string')) {
                            throw new InterpreterError(project.files[o.range.file], o.textRange, `Option actions must be given a text value but instead this was a '${getVariableValueType(text)}'`);
                        }
                        choices.push({
                            text: text.string,
                            onSelect: async () => await runActionList(project, story, o.actions),
                        });
                    }
                    await INTERFACE.presentChoice(choices);
                },
                characterEntry: async (a) => {
                    const character = project.definition.characters[a.characterID];
                    if (!character)
                        throw new InterpreterError(project.files[a.range.file], a.range, `There are no defined characters named '${a.characterID}'!`);
                    const outfit = Object.values(character.outfits)[0];
                    if (!outfit)
                        throw new InterpreterError(project.files[a.range.file], a.range, `There are no defined outfits for character named '${character.id}'!`);
                    const expression = Object.values(outfit.expressions)[0];
                    if (!expression)
                        throw new InterpreterError(project.files[a.range.file], a.range, `There are no defined expressions for outfit named '${outfit.id}' in character named '${character.id}'!`);
                    await INTERFACE.addCharacter(character, outfit, expression, a.location);
                },
                characterExit: async (a) => {
                    const character = project.definition.characters[a.characterID];
                    if (!character)
                        throw new InterpreterError(project.files[a.range.file], a.range, `There are no defined characters named '${a.characterID}'!`);
                    await INTERFACE.removeCharacter(character, a.location);
                },
                characterMove: async (a) => {
                    const character = project.definition.characters[a.characterID];
                    if (!character)
                        throw new InterpreterError(project.files[a.range.file], a.range, `There are no defined characters named '${a.characterID}'!`);
                    await INTERFACE.moveCharacter(character, a.location);
                },
                characterSpeech: async (a) => {
                    const character = project.definition.characters[a.characterID];
                    if (!character)
                        throw new InterpreterError(project.files[a.range.file], a.range, `There are no defined characters named '${a.characterID}'!`);
                    const text = resolveVariableValue(project, story, a.textRange, a.text, a.characterID, true);
                    if (!isVariableValueType(text, 'string')) {
                        throw new InterpreterError(project.files[a.range.file], a.textRange, `Character speech actions must be given a text value but instead this was a '${getVariableValueType(text)}'`);
                    }
                    await INTERFACE.displayText(text.string, character.name);
                },
                characterExpressionChange: async (a) => {
                    const character = project.definition.characters[a.characterID];
                    if (!character)
                        throw new InterpreterError(project.files[a.range.file], a.range, `There are no defined characters named '${a.characterID}'!`);
                    const outfit = character.outfits[story.state.characters[a.characterID]?.outfitID ?? ''] ?? Object.values(character.outfits)[0];
                    if (!outfit)
                        throw new InterpreterError(project.files[a.range.file], a.range, `There are no defined outfits in character named '${character.id}'!`);
                    const expression = outfit.expressions[a.expressionID];
                    if (!expression)
                        throw new InterpreterError(project.files[a.range.file], a.range, `There are no defined expressions named '${a.expressionID}' for outfit named '${outfit.id}' in character named '${character.id}'!`);
                    await INTERFACE.changeCharacterSprite(character, outfit, expression);
                },
                characterOutfitChange: async (a) => {
                    const character = project.definition.characters[a.characterID];
                    if (!character)
                        throw new InterpreterError(project.files[a.range.file], a.range, `There are no defined characters named '${a.characterID}'!`);
                    const outfit = character.outfits[a.outfitID];
                    if (!outfit)
                        throw new InterpreterError(project.files[a.range.file], a.range, `There are no defined outfits named '${a.outfitID}' in character named '${character.id}'!`);
                    const expression = outfit.expressions[story.state.characters[a.characterID]?.expressionID ?? ''] ?? Object.values(outfit.expressions)[0];
                    if (!expression)
                        throw new InterpreterError(project.files[a.range.file], a.range, `There are no defined expressions for outfit named '${outfit.id}' in character named '${character.id}'!`);
                    await INTERFACE.changeCharacterSprite(character, outfit, expression);
                },
                check: async (a) => {
                    const left = getVariableValue(project, story, a.range, a.variableID, a.characterID, false);
                    const right = resolveVariableValue(project, story, a.range, a.value, a.characterID, true);
                    let valid = false;
                    let comparisonMap = {};
                    if (getVariableValueType(left) === getVariableValueType(right)) {
                        comparisonMap = {
                            ...comparisonMap,
                            '==': () => structuralEquality(left, right),
                            '!=': () => !structuralEquality(left, right),
                        };
                    }
                    if (isVariableValueType(left, 'number') && isVariableValueType(right, 'number')) {
                        comparisonMap = {
                            ...comparisonMap,
                            '<': () => left.number < right.number,
                            '<=': () => left.number <= right.number,
                            '>': () => left.number > right.number,
                            '>=': () => left.number >= right.number,
                        };
                    }
                    else if (isVariableValueType(left, 'string') && isVariableValueType(right, 'string')) {
                        comparisonMap = {
                            ...comparisonMap,
                            'C': () => left.string.includes(right.string),
                            '!C': () => !left.string.includes(right.string),
                        };
                    }
                    else if (isVariableValueType(left, 'list')) {
                        comparisonMap = {
                            ...comparisonMap,
                            'C': () => left.list.some(v => structuralEquality(v, right)),
                            '!C': () => !left.list.some(v => structuralEquality(v, right)),
                        };
                    }
                    else if (isVariableValueType(left, 'map')) {
                        comparisonMap = {
                            ...comparisonMap,
                            'C': () => Object.values(left.map).some(v => structuralEquality(v, right)),
                            '!C': () => !Object.values(left.map).some(v => structuralEquality(v, right)),
                        };
                    }
                    const comparisonOp = comparisonMap[a.comparison];
                    if (comparisonOp) {
                        valid = comparisonOp();
                    }
                    else {
                        throw new InterpreterError(project.files[a.range.file], a.range, `Variable '${a.variableID}' is a '${getVariableValueType(left)}', which cannot be compared with a '${getVariableValueType(right)}' in this way!`);
                    }
                    if (valid) {
                        await runActionList(project, story, a.actions);
                    }
                },
                varSet: async (a) => {
                    const left = getVariableValue(project, story, a.range, a.variableID, a.characterID, false);
                    const right = resolveVariableValue(project, story, a.range, a.value, a.characterID, true);
                    updateVariableValue(story, a.variableID, right, a.characterID);
                },
                varAdd: async (a) => {
                    const left = getVariableValue(project, story, a.range, a.variableID, a.characterID, false);
                    const right = resolveVariableValue(project, story, a.range, a.value, a.characterID, true);
                    if (isVariableValueType(left, 'number') && isVariableValueType(right, 'number')) {
                        updateVariableValue(story, a.variableID, { number: left.number + right.number }, a.characterID);
                    }
                    else if (isVariableValueType(left, 'string') && isVariableValueType(right, 'string')) {
                        updateVariableValue(story, a.variableID, { string: left.string + right.string }, a.characterID);
                    }
                    else if (isVariableValueType(left, 'list')) {
                        updateVariableValue(story, a.variableID, { list: [...left.list, right] }, a.characterID);
                    }
                    else if (isVariableValueType(left, 'map')) {
                        if (!a.key)
                            throw new InterpreterError(project.files[a.range.file], a.range, `Variable '${a.variableID}' is a 'map' variable, which means any additions to it must have a text key specified!`);
                        const key = resolveVariableValue(project, story, a.range, a.key, a.characterID, true);
                        if (!isVariableValueType(key, 'string'))
                            throw new InterpreterError(project.files[a.range.file], a.range, `Variable '${a.variableID}' is a 'map' variable, which means any additions to it must have a text key specified, but the key value had type '${getVariableValueType(key)}' instead!`);
                        updateVariableValue(story, a.variableID, { map: { ...left.map, [key.string]: right } }, a.characterID);
                    }
                    else {
                        throw new InterpreterError(project.files[a.range.file], a.range, `Variable '${a.variableID}' is a '${getVariableValueType(left)}', which cannot have a value of type '${getVariableValueType(right)}' added to it!`);
                    }
                },
                varSubtract: async (a) => {
                    const left = getVariableValue(project, story, a.range, a.variableID, a.characterID, false);
                    const right = resolveVariableValue(project, story, a.range, a.value, a.characterID, true);
                    if (isVariableValueType(left, 'number') && isVariableValueType(right, 'number')) {
                        updateVariableValue(story, a.variableID, { number: left.number - right.number }, a.characterID);
                    }
                    else if (isVariableValueType(left, 'list')) {
                        updateVariableValue(story, a.variableID, { list: [...left.list, right] }, a.characterID);
                    }
                    else if (isVariableValueType(left, 'map') && isVariableValueType(right, 'string')) {
                        const map = { ...left.map };
                        delete map[right.string];
                        updateVariableValue(story, a.variableID, { map }, a.characterID);
                    }
                    else {
                        throw new InterpreterError(project.files[a.range.file], a.range, `Variable '${a.variableID}' is a '${getVariableValueType(left)}', which cannot have a value of type '${getVariableValueType(right)}' subtracted from it!`);
                    }
                },
            };
            const actionFunc = actionMap[action.type];
            if (actionFunc) {
                await actionFunc(action);
            }
            else {
                throw new InterpreterError(project.files[action.range.file], action.range, `The passage action type '${action.type}' is not yet supported!`);
            }
        }
    }
    function updateCharacterState(story, characterID, updater) {
        updateStoryState(story, s => ({
            ...s,
            characters: {
                ...s.characters,
                [characterID]: {
                    ...(updater((story.state.characters[characterID] ?? { expressionID: null, outfitID: null, location: 'default', variables: {} }))),
                },
            }
        }));
    }
    function updateStoryState(story, updater) {
        story.state = {
            ...updater(story.state)
        };
    }
    function updateVariableValue(story, variableID, newValue, characterID) {
        if (characterID) {
            updateCharacterState(story, characterID, c => ({
                ...c,
                variables: {
                    ...c.variables,
                    [variableID]: newValue
                }
            }));
        }
        else {
            updateStoryState(story, s => ({
                ...s,
                variables: {
                    ...s.variables,
                    [variableID]: newValue,
                }
            }));
        }
    }
    function getVariableValue(project, story, range, variableID, characterID, allowGlobals) {
        const rawValue = getVariableValueRaw(project, story, variableID, characterID, allowGlobals);
        if (!rawValue) {
            throw new InterpreterError(project.files[range.file], range, `No variable named '${variableID}' is defined!`);
        }
        const resolvedValue = resolveVariableValue(project, story, range, rawValue, characterID, allowGlobals);
        return resolvedValue;
    }
    function resolveVariableValue(project, story, range, value, characterID, allowGlobals) {
        let unrollCount = 100;
        while ((unrollCount--) > 0 && isVariableValueType(value, 'variable')) {
            const unrolledValue = getVariableValueRaw(project, story, value.variable, characterID, allowGlobals);
            if (!unrolledValue) {
                throw new InterpreterError(project.files[range.file], range, `No variable named '${value.variable}' is defined!`);
            }
            value = unrolledValue;
        }
        if (isVariableValueType(value, 'string')) {
            const file = project.files[range.file];
            const subTokens = file.tokens.filter(t => t.range.row === range.row && t.range.start > range.start && t.range.end < range.end);
            if (subTokens.length) {
                let resolvedValue = '';
                for (let i = range.start + 1; i < range.end - 1; i++) {
                    const subToken = subTokens.find(t => t.range.start === i);
                    if (subToken) {
                        if (subToken.type === 'variable') {
                            const value = getVariableValue(project, story, { file: file.path, ...subToken.range }, subToken.text, characterID, allowGlobals);
                            const str = printVariableValue(value);
                            resolvedValue += str;
                            i = subToken.range.end - 1;
                        }
                        else {
                            throw new InterpreterError(file, subToken.range, `Cannot handle this kind of element within a text value: ${subToken.type}`);
                        }
                    }
                    else {
                        resolvedValue += file.lines[range.row][i];
                    }
                }
                return { string: resolvedValue };
            }
        }
        return value;
    }
    function getVariableValueRaw(project, story, variableID, characterID, allowGlobals) {
        if (characterID) {
            const characterVariables = story.state.characters[characterID]?.variables;
            if (characterVariables) {
                const characterVariable = characterVariables[variableID];
                if (characterVariable) {
                    return characterVariable;
                }
            }
            const characterDef = project.definition.characters[characterID];
            if (characterDef) {
                const characterVariableDef = characterDef.variables[variableID];
                if (characterVariableDef) {
                    return characterVariableDef.initialValue;
                }
            }
            const castVariableDef = project.definition.variables[variableID];
            if (castVariableDef && castVariableDef.scope === 'cast') {
                return castVariableDef.initialValue;
            }
        }
        if (!characterID || allowGlobals) {
            const globalVariable = story.state.variables[variableID];
            if (globalVariable) {
                return globalVariable;
            }
            const globalVariableDef = project.definition.variables[variableID];
            if (globalVariableDef && globalVariableDef.scope === 'global') {
                return globalVariableDef.initialValue;
            }
        }
        return null;
    }
    function isVariableValueType(value, type) {
        return getVariableValueType(value) === type;
    }
    function getVariableValueType(value) {
        return Object.keys(value)[0];
    }
    function getVariableJsonValue(value) {
        return Object.values(value)[0];
    }
    function printVariableValue(value) {
        if (isVariableValueType(value, 'string')) {
            return value.string;
        }
        else if (isVariableValueType(value, 'number')) {
            return value.number.toString();
        }
        else if (isVariableValueType(value, 'boolean')) {
            return value.boolean ? 'Yes' : 'No';
        }
        else if (isVariableValueType(value, 'null')) {
            return 'Nothing';
        }
        else if (isVariableValueType(value, 'list')) {
            return value.list.length ? prettyJoin(value.list.map(v => printVariableValue(v)), 'and') : 'Nothing';
        }
        else if (isVariableValueType(value, 'map')) {
            return Object.keys(value.map).length ? prettyJoin(Object.entries(value.map).map(([k, v]) => `${printVariableValue(v)} as ${k}`), 'and') : 'Nothing';
        }
        else if (isVariableValueType(value, 'variable')) {
            return value.variable;
        }
        else {
            return String(getVariableJsonValue(value));
        }
    }
    function structuralEquality(left, right) {
        if (getVariableValueType(left) !== getVariableValueType(right))
            return false;
        if (isVariableValueType(left, 'list') && isVariableValueType(right, 'list')) {
            return left.list.length === right.list.length && left.list.every((a, i) => structuralEquality(a, right.list[i]));
        }
        else if (isVariableValueType(left, 'map') && isVariableValueType(right, 'map')) {
            return Object.keys(left.map).length === Object.keys(right.map).length && Object.keys(left.map).every(k => structuralEquality(left.map[k], right.map[k]));
        }
        else {
            return getVariableJsonValue(left) === getVariableJsonValue(right);
        }
    }
    function pushState(story, newPassageID) {
        story.history = [...story.history, story.state];
        story.state = {
            ...story.state,
            passageID: newPassageID,
        };
    }
    function getCurrentProject() {
        return currentProject;
    }
    function getCurrentStory() {
        return currentStory;
    }
    function getCurrentAction() {
        return currentAction;
    }
    return {
        runProject,
        getCurrentProject,
        getCurrentStory,
        getCurrentAction,
    };
})();
const LANGUAGE = (() => {
    const variable = (definition) => ({ type: 'variable', definition });
    const identifier = (subType, definition) => ({ type: 'identifier', subType, definition });
    const number = () => ({ type: 'number' });
    const string = () => ({ type: 'string' });
    const keyword = (keyword) => ({ type: 'keyword', keyword });
    const any = (...any) => ({ type: 'any', any });
    const seq = (...seq) => ({ type: 'seq', seq });
    const optional = (optional) => ({ type: 'optional', optional });
    const eol = () => ({ type: 'eol' });
    const keywordMap = (keywords) => ({ type: 'any', any: Object.entries(keywords).map(([k, v]) => seq(keyword(k), v)) });
    const variableValue = () => any(variable(), number(), string(), identifier('value'));
    const comparisons = ['is not less than or equal to', 'is less than or equal to', 'is not less than', 'is less than', 'is not greater than or equal to', 'is greater than or equal to', 'is not greater than', 'is greater than', 'is not', 'is', 'does not contain', 'contains'];
    const locations = ['left', 'right', 'center'];
    const specialValues = ['yes', 'no', 'a list', 'a map', 'nothing'];
    const tokenMatches = (node, token, index = 0) => {
        if (!token)
            return node.type === 'eol';
        switch (node.type) {
            case 'variable': return token.type === 'variable';
            case 'identifier': return token.type === 'identifier' && node.subType === token.subType;
            case 'number': return token.type === 'number';
            case 'string': return token.type === 'string';
            case 'keyword': return token.type === 'keyword' && token.text === node.keyword;
            case 'any': return node.any.some(n => tokenMatches(n, token));
            case 'seq': return tokenMatches(node.seq[index], token);
            case 'optional': return tokenMatches(node.optional, token);
        }
        return false;
    };
    const getExpectedTokens = (node, tokens, index = 0) => {
        const token = tokens[index];
        switch (node.type) {
            case 'variable':
            case 'identifier':
            case 'number':
            case 'string':
            case 'keyword':
                return !tokenMatches(node, token) ? [node] : [];
            case 'any':
                const matched = node.any.find(n => tokenMatches(n, token));
                if (matched)
                    return getExpectedTokens(matched, tokens, index);
                return node.any.flatMap(n => getExpectedTokens(n, tokens, index));
            case 'seq':
                const results = [];
                for (let i = 0; i < node.seq.length; i++) {
                    const c = node.seq[i];
                    if (!tokenMatches(c, tokens[index + i])) {
                        results.push(...getExpectedTokens(c, tokens, index + i));
                        if (c.type !== 'optional')
                            return results;
                    }
                }
                return results;
            case 'optional':
                return getExpectedTokens(node.optional, tokens, index);
        }
        return [];
    };
    const getTokenLabel = (node) => {
        switch (node.type) {
            case 'number': return 'number';
            case 'string': return 'text';
            case 'keyword': return node.keyword;
            case 'variable': return 'variable name';
            case 'identifier':
                switch (node.subType) {
                    case 'character': return 'character name';
                    case 'outfit': return 'outfit name';
                    case 'expression': return 'expression name';
                    case 'backdrop': return 'backdrop name';
                    case 'sound': return 'sound name';
                    case 'passage': return 'passage name';
                    case 'comparison': return 'comparison';
                    case 'location': return 'location';
                    case 'value': return 'value';
                }
        }
    };
    const getTokenOptions = (project, node, characterID) => {
        switch (node.type) {
            case 'number': return [{ text: `0`, template: true }];
            case 'string': return [{ text: `""`, template: true }];
            case 'keyword': return [{ text: node.keyword }];
            case 'variable':
                if (node.definition)
                    return [{ text: `$newVar`, template: true }];
                const globalVariables = Object.values(project.definition.variables).filter(filterFalsy).map(v => ({ text: v.id }));
                if (characterID) {
                    const character = project.definition.characters[characterID];
                    if (character) {
                        const characterVariables = Object.values(character.variables).filter(filterFalsy).map(v => ({ text: v.id }));
                        return [...characterVariables, ...globalVariables];
                    }
                }
                return [...globalVariables];
            case 'identifier':
                if (node.definition)
                    return [{ text: `new_${node.subType}`, template: true }];
                switch (node.subType) {
                    case 'character': return Object.values(project.definition.characters).filter(filterFalsy).map(c => ({ text: c.id }));
                    case 'backdrop': return Object.values(project.definition.backdrops).filter(filterFalsy).map(c => ({ text: c.id }));
                    case 'sound': return Object.values(project.definition.sounds).filter(filterFalsy).map(c => ({ text: c.id }));
                    case 'passage': return Object.values(project.definition.passages).filter(filterFalsy).map(c => ({ text: c.id }));
                    case 'outfit': return Object.values(project.definition.characters[characterID ?? '']?.outfits ?? {}).filter(filterFalsy).map(c => ({ text: c.id }));
                    case 'expression': return Object.values(project.definition.characters[characterID ?? '']?.outfits ?? {}).filter(filterFalsy).flatMap(o => Object.values(o.expressions).filter(filterFalsy)).map(c => ({ text: c.id }));
                    case 'comparison': return comparisons.map(c => ({ text: c }));
                    case 'location': return locations.map(l => ({ text: l }));
                    case 'value': return specialValues.map(p => ({ text: p }));
                }
        }
    };
    const getSignatures = (node, prefix) => {
        switch (node.type) {
            case 'variable':
            case 'identifier':
            case 'number':
            case 'string':
            case 'keyword':
                return prefix.length ? prefix.map(p => [...p, node]) : [[node]];
            case 'optional':
                return [...getSignatures(node.optional, prefix), ...prefix];
            case 'any':
                return node.any.flatMap(n => getSignatures(n, prefix));
            case 'seq':
                let signatures = prefix;
                for (const c of node.seq) {
                    signatures = getSignatures(c, signatures);
                }
                return signatures;
            case 'eol':
                return prefix;
        }
    };
    const getActiveSignatures = (tokens, currentIndex) => {
        const results = [];
        for (let i = 0; i < LANGUAGE.signatures.length; i++) {
            const signature = LANGUAGE.signatures[i];
            let parameterIndex = -1;
            for (let j = 0; j < signature.length; j++) {
                const c = signature[j];
                const outOfRange = j >= tokens.length;
                const matches = tokenMatches(c, tokens[j]);
                if (!outOfRange && matches) {
                    parameterIndex = j;
                }
                if (!outOfRange && !matches) {
                    break;
                }
            }
            if (tokens.length && parameterIndex < 0)
                continue;
            results.push({ signature, parameterIndex });
        }
        const signatures = results.map(r => r.signature);
        const highestParamIndex = results.reduce((p, c) => Math.max(p, c.parameterIndex), -1);
        const match = results.find(r => r.parameterIndex === highestParamIndex);
        if (match)
            return { signatures, signatureIndex: signatures.indexOf(match.signature), signature: match.signature, parameterIndex: Math.min(currentIndex, match.parameterIndex) };
        return { signatures, signature: null, signatureIndex: -1, parameterIndex: -1 };
    };
    const definition = any(keywordMap({
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
    }), seq(identifier('character'), keywordMap({
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
    })));
    const findKeywords = (n, a) => n.type === 'keyword' ? [...a, n.keyword] : n.type === 'any' ? n.any.reduce((p, c) => findKeywords(c, p), a) : n.type === 'seq' ? n.seq.reduce((p, c) => findKeywords(c, p), a) : n.type === 'optional' ? findKeywords(n.optional, a) : a;
    const keywords = [...new Set(findKeywords(definition, [])).values()];
    const identifiers = [...new Set([...comparisons, ...locations, ...specialValues]).values()];
    const signatures = getSignatures(definition, []);
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
    };
})();
const MARKUP = (() => {
    function clickTrap(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    let currentBackdrop = h("div", { className: "backdrop" });
    const characterBounds = h("div", { id: "characterBounds" });
    const viewport = h("div", { id: "viewport", className: "closed" },
        currentBackdrop,
        characterBounds);
    const mainMenu = h("div", { id: "mainMenu", onclick: clickTrap },
        h("div", { className: "loader" }, makeLoadingSpinner()));
    const menu = h("div", { id: "menu", className: "closed", onclick: clickTrap });
    const codeFiles = h("div", { id: "codeFiles" });
    const codePane = h("div", { id: "codePane" });
    const codeEditor = h("div", { id: "codeEditor", className: "closed", onclick: clickTrap },
        codeFiles,
        codePane);
    const nameplate = h("div", { id: "nameplate" });
    const dialogue = h("div", { id: "dialogue" });
    const caret = h("div", { id: "caret" });
    const choiceList = h("div", { id: "choiceList" });
    const textbox = h("div", { id: "textbox", className: "closed" },
        nameplate,
        dialogue,
        caret,
        choiceList);
    const main = h("div", { id: "main" },
        viewport,
        textbox,
        mainMenu,
        menu,
        codeEditor);
    function makeLoadingSpinner() {
        const spinner = h("div", { className: "spinner" },
            h("div", null),
            h("div", null),
            h("div", null),
            h("div", null),
            h("div", null),
            h("div", null));
        return spinner;
    }
    document.body.append(main);
    return {
        currentBackdrop,
        characterBounds,
        viewport,
        mainMenu,
        menu,
        codeFiles,
        codePane,
        codeEditor,
        nameplate,
        dialogue,
        choiceList,
        caret,
        textbox,
        main,
        makeLoadingSpinner,
    };
})();
/// <reference path="../../node_modules/monaco-editor/monaco.d.ts" />
const MONACO = (() => {
    const LANG_ID = 'nova-vn';
    const SAVE_DELAY = 500;
    let loadingPromise = createExposedPromise();
    let currentProject = null;
    let currentFile = null;
    let currentEditor = null;
    let fileListItems = {};
    const savingPromises = {};
    const savingTimes = {};
    const savingSpinners = {};
    require.config({ paths: { 'vs': 'engine/monaco-editor' } });
    require(["vs/editor/editor.main"], () => {
        monaco.languages.register({ id: LANG_ID });
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
        });
        const tokenizerState = { clone: () => tokenizerState, equals: () => true };
        monaco.languages.setTokensProvider(LANG_ID, {
            getInitialState: () => tokenizerState,
            tokenize: (line) => {
                if (!line || !currentFile)
                    return { endState: tokenizerState, tokens: [] };
                const row = currentFile.lines.indexOf(line);
                const fileTokens = currentFile.tokens.filter(t => t.range.row === row);
                const TOKEN_TYPE_MAP = {
                    'unknown': '',
                    'keyword': 'keyword',
                    'identifier': 'type',
                    'variable': 'variable',
                    'string': 'string',
                    'number': 'number',
                };
                const tokens = fileTokens.map(t => ({ scopes: TOKEN_TYPE_MAP[t.type], startIndex: t.range.start }));
                return { endState: tokenizerState, tokens };
            },
        });
        monaco.languages.registerHoverProvider(LANG_ID, {
            async provideHover(model, position, cancellationToken) {
                if (!currentProject || !currentFile)
                    return null;
                const token = getTokenAtPosition(currentFile, position);
                if (!token)
                    return null;
                const contents = ({
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
                })[token.type];
                const context = getTokenContext(currentProject, currentFile, token);
                if (context) {
                    if (Array.isArray(context)) {
                        contents.push(context.map(c => `<img height="192" src="${c.path}">`).join(''));
                        contents.push(...context.map(c => c.path));
                    }
                    else if ('outfits' in context) {
                        contents[0] = `(Character) ${token.text} ("${context.name}")`;
                        const expr = Object.values(Object.values(context.outfits)[0]?.expressions ?? {})[0];
                        if (expr)
                            contents.push(`<img height="192" src="${expr.path}">`);
                    }
                    else if ('expressions' in context) {
                        contents.push(Object.values(context.expressions).filter(filterFalsy).map(c => `<img height="192" src="${c.path}">`).join(''));
                    }
                    else if ('path' in context) {
                        if (context.path.toLowerCase().endsWith('.png') || context.path.toLowerCase().endsWith('.jpg')) {
                            contents.push(`<img height="192" src="${context.path}">`);
                        }
                        else if (context.path.toLowerCase().endsWith('.wav') || context.path.toLowerCase().endsWith('.mp3')) {
                            INTERFACE.playSound(context);
                        }
                        contents.push(context.path);
                    }
                    else if ('scope' in context) {
                        contents[0] = `${context.scope === 'global' ? '(Global Variable)' : context.scope === 'cast' ? '(Cast Variable)' : context.scope === 'character' ? `(Character Variable: ${context.characterID})` : ''} ${token.text} (Initially: ${printVariableValue(context.initialValue)})`;
                    }
                }
                return {
                    contents: contents.map(c => ({ value: c, isTrusted: true, supportHtml: true, baseUri: { scheme: 'http' } })),
                    range: convertRangeToRange(token.range),
                };
            },
        });
        monaco.languages.registerDocumentHighlightProvider(LANG_ID, {
            async provideDocumentHighlights(model, position, cancellationToken) {
                if (!currentProject || !currentFile)
                    return null;
                const token = getTokenAtPosition(currentFile, position);
                if (!token)
                    return null;
                return getRangesWithSameContext(currentProject, currentFile, token).filter(t => t.file === currentFile?.path).map(r => ({ range: convertRangeToRange(r) }));
            },
        });
        monaco.languages.registerDefinitionProvider(LANG_ID, {
            provideDefinition(model, position, cancellationToken) {
                if (!currentProject || !currentFile)
                    return null;
                const token = getTokenAtPosition(currentFile, position);
                if (!token)
                    return null;
                const ctx = getTokenContext(currentProject, currentFile, token);
                if (ctx)
                    return Array.isArray(ctx) ? ctx.map(c => convertRangeToLocation(c.range)) : convertRangeToLocation(ctx.range);
            },
        });
        monaco.languages.registerReferenceProvider(LANG_ID, {
            provideReferences(model, position, context, cancellationToken) {
                if (!currentProject || !currentFile)
                    return null;
                const token = getTokenAtPosition(currentFile, position);
                if (!token)
                    return null;
                return getRangesWithSameContext(currentProject, currentFile, token).map(r => convertRangeToLocation(r));
            },
        });
        monaco.languages.registerRenameProvider(LANG_ID, {
            provideRenameEdits(model, position, newName, cancellationToken) {
                if (!currentProject || !currentFile)
                    return null;
                const token = getTokenAtPosition(currentFile, position);
                if (!token)
                    return null;
                const ranges = getRangesWithSameContext(currentProject, currentFile, token);
                if (!ranges.length)
                    return null;
                return { edits: ranges.map(r => ({ resource: monaco.Uri.parse(r.file), textEdit: { range: convertRangeToRange(r), text: newName }, versionId: monaco.editor.getModel(monaco.Uri.parse(r.file))?.getVersionId() })) };
            },
            resolveRenameLocation(model, position, cancellationToken) {
                if (!currentProject || !currentFile)
                    return null;
                const token = getTokenAtPosition(currentFile, position);
                if (!token)
                    return null;
                const ranges = getRangesWithSameContext(currentProject, currentFile, token);
                if (!ranges.length || (token.type !== 'identifier' && token.type !== 'variable'))
                    return { text: token.text, range: convertRangeToRange(token.range), rejectReason: 'You cannot rename this element.' };
                if (token.type === 'identifier' && (token.subType === 'comparison' || token.subType === 'location' || token.subType === 'value'))
                    return { text: token.text, range: convertRangeToRange(token.range), rejectReason: 'You cannot rename this element.' };
                return { text: token.text, range: convertRangeToRange(token.range) };
            },
        });
        monaco.languages.registerSignatureHelpProvider(LANG_ID, {
            signatureHelpTriggerCharacters: [' ', '\t'],
            signatureHelpRetriggerCharacters: [' ', '\t'],
            provideSignatureHelp(model, position, cancellationToken, context) {
                if (!currentProject || !currentFile)
                    return null;
                const token = getTokenAtPosition(currentFile, position);
                const lineTokens = currentFile.tokens.filter(t => t.range.row === position.lineNumber - 1);
                const previousTokens = lineTokens.filter(t => t.range.start <= position.column - 1);
                const isOnLastToken = previousTokens.length && previousTokens[previousTokens.length - 1] === token;
                const currentIndex = isOnLastToken ? previousTokens.length - 1 : previousTokens.length;
                const activeSig = LANGUAGE.getActiveSignatures(lineTokens, currentIndex);
                const signatures = activeSig.signatures.map(s => {
                    let paramSubsets = [];
                    let label = '';
                    for (const p of s) {
                        const start = label.length;
                        label += p.type === 'keyword' ? p.keyword : `'${LANGUAGE.getTokenLabel(p)}'`;
                        const end = label.length;
                        label += ' ';
                        paramSubsets.push([start, end]);
                    }
                    return {
                        label,
                        parameters: paramSubsets.map(p => ({ label: p })),
                    };
                });
                return {
                    value: {
                        signatures,
                        activeParameter: activeSig.parameterIndex + (isOnLastToken ? 0 : 1),
                        activeSignature: activeSig.signatureIndex,
                    },
                    dispose: () => { },
                };
            },
        });
        monaco.languages.registerCompletionItemProvider(LANG_ID, {
            triggerCharacters: [' ', '\t'],
            provideCompletionItems(model, position, context, cancellationToken) {
                if (!currentProject || !currentFile)
                    return { suggestions: [] };
                const token = getTokenAtPosition(currentFile, position);
                const previousTokens = currentFile.tokens.filter(t => t.range.row === position.lineNumber - 1 && t.range.end <= position.column - 1);
                const expected = LANGUAGE.getExpectedTokens(LANGUAGE.definition, previousTokens);
                const characterID = previousTokens.find(p => p.type === 'identifier' && p.subType === 'character')?.text ?? null;
                const options = expected.flatMap(e => LANGUAGE.getTokenOptions(currentProject, e, characterID));
                const range = token ? convertRangeToRange(token.range) : { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: position.column, endColumn: position.column };
                return {
                    suggestions: options.map(o => ({ label: o.text, kind: monaco.languages.CompletionItemKind.Variable, range, insertText: o.text, insertTextRules: o.template ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined })),
                };
            },
        });
        monaco.editor.registerEditorOpener({
            openCodeEditor(source, resource, selectionOrPosition) {
                if (!currentProject || !currentFile)
                    return false;
                const targetFile = Object.values(currentProject.files).filter(filterFalsy).find(f => monaco.Uri.parse(f.path).path === resource.path);
                if (targetFile) {
                    let range = null;
                    if (!selectionOrPosition)
                        range = null;
                    else if ('column' in selectionOrPosition)
                        range = getTokenAtPosition(targetFile, selectionOrPosition)?.range ?? null;
                    else
                        range = getTokenAtPosition(targetFile, { column: selectionOrPosition.startColumn, lineNumber: selectionOrPosition.startLineNumber })?.range ?? null;
                    loadFile(currentProject, targetFile, range);
                    return true;
                }
                return false;
            },
        });
        loadingPromise.resolve();
    });
    function getTokenAtPosition(file, position) {
        const token = file.tokens.find(t => t.range.row + 1 === position.lineNumber && t.range.start + 1 <= position.column && t.range.end + 1 >= position.column);
        return token;
    }
    function getTokenContext(project, file, token) {
        if (token.type === 'identifier' && token.subType) {
            if (token.subType === 'character') {
                const character = project.definition.characters[token.text];
                if (character)
                    return character;
            }
            else if (token.subType === 'outfit') {
                const characterID = file.tokens.find(t => t.range.row === token.range.row && t.subType === 'character')?.text;
                const character = project.definition.characters[characterID ?? ''];
                if (character) {
                    const outfit = character.outfits[token.text];
                    if (outfit)
                        return outfit;
                }
            }
            else if (token.subType === 'expression') {
                const characterID = file.tokens.find(t => t.range.row === token.range.row && t.subType === 'character')?.text;
                const character = project.definition.characters[characterID ?? ''];
                if (character) {
                    const possibleExpressions = Object.values(character.outfits).flatMap(o => o?.expressions[token.text]).filter(filterFalsy);
                    return possibleExpressions;
                }
            }
            else if (token.subType === 'backdrop') {
                const backdrop = project.definition.backdrops[token.text];
                if (backdrop)
                    return backdrop;
            }
            else if (token.subType === 'sound') {
                const sound = project.definition.sounds[token.text];
                if (sound)
                    return sound;
            }
            else if (token.subType === 'passage') {
                const passage = project.definition.passages[token.text];
                if (passage)
                    return passage;
            }
        }
        else if (token.type === 'variable') {
            const characterID = file.tokens.find(t => t.range.row === token.range.row && t.subType === 'character')?.text;
            if (characterID) {
                const character = project.definition.characters[characterID ?? ''];
                if (character) {
                    const variable = character.variables[token.text];
                    if (variable)
                        return variable;
                }
            }
            const variable = project.definition.variables[token.text];
            if (variable)
                return variable;
        }
        return null;
    }
    function getRangesWithSameContext(project, file, token) {
        const context = getTokenContext(project, file, token);
        const match = (a, b) => Array.isArray(a) && Array.isArray(b) ? a.every(v => b.includes(v)) : a !== null && a === b;
        const ranges = Object.values(project.files).filter(filterFalsy).flatMap(f => f.tokens.filter(t => match(context, getTokenContext(project, f, t))).map(t => ({ file: f.path, ...t.range })));
        return ranges;
    }
    function convertRangeToLocation(range) {
        return {
            uri: monaco.Uri.parse(range.file),
            range: convertRangeToRange(range),
        };
    }
    function convertRangeToRange(range) {
        return {
            startLineNumber: range.row + 1,
            endLineNumber: range.row + 1,
            startColumn: range.start + 1,
            endColumn: range.end + 1,
        };
    }
    async function makeFileList(project) {
        for (const el of Object.values(fileListItems)) {
            if (el)
                el.remove();
        }
        fileListItems = {};
        for (const file of Object.values(project.files)) {
            if (!file)
                continue;
            const el = h("div", { className: "file" },
                h("label", null, file.path));
            el.addEventListener('click', () => {
                makeCodeEditor(project, file, null);
            });
            if (file.path === currentFile?.path) {
                el.classList.add('selected');
            }
            MARKUP.codeFiles.append(el);
            fileListItems[file.path] = el;
        }
    }
    async function setDiagnosticMarkers(file, editor) {
        await loadingPromise;
        const markers = file.errors.map(e => ({
            message: e.msg,
            severity: monaco.MarkerSeverity.Error,
            ...convertRangeToRange(e.range),
        }));
        monaco.editor.setModelMarkers(editor.getModel(), LANG_ID, markers);
    }
    async function upsertModels(project) {
        await loadingPromise;
        for (const file of Object.values(project.files)) {
            if (file)
                await upsertModel(project, file);
        }
    }
    async function upsertModel(project, file) {
        await loadingPromise;
        const uri = monaco.Uri.parse(file.path);
        const value = file.lines.join('\n');
        let model;
        let existingModel = monaco.editor.getModel(uri);
        if (existingModel) {
            model = existingModel;
            if (model.getValue() !== value) {
                console.log('File was edited during save process; keeping editor copy as-is');
                //model.setValue(value)
            }
        }
        else {
            model = monaco.editor.createModel(value, LANG_ID, uri);
            let wasReset = false;
            model.onDidChangeContent(e => {
                if (wasReset) {
                    wasReset = false;
                    return;
                }
                requestAnimationFrame(() => {
                    if (NATIVE.isEnabled()) {
                        const currentSaveTime = Date.now();
                        savingTimes[file.path] = currentSaveTime;
                        if (!savingSpinners[file.path]) {
                            const spinner = MARKUP.makeLoadingSpinner();
                            fileListItems[file.path]?.appendChild(spinner);
                            savingSpinners[file.path] = spinner;
                        }
                        savingPromises[file.path] = (async () => {
                            await wait(SAVE_DELAY);
                            if (savingTimes[file.path] === currentSaveTime) {
                                await NATIVE.saveFile(file.path, model.getValue());
                                const newProject = await PARSER.parseStory(project.path);
                                await loadProject(newProject);
                                const newFile = newProject.files[file.path];
                                if (newFile) {
                                    await loadFile(newProject, newFile, null);
                                }
                                const spinner = savingSpinners[file.path];
                                if (spinner) {
                                    spinner.remove();
                                    delete savingSpinners[file.path];
                                }
                                delete savingPromises[file.path];
                            }
                        })();
                    }
                    else {
                        wasReset = true;
                        model.setValue(value);
                    }
                });
            });
        }
        return model;
    }
    async function updateCodeEditor(project, file) {
        await loadingPromise;
        if (!currentEditor)
            return;
        currentProject = project;
        currentFile = file;
        fileListItems[file.path]?.classList.add('selected');
        setDiagnosticMarkers(file, currentEditor);
        const model = currentEditor.getModel();
        model?.tokenization.resetTokenization();
    }
    async function makeCodeEditor(project, file, range) {
        await loadingPromise;
        if (currentEditor) {
            currentEditor.dispose();
            currentEditor = null;
        }
        if (currentFile) {
            fileListItems[currentFile.path]?.classList.remove('selected');
        }
        currentProject = project;
        currentFile = file;
        fileListItems[file.path]?.classList.add('selected');
        const model = await upsertModel(project, file);
        currentEditor = monaco.editor.create(MARKUP.codePane, {
            model: model,
            theme: 'vs-dark',
            automaticLayout: true,
        });
        await setDiagnosticMarkers(file, currentEditor);
        if (range) {
            const monacoRange = convertRangeToRange(range);
            currentEditor.revealRangeInCenter(monacoRange);
            currentEditor.setPosition({ lineNumber: monacoRange.startLineNumber, column: monacoRange.startColumn });
            currentEditor.focus();
        }
    }
    function getVariableValueType(value) {
        return Object.keys(value)[0];
    }
    function isVariableValueType(value, type) {
        return getVariableValueType(value) === type;
    }
    function printVariableValue(value) {
        if (isVariableValueType(value, 'boolean')) {
            return value.boolean ? 'yes' : 'no';
        }
        else if (isVariableValueType(value, 'number')) {
            return JSON.stringify(value.number);
        }
        else if (isVariableValueType(value, 'string')) {
            return JSON.stringify(value.string);
        }
        else if (isVariableValueType(value, 'null')) {
            return 'nothing';
        }
        else if (isVariableValueType(value, 'list')) {
            return 'a list';
        }
        else if (isVariableValueType(value, 'map')) {
            return 'a map';
        }
        else if (isVariableValueType(value, 'variable')) {
            return value.variable;
        }
        else {
            return JSON.stringify(value);
        }
    }
    function isCodeEditorOpen() {
        return !MARKUP.codeEditor.classList.contains('closed');
    }
    function setCodeEditorOpen(open) {
        MARKUP.codeEditor.classList.toggle('closed', !open);
    }
    async function loadProject(project) {
        await makeFileList(project);
        await upsertModels(project);
    }
    async function loadFile(project, file, range) {
        if (currentEditor && currentFile?.path === file?.path) {
            await updateCodeEditor(project, file);
        }
        else {
            await makeCodeEditor(project, file, range);
        }
    }
    return {
        loadProject,
        loadFile,
        isCodeEditorOpen,
        setCodeEditorOpen,
    };
})();
/// <reference path="../../node_modules/neutralinojs-types/index.d.ts" />
const NATIVE = (() => {
    const enabled = 'NL_VERSION' in window;
    let initialized = false;
    let loadingPromise = createExposedPromise();
    if (enabled) {
        console.log('Detected Neutralino');
        Neutralino.init();
        Neutralino.events.on('ready', () => {
            initialized = true;
            loadingPromise.resolve();
            console.log('Neutralino Initialized');
        });
    }
    else {
        console.log('Neutralino Not Detected');
    }
    function isEnabled() {
        return enabled;
    }
    async function waitForInitialize() {
        if (!initialized) {
            await loadingPromise;
        }
    }
    async function loadFile(path) {
        await waitForInitialize();
        const text = await Neutralino.filesystem.readFile(getProjectPath(path));
        return text;
    }
    async function saveFile(path, content) {
        await waitForInitialize();
        await Neutralino.filesystem.writeFile(getProjectPath(path), content);
    }
    async function listFiles(path) {
        await waitForInitialize();
        const stats = await Neutralino.filesystem.readDirectory(getProjectPath(path));
        return stats.filter(s => s.type === 'FILE').map(s => s.entry);
    }
    async function listDirectories(path) {
        await waitForInitialize();
        const stats = await Neutralino.filesystem.readDirectory(getProjectPath(path));
        return stats.filter(s => s.type === 'DIRECTORY').map(s => s.entry).filter(s => !['..', '.'].includes(s));
    }
    async function close() {
        await waitForInitialize();
        await Neutralino.app.exit();
    }
    function getProjectPath(path) {
        return `${NL_PATH}/${NL_PROJECT_DIR}/${path.replaceAll('..', '')}`;
    }
    return {
        isEnabled,
        waitForInitialize,
        loadFile,
        saveFile,
        listFiles,
        listDirectories,
        close,
    };
})();
const PARSER = (() => {
    // The default in OSX TextEdit and Windows Notepad; editors where it's configurable usually can just normalize on spaces or tabs
    const TABS_TO_SPACES = 8;
    const NETWORK_LOADER = async (path) => {
        const response = await fetch(path);
        if (!response.ok) {
            throw new Error(`Failed to fetch project file ${path}`);
        }
        const text = await response.text();
        return text;
    };
    async function parseStory(projectPath) {
        const project = {
            definition: {
                name: projectPath,
                characters: {},
                backdrops: {},
                sounds: {},
                passages: {},
                variables: {},
            },
            path: projectPath,
            files: {},
        };
        const mainFilePath = `${projectPath}/story.nvn`;
        await parseFile(project, mainFilePath, NETWORK_LOADER);
        await VALIDATOR.validateStory(project);
        return project;
    }
    async function parseFile(project, path, fileLookup) {
        const text = await fileLookup(path);
        const lines = text.split(/\r?\n/g);
        const file = {
            path,
            lines,
            lineStates: lines.map(() => ({ indent: 0 })),
            tokens: [],
            cursor: { row: 0, col: 0 },
            states: [],
            errors: [],
        };
        project.files[path] = file;
        while (file.cursor.row < file.lines.length) {
            await parseLine(project, file, fileLookup);
        }
        return file;
    }
    function checkEndOfLine(file, error) {
        if (!isOutOfBounds(file, file.cursor)) {
            const token = peekAny(file);
            throw new ParseError(file, token.range, `${error}, but this line has '${token.text}'.`);
        }
    }
    function parseKeywordSelect(file, optionMap, error) {
        const keywords = Object.keys(optionMap);
        for (const keyword of keywords) {
            const token = tryAdvance(file, peekKeyword(file, keyword));
            if (token) {
                return optionMap[keyword](token);
            }
        }
        const keywordList = prettyJoin(keywords, 'or');
        const token = peekAny(file);
        throw new ParseError(file, token.range, `${error} ${keywordList}, but this line has '${token.text}' instead.`);
    }
    function parseIdentifierSelect(file, subType, optionMap, error) {
        const identifiers = Object.keys(optionMap);
        for (const identifier of identifiers) {
            const token = tryAdvance(file, peekIdentifier(file, identifier, subType));
            if (token) {
                return optionMap[identifier](token);
            }
        }
        const identifierList = prettyJoin(identifiers, 'or');
        const token = peekAny(file);
        throw new ParseError(file, token.range, `${error} ${identifierList}, but this line has '${token.text}' instead.`);
    }
    function parseCharacterSubDefinition(project, file, character, indent) {
        advance(file, peekKeyword(file, 'has'), `Character sub-definitions must start with 'has'`);
        parseKeywordSelect(file, {
            outfit: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file, 'outfit'), `Outfit definitions must have a name that starts with a letter here`);
                const id = identifierToken.text;
                if (character.outfits[id]) {
                    throw new ParseError(file, identifierToken.range, `Outfits names must be unique, but you already have a outfit named '${id}' defined elsewhere for this character.`);
                }
                character.outfits[id] = {
                    id,
                    expressions: {},
                    range: getFileRange(file, identifierToken),
                };
                file.states.push({ indent, character, outfit: character.outfits[id] });
                checkEndOfLine(file, `Outfit definitions must not have anything here after the outfit name`);
            },
            variable: () => {
                parseVariableDefinition(project, file, 'character', character);
            },
        }, `Character sub-definitions must be an`);
    }
    function parseOutfitSubDefinition(project, file, character, outfit, indent) {
        advance(file, peekKeyword(file, 'with'), `Outfit sub-definitions must start with 'with'`);
        parseKeywordSelect(file, {
            expression: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file, 'expression'), `Expression definitions must have a name that starts with a letter here`);
                const id = identifierToken.text;
                if (outfit.expressions[id]) {
                    throw new ParseError(file, identifierToken.range, `Expression names must be unique, but you already have an expression named '${id}' defined elsewhere for this outfit.`);
                }
                outfit.expressions[id] = {
                    id,
                    path: `${project.path}/characters/${character.id}/${outfit.id}/${id}.png`,
                    range: getFileRange(file, identifierToken),
                };
                checkEndOfLine(file, `Expression definitions must not have anything here after the expression name`);
            }
        }, `Outfit sub-definitions must be an`);
    }
    function parseVariableDefinition(project, file, scope, character) {
        const scopeDisplay = scope.substring(0, 1).toUpperCase() + scope.substring(1);
        const varToken = advance(file, peekVariable(file), `${scopeDisplay} variable definitions must have a variable name that starts with the '$' symbol here`);
        tryAdvance(file, peekKeyword(file, 'which'));
        advance(file, peekKeyword(file, 'is'), `${scopeDisplay} variable definitions must have a default value here, starting with the word 'is'`);
        const valueToken = advance(file, peekVariableValue(file), `${scopeDisplay} variable definitions must have a default value specified here`);
        const id = varToken.text;
        const value = processVariableValue(file, valueToken);
        const type = Object.keys(value)[0];
        const parent = character ? character : project.definition;
        if (parent.variables[id]) {
            throw new ParseError(file, varToken.range, `Variable names must be unique, but you already have a variable named '${id}' defined elsewhere.`);
        }
        parent.variables[varToken.text] = {
            id,
            initialValue: value,
            scope,
            characterID: character?.id,
            type,
            range: getFileRange(file, varToken),
        };
        checkEndOfLine(file, `${scopeDisplay} variable definitions must not have anything here after the default value`);
    }
    function parseDefinition(project, file, indent) {
        parseKeywordSelect(file, {
            'global variable': () => {
                parseVariableDefinition(project, file, 'global');
            },
            'cast variable': () => {
                parseVariableDefinition(project, file, 'cast');
            },
            character: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file, 'character'), `Character definitions must have a name that starts with a letter here`);
                advance(file, peekKeyword(file, 'as'), `Character definitions must have a name here, starting with the word 'as', like 'as "Jane"'`);
                const nameToken = advance(file, peekString(file), `Character definitions must have a name here, contained in double-quotes, like 'as "Jane"'`);
                const id = identifierToken.text;
                const name = processVariableValueOfType(file, nameToken, 'string', `Character names must be enclosed in double-quotes, like '"Jane"'`).string;
                if (project.definition.characters[id]) {
                    throw new ParseError(file, identifierToken.range, `Character names must be unique, but you already have a character named '${id}' defined elsewhere.`);
                }
                project.definition.characters[id] = {
                    id,
                    name,
                    outfits: {},
                    variables: {},
                    range: getFileRange(file, identifierToken),
                };
                file.states.push({ indent: indent, character: project.definition.characters[id] });
                checkEndOfLine(file, `Character definitions must not have anything here after the name`);
            },
            backdrop: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file, 'backdrop'), `Backdrop definitions must have a name that starts with a letter here`);
                const id = identifierToken.text;
                let path = `${project.path}/backdrops/${id}.png`;
                if (tryAdvance(file, peekKeyword(file, 'from'))) {
                    const filenameToken = advance(file, peekString(file), `Backdrop definitions must have a file path here, enclosed in double-quotes, like 'from "bg.jpg"'`);
                    const filename = processVariableValueOfType(file, filenameToken, 'string', `Backdrop file paths must be enclosed in double-quotes, like '"bg.jpg"'`).string;
                    path = `${project.path}/backdrops/${filename}`;
                }
                if (project.definition.backdrops[id]) {
                    throw new ParseError(file, identifierToken.range, `Passage names must be unique, but you already have a backdrop named '${id}' defined elsewhere.`);
                }
                project.definition.backdrops[id] = {
                    id,
                    path,
                    range: getFileRange(file, identifierToken),
                };
                checkEndOfLine(file, `Backdrop definitions must not have anything here after the name`);
            },
            sound: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file, 'sound'), `Sound definitions must have a name that starts with a letter here`);
                const id = identifierToken.text;
                let path = `${project.path}/sound/${id}.mp3`;
                if (tryAdvance(file, peekKeyword(file, 'from'))) {
                    const filenameToken = advance(file, peekString(file), `Sound definitions must have a file path here, enclosed in double-quotes, like 'from "snd.wav"'`);
                    const filename = processVariableValueOfType(file, filenameToken, 'string', `Sound file paths must be enclosed in double-quotes, like '"snd.wav"'`).string;
                    path = `${project.path}/sounds/${filename}`;
                }
                if (project.definition.sounds[id]) {
                    throw new ParseError(file, identifierToken.range, `Sound names must be unique, but you already have a sound named '${id}' defined elsewhere.`);
                }
                project.definition.sounds[id] = {
                    id,
                    path,
                    range: getFileRange(file, identifierToken),
                };
                checkEndOfLine(file, `Sound definitions must not have anything here after the name`);
            },
            passage: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file, 'passage'), `Passage definitions must have a name that starts with a letter here`);
                const id = identifierToken.text;
                if (project.definition.passages[id]) {
                    throw new ParseError(file, identifierToken.range, `Passage names must be unique, but you already have a passage named '${id}' defined elsewhere.`);
                }
                project.definition.passages[id] = {
                    id,
                    actions: [],
                    range: getFileRange(file, identifierToken),
                };
                file.states.push({ indent: indent, passage: project.definition.passages[id] });
                checkEndOfLine(file, `Passage definitions must not have anything here after the name`);
            },
        }, `Definitions must be a`);
    }
    function parsePassageAction(project, file, passage, parent, indent) {
        const identifierToken = peekAnyIdentifier(file, 'character');
        const characterID = identifierToken?.text ?? '';
        const character = project.definition.characters[characterID];
        if (identifierToken && character) {
            const characterRange = getFileRange(file, identifierToken);
            advance(file, identifierToken, '');
            const optionMap = {
                enter: t => {
                    let location = 'default';
                    if (tryAdvance(file, peekKeyword(file, 'from'))) {
                        location = parseLocation(file, `Character entry location must be`);
                        checkEndOfLine(file, `Character entry actions must not have anything here after the location`);
                    }
                    else {
                        checkEndOfLine(file, `Character entry actions must not have anything here after the action name unless it's the word 'from' and a location, like 'from left'`);
                    }
                    parent.actions.push({ type: 'characterEntry', range: getFileRange(file, t), characterID, location, characterRange });
                },
                enters: t => optionMap.enter(t),
                exit: t => {
                    let location = 'default';
                    if (tryAdvance(file, peekKeyword(file, 'to'))) {
                        location = parseLocation(file, `Character exit location must be`);
                        checkEndOfLine(file, `Character exit actions must not have anything here after the location`);
                    }
                    else {
                        checkEndOfLine(file, `Character exit actions must not have anything here after the action name unless it's the word 'to' and a location, like 'to left'`);
                    }
                    parent.actions.push({ type: 'characterExit', range: getFileRange(file, t), characterID, location, characterRange });
                },
                exits: t => optionMap.exit(t),
                move: t => {
                    tryAdvance(file, peekKeyword(file, 'to'));
                    const location = parseLocation(file, `Character movement location must be`);
                    checkEndOfLine(file, `Character movement actions must not have anything here after the location`);
                    parent.actions.push({ type: 'characterMove', range: getFileRange(file, t), characterID, location, characterRange });
                },
                moves: t => optionMap.move(t),
                say: t => {
                    const textToken = advance(file, peekString(file), `Character speech actions must have the text to display here, enclosed in double-quotes, like '"Hello!"'`);
                    const text = processVariableValueOfType(file, textToken, 'string', `Character speech action text must be enclosed in double-quotes, like '"Hello!"'`);
                    checkEndOfLine(file, `Character speech actions must not have anything here after the speech text`);
                    parent.actions.push({ type: 'characterSpeech', range: getFileRange(file, t), characterID, text, textRange: getFileRange(file, textToken), characterRange });
                },
                says: t => optionMap.say(t),
                emote: t => {
                    const identifierToken = advance(file, peekAnyIdentifier(file, 'expression'), `Character expression change actions must have an expression name here`);
                    const expressionID = identifierToken.text;
                    checkEndOfLine(file, `Character expression change actions must not have anything here after the expression name`);
                    parent.actions.push({ type: 'characterExpressionChange', range: getFileRange(file, t), characterID, expressionID, characterRange, expressionRange: getFileRange(file, identifierToken) });
                },
                emotes: t => optionMap.emote(t),
                wear: t => {
                    const identifierToken = advance(file, peekAnyIdentifier(file, 'outfit'), `Character outfit change actions must have an outfit name here`);
                    const outfitID = identifierToken.text;
                    checkEndOfLine(file, `Character outfit change actions must not have anything here after the outfit name`);
                    parent.actions.push({ type: 'characterOutfitChange', range: getFileRange(file, t), characterID, outfitID, characterRange, outfitRange: getFileRange(file, identifierToken) });
                },
                wears: t => optionMap.wear(t),
                check: t => {
                    advance(file, peekKeyword(file, 'if'), `Character check actions must start with the word 'if' here`);
                    const variableToken = advance(file, peekVariable(file), `Character check actions must have a variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const comparison = parseComparison(file, `Character check actions must have a comparison here that is`);
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Character check actions must have a value specified here to compare against`));
                    checkEndOfLine(file, `Character check actions must not have anything here after the value`);
                    const checkAction = { type: 'check', range: getFileRange(file, t), variableID, comparison, value, actions: [], characterID, characterRange, variableRange: getFileRange(file, variableToken) };
                    parent.actions.push(checkAction);
                    file.states.push({ indent, passage, actionContainer: checkAction });
                },
                checks: t => optionMap.check(t),
                set: t => {
                    const variableToken = advance(file, peekVariable(file), `Character set actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    advance(file, peekKeyword(file, 'to'), `Character set actions must have the word 'to' here`);
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Character set actions must have a value specified here to store in the variable`));
                    checkEndOfLine(file, `Character set actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varSet', range: getFileRange(file, t), variableID, value, characterID, characterRange, variableRange: getFileRange(file, variableToken) });
                },
                sets: t => optionMap.set(t),
                add: t => {
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Character add actions must have a value specified here to add to the variable`));
                    advance(file, peekKeyword(file, 'to'), `Character add actions must have the word 'to' here`);
                    const variableToken = advance(file, peekVariable(file), `Character add actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    let key = undefined;
                    if (tryAdvance(file, peekKeyword(file, 'as'))) {
                        key = processVariableValue(file, advance(file, peekVariableValue(file), `Character add actions must have a key name here after the word 'as', like 'as "foo"'`));
                    }
                    checkEndOfLine(file, `Character add actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varAdd', range: getFileRange(file, t), variableID, value, key, characterID, characterRange, variableRange: getFileRange(file, variableToken) });
                },
                adds: t => optionMap.add(t),
                subtract: t => {
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Character subtract actions must have a value specified here to subtract from the variable`));
                    advance(file, peekKeyword(file, 'from'), `Character subtract actions must have the word 'form' here`);
                    const variableToken = advance(file, peekVariable(file), `Character subtract actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    checkEndOfLine(file, `Character subtract actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varSubtract', range: getFileRange(file, t), variableID, value, characterID, characterRange, variableRange: getFileRange(file, variableToken) });
                },
                subtracts: t => optionMap.subtract(t),
            };
            parseKeywordSelect(file, optionMap, `Character actions must be`);
        }
        else {
            parseKeywordSelect(file, {
                continue: t => {
                    checkEndOfLine(file, `Continuation options must not have anything here after 'continue'`);
                    parent.actions.push({ type: 'continue', range: getFileRange(file, t) });
                },
                'go to': t => {
                    const identifierToken = advance(file, peekAnyIdentifier(file, 'passage'), `Go-To actions must have a passage name here`);
                    const passageID = identifierToken.text;
                    checkEndOfLine(file, `Go-To actions must not have anything here after the passage name`);
                    parent.actions.push({ type: 'goto', range: getFileRange(file, t), passageID, passageRange: getFileRange(file, identifierToken) });
                },
                end: t => {
                    checkEndOfLine(file, `Ending options must not have anything here after 'end'`);
                    parent.actions.push({ type: 'end', range: getFileRange(file, t) });
                },
                display: t => {
                    const identifierToken = advance(file, peekAnyIdentifier(file, 'backdrop'), `Display actions must have a backdrop name here`);
                    const backdropID = identifierToken.text;
                    checkEndOfLine(file, `Display actions must not have anything here after the backdrop name`);
                    parent.actions.push({ type: 'backdropChange', range: getFileRange(file, t), backdropID, backdropRange: getFileRange(file, identifierToken) });
                },
                play: t => {
                    const identifierToken = advance(file, peekAnyIdentifier(file, 'sound'), `Play Sound actions must have a sound name here`);
                    const soundID = identifierToken.text;
                    checkEndOfLine(file, `Play Sound actions must not have anything here after the sound name`);
                    parent.actions.push({ type: 'playSound', range: getFileRange(file, t), soundID, soundRange: getFileRange(file, identifierToken) });
                },
                narrate: t => {
                    const textToken = advance(file, peekString(file), `Narration actions must have the text to display here, enclosed in double-quotes, like '"Hello!"'`);
                    const text = processVariableValueOfType(file, textToken, 'string', `Narration text must be enclosed in double-quotes, like '"Hello!"'`);
                    checkEndOfLine(file, `Narration actions must not have anything here after the narration text`);
                    parent.actions.push({ type: 'narration', range: getFileRange(file, t), text, textRange: getFileRange(file, textToken) });
                },
                option: t => {
                    const textToken = advance(file, peekString(file), `Passage options must have the text to display here, enclosed in double-quotes, like '"Pick Me"'`);
                    const text = processVariableValueOfType(file, textToken, 'string', `Passage option text must be enclosed in double-quotes, like '"Pick Me"'`);
                    checkEndOfLine(file, `Passage options must not have anything here after the option text`);
                    const optionDefinition = { type: 'option', range: getFileRange(file, t), text, textRange: getFileRange(file, textToken), actions: [] };
                    parent.actions.push(optionDefinition);
                    file.states.push({ indent, passage, actionContainer: optionDefinition });
                },
                check: t => {
                    advance(file, peekKeyword(file, 'if'), `Check actions must start with the word 'if' here`);
                    const variableToken = advance(file, peekVariable(file), `Check actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const comparison = parseComparison(file, `Check actions must have a comparison here that is`);
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Check actions must have a value specified here to compare against`));
                    checkEndOfLine(file, `Check actions must not have anything here after the value`);
                    const checkAction = { type: 'check', range: getFileRange(file, t), variableID, comparison, value, actions: [], characterID: null, characterRange: null, variableRange: getFileRange(file, variableToken) };
                    parent.actions.push(checkAction);
                    file.states.push({ indent, passage, actionContainer: checkAction });
                },
                set: t => {
                    const variableToken = advance(file, peekVariable(file), `Set actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    advance(file, peekKeyword(file, 'to'), `Set actions must have the word 'to' here`);
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Set actions must have a value specified here to store in the variable`));
                    checkEndOfLine(file, `Set actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varSet', range: getFileRange(file, t), variableID, value, characterID: null, characterRange: null, variableRange: getFileRange(file, variableToken) });
                },
                add: t => {
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Add actions must have a value specified here to add to the variable`));
                    advance(file, peekKeyword(file, 'to'), `Add actions must have the word 'to' here`);
                    const variableToken = advance(file, peekVariable(file), `Add actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    let key = undefined;
                    if (tryAdvance(file, peekKeyword(file, 'as'))) {
                        key = processVariableValue(file, advance(file, peekVariableValue(file), `Add actions must have a key name here after the word 'as', like 'as "foo"'`));
                    }
                    checkEndOfLine(file, `Add actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varAdd', range: getFileRange(file, t), variableID, value, key, characterID: null, characterRange: null, variableRange: getFileRange(file, variableToken) });
                },
                subtract: t => {
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Subtract actions must have a value specified here to subtract from the variable`));
                    advance(file, peekKeyword(file, 'from'), `Subtract actions must have the word 'from' here`);
                    const variableToken = advance(file, peekVariable(file), `Subtract actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    checkEndOfLine(file, `Subtract actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varSubtract', range: getFileRange(file, t), variableID, value, characterID: null, characterRange: null, variableRange: getFileRange(file, variableToken) });
                },
            }, `Passage actions must start with a defined character's name (in which case, did you forget to define them with 'define character ${characterID}' first?) or be`);
        }
    }
    async function parseInclude(project, file, fileLookup) {
        const pathToken = advance(file, peekString(file), `Include directives must have a file path here, enclosed in double-quotes, like '"chapter1.nvn"'`);
        const path = processVariableValueOfType(file, pathToken, 'string', `Include directive file paths must be enclosed in double-quotes, like '"chapter1.nvn"'`).string;
        const fullPath = `${project.path}/${path}`;
        checkEndOfLine(file, `Include directives must not have anything here after the file path`);
        await parseFile(project, fullPath, fileLookup);
    }
    function parseLocation(file, error) {
        const location = parseIdentifierSelect(file, 'location', {
            left: () => 'left',
            right: () => 'right',
            center: () => 'center',
        }, error);
        return location;
    }
    function parseComparison(file, error) {
        const comparison = parseIdentifierSelect(file, 'comparison', {
            'is not less than or equal to': () => '>',
            'is less than or equal to': () => '<=',
            'is not less than': () => '>=',
            'is less than': () => '<',
            'is not greater than or equal to': () => '<',
            'is greater than or equal to': () => '>=',
            'is not greater than': () => '<=',
            'is greater than': () => '>',
            'is not': () => '!=',
            'is': () => '==',
            'does not contain': () => '!C',
            'contains': () => 'C',
        }, error);
        return comparison;
    }
    async function parseLine(project, file, fileLookup) {
        if (!file.lines[file.cursor.row].trim().length) {
            file.cursor.row++;
            file.cursor.col = 0;
            return;
        }
        const indent = parseNextIndent(file);
        while (file.states.length && indent <= file.states[file.states.length - 1].indent) {
            file.states.pop();
        }
        const currentState = file.states.length ? file.states[file.states.length - 1] : null;
        try {
            if (currentState?.actionContainer && currentState.passage) {
                parsePassageAction(project, file, currentState.passage, currentState.actionContainer, indent);
            }
            else if (currentState?.passage) {
                parsePassageAction(project, file, currentState.passage, currentState.passage, indent);
            }
            else if (currentState?.character && !currentState.outfit) {
                parseCharacterSubDefinition(project, file, currentState.character, indent);
            }
            else if (currentState?.outfit && currentState.character) {
                parseOutfitSubDefinition(project, file, currentState.character, currentState.outfit, indent);
            }
            else {
                let includePromise = null;
                parseKeywordSelect(file, {
                    define: () => parseDefinition(project, file, indent),
                    include: () => includePromise = parseInclude(project, file, fileLookup),
                }, `Lines must start with`);
                if (includePromise)
                    await includePromise;
            }
        }
        catch (e) {
            if (e instanceof ParseError) {
                file.errors.push(e);
            }
            else {
                throw e;
            }
        }
        file.cursor.row++;
        file.cursor.col = 0;
    }
    function getCharAt(file, cursor) {
        return file.lines[cursor.row][cursor.col];
    }
    function isChar(file, cursor, char) {
        if (isOutOfBounds(file, cursor))
            return false;
        return getCharAt(file, cursor) === char;
    }
    function isOutOfBounds(file, cursor) {
        return cursor.row < 0 || cursor.row >= file.lines.length || cursor.col < 0 || cursor.col >= file.lines[cursor.row].length;
    }
    function isWhitespace(file, cursor) {
        if (isOutOfBounds(file, cursor))
            return false;
        const s = getCharAt(file, cursor);
        return s === ' ' || s === '\t';
    }
    function isAlpha(file, cursor) {
        if (isOutOfBounds(file, cursor))
            return false;
        const s = getCharAt(file, cursor);
        return (s >= 'a' && s <= 'z') || (s >= 'A' && s <= 'Z');
    }
    function isNumeric(file, cursor) {
        if (isOutOfBounds(file, cursor))
            return false;
        const s = getCharAt(file, cursor);
        return (s >= '0' && s <= '9');
    }
    function isIdentifierChar(file, cursor) {
        return isAlpha(file, cursor) || isNumeric(file, cursor) || isChar(file, cursor, '_');
    }
    function isWordBoundary(file, cursor) {
        if (isOutOfBounds(file, cursor))
            return true;
        const previousCursor = { row: cursor.row, col: cursor.col - 1 };
        if (isOutOfBounds(file, previousCursor))
            return true;
        if (isIdentifierChar(file, cursor) && !isIdentifierChar(file, previousCursor))
            return true;
        if (!isIdentifierChar(file, cursor) && isIdentifierChar(file, previousCursor))
            return true;
        return false;
    }
    function isWord(file, cursor, word) {
        if (!isWordBoundary(file, cursor))
            return false;
        if (!isWordBoundary(file, { row: cursor.row, col: cursor.col + word.length }))
            return false;
        for (let i = 0; i < word.length; i++) {
            if (isOutOfBounds(file, { row: cursor.row, col: cursor.col + i }))
                return false;
            if (!isChar(file, { row: cursor.row, col: cursor.col + i }, word[i]))
                return false;
        }
        return true;
    }
    function readRange(file, range) {
        return file.lines[range.row].slice(range.start, range.end);
    }
    function parseNextIndent(file) {
        let indent = 0;
        while (!isOutOfBounds(file, file.cursor)) {
            const s = getCharAt(file, file.cursor);
            if (s === ' ')
                indent++;
            else if (s === '\t')
                indent += TABS_TO_SPACES;
            else
                break;
            file.cursor.col++;
        }
        return indent;
    }
    function parseNextWhitespace(file) {
        while (isWhitespace(file, file.cursor)) {
            file.cursor.col++;
        }
        return;
    }
    function parseToken(file, type, row, start, end, subType) {
        const range = { row, start, end };
        const token = { type, range, text: readRange(file, range) };
        if (subType)
            token.subType = subType;
        return token;
    }
    function peek(file, type, length, subType) {
        const token = parseToken(file, type, file.cursor.row, file.cursor.col, file.cursor.col + length, subType);
        return token;
    }
    function peekAny(file) {
        const valueToken = peekVariableValue(file);
        if (valueToken)
            return valueToken;
        const variableToken = peekVariable(file);
        if (variableToken)
            return variableToken;
        if (isIdentifierChar(file, file.cursor) && isWordBoundary(file, file.cursor)) {
            const cursor = { ...file.cursor };
            do {
                cursor.col++;
            } while (!isWordBoundary(file, cursor));
            return peek(file, 'identifier', cursor.col - file.cursor.col);
        }
        else {
            return peek(file, 'unknown', 1);
        }
    }
    function advance(file, token, error) {
        if (!token) {
            const token = peekAny(file);
            throw new ParseError(file, token.range, `${error}, but this line has '${token.text}' instead.`);
        }
        file.tokens.push(token);
        file.cursor.col = token.range.end;
        parseNextWhitespace(file);
        return token;
    }
    function tryAdvance(file, token) {
        if (!token)
            return null;
        return advance(file, token, '');
    }
    function peekKeyword(file, keyword) {
        if (isWord(file, file.cursor, keyword)) {
            return peek(file, 'keyword', keyword.length);
        }
        return null;
    }
    function peekIdentifier(file, identifier, subType) {
        if (isWord(file, file.cursor, identifier)) {
            return peek(file, 'identifier', identifier.length, subType);
        }
        return null;
    }
    function peekAnyIdentifier(file, subType) {
        if (isIdentifierChar(file, file.cursor) && isWordBoundary(file, file.cursor)) {
            const cursor = { row: file.cursor.row, col: file.cursor.col + 1 };
            while (isIdentifierChar(file, cursor)) {
                cursor.col++;
            }
            const token = peek(file, 'identifier', cursor.col - file.cursor.col, subType);
            return token;
        }
        return null;
    }
    function peekVariable(file) {
        if (isChar(file, file.cursor, '$')) {
            const cursor = { row: file.cursor.row, col: file.cursor.col + 1 };
            while (isIdentifierChar(file, cursor)) {
                cursor.col++;
            }
            const token = peek(file, 'variable', cursor.col - file.cursor.col);
            return token;
        }
        return null;
    }
    function peekNumber(file) {
        if (isNumeric(file, file.cursor)) {
            const cursor = { row: file.cursor.row, col: file.cursor.col + 1 };
            while (isNumeric(file, cursor)) {
                cursor.col++;
            }
            if (isChar(file, cursor, '.')) {
                cursor.col++;
                while (isNumeric(file, cursor)) {
                    cursor.col++;
                }
            }
            const token = peek(file, 'number', cursor.col - file.cursor.col);
            return token;
        }
        return null;
    }
    function peekString(file) {
        if (isChar(file, file.cursor, '"')) {
            const cursor = { row: file.cursor.row, col: file.cursor.col + 1 };
            while (!isChar(file, cursor, '"') && !isOutOfBounds(file, cursor)) {
                cursor.col++;
            }
            if (isChar(file, cursor, '"')) {
                cursor.col++;
            }
            const token = peek(file, 'string', cursor.col - file.cursor.col);
            const subCursor = { row: token.range.row, col: token.range.start };
            while (subCursor.col < token.range.end) {
                if (isChar(file, subCursor, '$')) {
                    const start = subCursor.col;
                    subCursor.col++;
                    while (isIdentifierChar(file, subCursor)) {
                        subCursor.col++;
                    }
                    const end = subCursor.col;
                    const varToken = parseToken(file, 'variable', subCursor.row, start, end);
                    file.tokens.push(varToken);
                }
                subCursor.col++;
            }
            return token;
        }
        return null;
    }
    function peekVariableValue(file) {
        return peekVariable(file) ?? peekNumber(file) ?? peekString(file) ?? peekIdentifier(file, 'a list', 'value') ?? peekIdentifier(file, 'a map', 'value') ?? peekIdentifier(file, 'yes', 'value') ?? peekIdentifier(file, 'no', 'value') ?? peekIdentifier(file, 'nothing', 'value') ?? null;
    }
    function processVariableValue(file, token) {
        if (token.type === 'string')
            return { string: safeJsonParse(token.text, token.text) };
        else if (token.type === 'number')
            return { number: safeJsonParse(token.text, 0) };
        else if (token.type === 'variable')
            return { variable: token.text };
        else if (token.type === 'identifier') {
            if (token.text === 'yes')
                return { boolean: true };
            else if (token.text === 'no')
                return { boolean: false };
            else if (token.text === 'nothing')
                return { null: null };
            else if (token.text === 'a list')
                return { list: [] };
            else if (token.text === 'a map')
                return { map: {} };
        }
        throw new ParseError(file, token.range, `Could not determine the value of this expression: '${token.text}'`);
    }
    function processVariableValueOfType(file, token, type, error) {
        const value = processVariableValue(file, token);
        const actualType = Object.keys(value)[0];
        if (actualType !== type) {
            throw new ParseError(file, token.range, `${error}, but this line has '${token.text}'.`);
        }
        return value;
    }
    function getFileRange(file, token) {
        return { file: file.path, row: token.range.row, start: token.range.start, end: token.range.end };
    }
    return {
        parseStory,
    };
})();
class ParseError extends Error {
    file;
    range;
    msg;
    constructor(file, range, msg) {
        super(`An error was identified in a story file: ${msg}\nin ${file.path} at ${range.row}:${range.start}\n${file.lines[range.row]}\n${' '.repeat(range.start)}${'^'.repeat(Math.max(1, range.end - range.start))}`);
        this.file = file;
        this.range = range;
        this.msg = msg;
        this.name = 'ParseError';
    }
}
class ValidationError extends Error {
    file;
    range;
    msg;
    constructor(file, range, msg) {
        super(`An error was identified while validating a story file: ${msg}\nin ${file.path} at ${range.row}:${range.start}\n${file.lines[range.row]}\n${' '.repeat(range.start)}${'^'.repeat(Math.max(1, range.end - range.start))}`);
        this.file = file;
        this.range = range;
        this.msg = msg;
        this.name = 'ValidationError';
    }
}
class InterpreterError extends Error {
    file;
    range;
    msg;
    constructor(file, range, msg) {
        super(`An error was identified while running a story file: ${msg}\nin ${file.path} at ${range.row}:${range.start}\n${file.lines[range.row]}\n${' '.repeat(range.start)}${'^'.repeat(Math.max(1, range.end - range.start))}`);
        this.file = file;
        this.range = range;
        this.msg = msg;
        this.name = 'InterpreterError';
    }
}
function h(tag, props, ...children) {
    const e = document.createElement(tag);
    for (const key in props)
        e[key] = props[key];
    for (const child of children) {
        if (!child)
            continue;
        if (Array.isArray(child))
            e.append(...child);
        else
            e.append(child);
    }
    return e;
}
function createExposedPromise() {
    let externResolve;
    let externReject;
    let promise = new Promise((resolve, reject) => {
        externResolve = resolve;
        externReject = reject;
    });
    promise.resolve = externResolve;
    promise.reject = externReject;
    return promise;
}
function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(() => resolve(), ms);
    });
}
function waitForNextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
function tuple(...args) {
    return args;
}
function filterFalsy(v) {
    return !!v;
}
function safeJsonParse(s, defaultValue) {
    try {
        return JSON.parse(s);
    }
    catch (e) {
        return defaultValue;
    }
}
function safeFloatParse(s, defaultValue) {
    const v = parseFloat(s);
    if (Number.isNaN(v))
        return defaultValue;
    return v;
}
function prettyJoin(items, type) {
    return items.length > 1 ? items.map((v, i, a) => a.length && i === a.length - 1 && type ? `${type} '${v}'` : `'${v}'`).join(items.length > 2 ? ', ' : ' ') : items.length > 0 ? items[0] : '';
}
const VALIDATOR = (() => {
    async function validateStory(project) {
        for (const passage of Object.values(project.definition.passages).filter(filterFalsy)) {
            await validatePassage(project, passage);
        }
        for (const character of Object.values(project.definition.characters).filter(filterFalsy)) {
            await validateCharacter(project, character);
        }
        for (const backdrop of Object.values(project.definition.backdrops).filter(filterFalsy)) {
            await validateBackdrop(project, backdrop);
        }
        for (const sound of Object.values(project.definition.sounds).filter(filterFalsy)) {
            await validateSound(project, sound);
        }
    }
    async function validatePassage(project, passage) {
        await validateActionList(project, passage.actions);
    }
    async function validateActionList(project, actions) {
        for (const action of actions) {
            await validateAction(project, action);
        }
    }
    function validateCharacterAction(project, file, characterID, characterRange, actionName) {
        const character = project.definition.characters[characterID];
        if (!character) {
            throw new ValidationError(file, characterRange, `${actionName} actions must have a defined character name here. Did you forget to define it else where with 'define character ${characterID}'?`);
        }
        return character;
    }
    async function validateAction(project, action) {
        const file = project.files[action.range.file];
        try {
            const validationMap = {
                backdropChange: async (a) => {
                    const backdrop = project.definition.backdrops[a.backdropID];
                    if (!backdrop) {
                        throw new ValidationError(file, a.backdropRange, `Display actions must have a defined backdrop name here. Did you forget to define it elsewhere with 'define backdrop ${a.backdropID}'?`);
                    }
                },
                playSound: async (a) => {
                    const sound = project.definition.sounds[a.soundID];
                    if (!sound) {
                        throw new ValidationError(file, a.soundRange, `Play Sound actions must have a defined sound name here. Did you forget to define it elsewhere with 'define sound ${a.soundID}'?`);
                    }
                },
                goto: async (a) => {
                    const passage = project.definition.passages[a.passageID];
                    if (!passage) {
                        throw new ValidationError(file, a.passageRange, `Go-To actions must have a valid passage name here, but the passage specified here does not exist. Did you forget to define it elsewhere with 'define passage ${a.passageID}'?`);
                    }
                },
                check: async (a) => {
                    if (a.characterID && a.characterRange) {
                        const character = validateCharacterAction(project, file, a.characterID, a.characterRange, 'Character check');
                        const variable = character.variables[a.variableID] ?? project.definition.variables[a.variableID];
                        if (!variable || variable.scope === 'global') {
                            throw new ValidationError(file, a.variableRange, `Character check actions must have a defined character or cast variable name here. Did you forget to define it elsewhere with 'has variable ${a.variableID}' under a character definition?`);
                        }
                    }
                    else {
                        const variable = project.definition.variables[a.variableID];
                        if (!variable || variable.scope !== 'global') {
                            throw new ValidationError(file, a.variableRange, `Check actions must have a defined global variable name here. Did you forget to define it with 'define global variable ${a.variableID}'?`);
                        }
                    }
                    await validateActionList(project, a.actions);
                },
                varSet: async (a) => {
                    if (a.characterID && a.characterRange) {
                        const character = validateCharacterAction(project, file, a.characterID, a.characterRange, 'Character set');
                        const variable = character.variables[a.variableID] ?? project.definition.variables[a.variableID];
                        if (!variable || variable.scope === 'global') {
                            throw new ValidationError(file, a.variableRange, `Character set actions must have a defined character or cast variable name here. Did you forget to define it elsewhere with 'has variable ${a.variableID}' under a character definition?`);
                        }
                    }
                    else {
                        const variable = project.definition.variables[a.variableID];
                        if (!variable || variable.scope !== 'global') {
                            throw new ValidationError(file, a.variableRange, `Set actions must have a defined global variable name here. Did you forget to define it with 'define global variable ${a.variableID}'?`);
                        }
                    }
                },
                varAdd: async (a) => {
                    if (a.characterID && a.characterRange) {
                        const character = validateCharacterAction(project, file, a.characterID, a.characterRange, 'Character add');
                        const variable = character.variables[a.variableID] ?? project.definition.variables[a.variableID];
                        if (!variable || variable.scope === 'global') {
                            throw new ValidationError(file, a.variableRange, `Character add actions must have a defined character or cast variable name here. Did you forget to define it elsewhere with 'has variable ${a.variableID}' under a character definition?`);
                        }
                        if (variable.type === 'map' && !a.key) {
                            throw new ValidationError(file, a.range, `Character add actions for map variables must have a key name at the end after the word 'as', like 'as "foo"'`);
                        }
                    }
                    else {
                        const variable = project.definition.variables[a.variableID];
                        if (!variable || variable.scope !== 'global') {
                            throw new ValidationError(file, a.variableRange, `Add actions must have a defined global variable name here. Did you forget to define it with 'define global variable ${a.variableID}'?`);
                        }
                        if (variable.type === 'map' && !a.key) {
                            throw new ValidationError(file, a.range, `Add actions for map variables must have a key name at the end after the word 'as', like 'as "foo"'`);
                        }
                    }
                },
                varSubtract: async (a) => {
                    if (a.characterID && a.characterRange) {
                        const character = validateCharacterAction(project, file, a.characterID, a.characterRange, 'Character subtract');
                        const variable = character.variables[a.variableID] ?? project.definition.variables[a.variableID];
                        if (!variable || variable.scope === 'global') {
                            throw new ValidationError(file, a.variableRange, `Character subtract actions must have a defined character or cast variable name here. Did you forget to define it elsewhere with 'has variable ${a.variableID}' under a character definition?`);
                        }
                    }
                    else {
                        const variable = project.definition.variables[a.variableID];
                        if (!variable || variable.scope !== 'global') {
                            throw new ValidationError(file, a.variableRange, `Subtract actions must have a defined global variable name here. Did you forget to define it with 'define global variable ${a.variableID}'?`);
                        }
                    }
                },
                characterExpressionChange: async (a) => {
                    const character = validateCharacterAction(project, file, a.characterID, a.characterRange, 'Character expression change');
                    const expression = Object.values(character.outfits).flatMap(o => Object.values(o?.expressions ?? [])).find(e => e?.id === a.expressionID);
                    if (!expression) {
                        throw new ValidationError(file, a.expressionRange, `Character expression change actions must have a defined expression name here. Did you forget to define it with 'with expression ${a.expressionID}' under an outfit definition for character '${a.characterID}'?`);
                    }
                },
                characterOutfitChange: async (a) => {
                    const character = validateCharacterAction(project, file, a.characterID, a.characterRange, 'Character outfit change');
                    const outfit = Object.values(character.outfits).find(o => o?.id === a.outfitID);
                    if (!outfit) {
                        throw new ValidationError(file, a.outfitRange, `Character outfit change actions must have a defined outfit name here. Did you forget to define it with 'has outfit ${a.outfitID}' under the character definition for '${a.characterID}'?`);
                    }
                },
                option: async (a) => {
                    await validateActionList(project, a.actions);
                },
            };
            const validationFunc = validationMap[action.type];
            if (validationFunc)
                await validationFunc(action);
        }
        catch (e) {
            if (e instanceof ValidationError) {
                file.errors.push(e);
            }
            else {
                throw e;
            }
        }
    }
    async function validateCharacter(project, character) {
        for (const outfit of Object.values(character.outfits).filter(filterFalsy)) {
            await validateOutfit(project, outfit);
        }
    }
    async function validateOutfit(project, outfit) {
        for (const expression of Object.values(outfit.expressions).filter(filterFalsy)) {
            await validateExpression(project, expression);
        }
    }
    async function validateExpression(project, expression) {
        const file = project.files[expression.range.file];
        if (!await checkFileExists(expression.path)) {
            file.errors.push(new ValidationError(file, expression.range, `The image file for this expression ('${expression.path}') does not exist! Did you move or rename it?`));
        }
    }
    async function validateBackdrop(project, backdrop) {
        const file = project.files[backdrop.range.file];
        if (!await checkFileExists(backdrop.path)) {
            file.errors.push(new ValidationError(file, backdrop.range, `The image file for this backdrop ('${backdrop.path}') does not exist! Did you move or rename it?`));
        }
    }
    async function validateSound(project, sound) {
        const file = project.files[sound.range.file];
        if (!await checkFileExists(sound.path)) {
            file.errors.push(new ValidationError(file, sound.range, `The audio file for this sound ('${sound.path}') does not exist! Did you move or rename it?`));
        }
    }
    async function checkFileExists(path) {
        const response = await fetch(path);
        if (!response.ok) {
            return false;
        }
        return true;
    }
    return {
        validateStory,
    };
})();
//# sourceMappingURL=index.js.map