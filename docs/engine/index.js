"use strict";
const NETWORK_LOADER = async (path) => {
    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(`Failed to fetch project file ${path}`);
    }
    const text = await response.text();
    return text;
};
requestAnimationFrame(async () => {
    let project = null;
    if (!project) {
        try {
            project = await PARSER.parseStory('project', NETWORK_LOADER);
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
        project = await PARSER.parseStory('engine/docs_project', NETWORK_LOADER);
    }
    try {
        await MONACO.loadProject(project);
        for (const file of Object.values(project.files)) {
            if (file?.errors.length) {
                await MONACO.loadFile(project, file, file.errors[0].range);
            }
        }
        await INTERPRETER.runProject(project);
    }
    catch (e) {
        if (e instanceof ParseError || e instanceof InterpreterError) {
            console.error(e);
            e.file.errors.push(e);
            await MONACO.loadFile(project, e.file, e.range);
        }
        else {
            throw e;
        }
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
    async function reset() {
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
    }
    async function removeCharacter(character, location) {
        const element = characterElements[character.id];
        element.classList.add('hide');
        await wait(CHARACTER_HIDE_DURATION);
        element.remove();
    }
    async function moveCharacter(character, location) {
        await wait(CHARACTER_MOVE_DURATION);
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
        reset,
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
        await INTERFACE.reset();
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
                    await INTERFACE.displayText(a.text, null);
                },
                option: async (a) => {
                    let options = [a];
                    while (actions[i + 1]?.type === 'option') {
                        options.push(actions[i + 1]);
                        i++;
                    }
                    await INTERFACE.presentChoice(options.map(o => ({
                        text: o.text,
                        onSelect: async () => await runActionList(project, story, o.actions),
                    })));
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
                    await INTERFACE.displayText(a.text, project.definition.characters[a.characterID]?.name ?? null);
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
                    const left = getVariableValue(project, story, a.range, a.variableID, a.characterID);
                    const right = resolveVariableValue(project, story, a.range, a.value, a.characterID);
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
                    const left = getVariableValue(project, story, a.range, a.variableID, a.characterID);
                    const right = resolveVariableValue(project, story, a.range, a.value, a.characterID);
                    updateVariableValue(story, a.variableID, right, a.characterID);
                },
                varAdd: async (a) => {
                    const left = getVariableValue(project, story, a.range, a.variableID, a.characterID);
                    const right = resolveVariableValue(project, story, a.range, a.value, a.characterID);
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
                        const key = resolveVariableValue(project, story, a.range, a.key, a.characterID);
                        if (!isVariableValueType(key, 'string'))
                            throw new InterpreterError(project.files[a.range.file], a.range, `Variable '${a.variableID}' is a 'map' variable, which means any additions to it must have a text key specified, but the key value had type '${getVariableValueType(key)}' instead!`);
                        updateVariableValue(story, a.variableID, { map: { ...left.map, [key.string]: right } }, a.characterID);
                    }
                    else {
                        throw new InterpreterError(project.files[a.range.file], a.range, `Variable '${a.variableID}' is a '${getVariableValueType(left)}', which cannot have a value of type '${getVariableValueType(right)}' added to it!`);
                    }
                },
                varSubtract: async (a) => {
                    const left = getVariableValue(project, story, a.range, a.variableID, a.characterID);
                    const right = resolveVariableValue(project, story, a.range, a.value, a.characterID);
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
    function getVariableValue(project, story, range, variableID, characterID) {
        const rawValue = getVariableValueRaw(project, story, variableID, characterID);
        if (!rawValue) {
            throw new InterpreterError(project.files[range.file], range, `No variable named '${variableID}' is defined!`);
        }
        const resolvedValue = resolveVariableValue(project, story, range, rawValue, characterID);
        return resolvedValue;
    }
    function resolveVariableValue(project, story, range, value, characterID) {
        let unrollCount = 100;
        while ((unrollCount--) > 0 && isVariableValueType(value, 'variable')) {
            const unrolledValue = getVariableValueRaw(project, story, value.variable, characterID);
            if (!unrolledValue) {
                throw new InterpreterError(project.files[range.file], range, `No variable named '${value.variable}' is defined!`);
            }
            value = unrolledValue;
        }
        return value;
    }
    function getVariableValueRaw(project, story, variableID, characterID) {
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
        else {
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
    function getVariableActualValue(value) {
        return Object.values(value)[0];
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
            return getVariableActualValue(left) === getVariableActualValue(right);
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
    const viewport = h("div", { id: "viewport" },
        currentBackdrop,
        characterBounds);
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
    const textbox = h("div", { id: "textbox" },
        nameplate,
        dialogue,
        caret,
        choiceList);
    const main = h("div", { id: "main" },
        viewport,
        textbox,
        menu,
        codeEditor);
    document.body.append(main);
    return {
        currentBackdrop,
        characterBounds,
        viewport,
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
        for (const file of Object.values(project.files)) {
            if (!file)
                continue;
            const el = h("div", { className: "file" }, file.path);
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
                console.log('File content mismatch; reload might not be triggered properly?');
                //model.setValue(value)
            }
        }
        else {
            model = monaco.editor.createModel(value, LANG_ID, uri);
            let savingPromise = null;
            let saveTime = Date.now();
            let wasReset = false;
            model.onDidChangeContent(e => {
                if (wasReset) {
                    wasReset = false;
                    return;
                }
                requestAnimationFrame(() => {
                    if (NATIVE.isEnabled()) {
                        const currentSaveTime = saveTime;
                        saveTime = currentSaveTime;
                        savingPromise = (async () => {
                            await wait(SAVE_DELAY);
                            if (saveTime === currentSaveTime) {
                                await NATIVE.saveFile(file.path, model.getValue());
                                const newProject = await PARSER.parseStory(project.path, NETWORK_LOADER);
                                await loadProject(newProject);
                                const newFile = newProject.files[file.path];
                                if (newFile) {
                                    await loadFile(newProject, newFile, null);
                                }
                            }
                            savingPromise = null;
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
        const text = await Neutralino.filesystem.readFile(`${NL_PATH}/${NL_PROJECT_DIR}/${path}`);
        return text;
    }
    async function saveFile(path, content) {
        await waitForInitialize();
        await Neutralino.filesystem.writeFile(`${NL_PATH}/${NL_PROJECT_DIR}/${path}`, content);
    }
    return {
        isEnabled,
        waitForInitialize,
        loadFile,
        saveFile,
    };
})();
const PARSER = (() => {
    // The default in OSX TextEdit and Windows Notepad; editors where it's configurable usually can just normalize on spaces or tabs
    const TABS_TO_SPACES = 8;
    async function parseStory(projectPath, fileLookup) {
        const project = {
            definition: {
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
        await parseFile(project, mainFilePath, fileLookup);
        await validateStory(project);
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
    async function validateStory(project) {
        for (const passage of Object.values(project.definition.passages)) {
            if (!passage)
                continue;
            await validateActionList(project, passage.actions);
        }
    }
    async function validateActionList(project, actions) {
        for (const action of actions) {
            await validateAction(project, action);
        }
    }
    async function validateAction(project, action) {
        const file = project.files[action.range.file];
        try {
            const validationMap = {
                goto: async (a) => {
                    const passage = project.definition.passages[a.passageID];
                    if (!passage) {
                        throw new ParseError(file, a.passageRange, `Go-To actions must have a valid passage name here, but the passage specified here does not exist`);
                    }
                },
                check: async (a) => {
                    await validateActionList(project, a.actions);
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
            if (e instanceof ParseError) {
                file.errors.push(e);
            }
            else {
                throw e;
            }
        }
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
        const keywordList = keywords.map((v, i, a) => a.length && i === a.length - 1 ? `or '${v}'` : `'${v}'`).join(keywords.length > 2 ? ', ' : ' ');
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
        const identifierList = identifiers.map((v, i, a) => a.length && i === a.length - 1 ? `or '${v}'` : `'${v}'`).join(identifiers.length > 2 ? ', ' : ' ');
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
                    parent.actions.push({ type: 'characterEntry', range: getFileRange(file, t), characterID, location });
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
                    parent.actions.push({ type: 'characterExit', range: getFileRange(file, t), characterID, location });
                },
                exits: t => optionMap.exit(t),
                move: t => {
                    tryAdvance(file, peekKeyword(file, 'to'));
                    const location = parseLocation(file, `Character movement location must be`);
                    checkEndOfLine(file, `Character movement actions must not have anything here after the location`);
                    parent.actions.push({ type: 'characterMove', range: getFileRange(file, t), characterID, location });
                },
                moves: t => optionMap.move(t),
                say: t => {
                    const text = processVariableValueOfType(file, advance(file, peekString(file), `Character speech actions must have the text to display here, enclosed in double-quotes, like '"Hello!"'`), 'string', `Character speech action text must be enclosed in double-quotes, like '"Hello!"'`).string;
                    checkEndOfLine(file, `Character speech actions must not have anything here after the speech text`);
                    parent.actions.push({ type: 'characterSpeech', range: getFileRange(file, t), characterID, text });
                },
                says: t => optionMap.say(t),
                emote: t => {
                    const identifierToken = advance(file, peekAnyIdentifier(file, 'expression'), `Character expression change actions must have an expression name here`);
                    const expression = Object.values(character.outfits).flatMap(o => Object.values(o?.expressions ?? [])).find(e => e?.id === identifierToken.text);
                    if (!expression) {
                        throw new ParseError(file, identifierToken.range, `Character expression change actions must have a defined expression name here. Did you forget to define it with 'with expression ${identifierToken.text}' under an outfit definition?`);
                    }
                    checkEndOfLine(file, `Character expression change actions must not have anything here after the expression name`);
                    parent.actions.push({ type: 'characterExpressionChange', range: getFileRange(file, t), characterID, expressionID: expression.id });
                },
                emotes: t => optionMap.emote(t),
                wear: t => {
                    const identifierToken = advance(file, peekAnyIdentifier(file, 'outfit'), `Character outfit change actions must have an outfit name here`);
                    const outfit = Object.values(character.outfits).find(o => o?.id === identifierToken.text);
                    if (!outfit) {
                        throw new ParseError(file, identifierToken.range, `Character outfit change actions must have a defined outfit name here. Did you forget to define it with 'has outfit ${identifierToken.text}' under a character definition?`);
                    }
                    checkEndOfLine(file, `Character outfit change actions must not have anything here after the outfit name`);
                    parent.actions.push({ type: 'characterOutfitChange', range: getFileRange(file, t), characterID, outfitID: outfit.id });
                },
                wears: t => optionMap.wear(t),
                check: t => {
                    advance(file, peekKeyword(file, 'if'), `Character check actions must start with the word 'if' here`);
                    const variableToken = advance(file, peekVariable(file), `Character check actions must have a variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const variable = character.variables[variableID] ?? project.definition.variables[variableID];
                    if (!variable || variable.scope === 'global') {
                        throw new ParseError(file, variableToken.range, `Character check actions must have a defined character or cast variable name here. Did you forget to define it elsewhere with 'has variable ${variableID}' under a character definition?`);
                    }
                    const comparison = parseComparison(file, `Character check actions must have a comparison here that is`);
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Character check actions must have a value specified here to compare against`));
                    checkEndOfLine(file, `Character check actions must not have anything here after the value`);
                    const checkAction = { type: 'check', range: getFileRange(file, t), variableID, comparison, value, actions: [], characterID };
                    parent.actions.push(checkAction);
                    file.states.push({ indent, passage, actionContainer: checkAction });
                },
                checks: t => optionMap.check(t),
                set: t => {
                    const variableToken = advance(file, peekVariable(file), `Character set actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const variable = character.variables[variableID] ?? project.definition.variables[variableID];
                    if (!variable || variable.scope === 'global') {
                        throw new ParseError(file, variableToken.range, `Character set actions must have a defined character or cast variable name here. Did you forget to define it elsewhere with 'has variable ${variableID}' under a character definition?`);
                    }
                    advance(file, peekKeyword(file, 'to'), `Character set actions must have the word 'to' here`);
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Character set actions must have a value specified here to store in the variable`));
                    checkEndOfLine(file, `Character set actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varSet', range: getFileRange(file, t), variableID, value, characterID });
                },
                sets: t => optionMap.set(t),
                add: t => {
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Character add actions must have a value specified here to add to the variable`));
                    advance(file, peekKeyword(file, 'to'), `Character add actions must have the word 'to' here`);
                    const variableToken = advance(file, peekVariable(file), `Character add actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const variable = character.variables[variableID] ?? project.definition.variables[variableID];
                    if (!variable || variable.scope === 'global') {
                        throw new ParseError(file, variableToken.range, `Character add actions must have a defined character or cast variable name here. Did you forget to define it elsewhere with 'has variable ${variableID}' under a character definition?`);
                    }
                    let key = undefined;
                    if (variable.type === 'map') {
                        advance(file, peekKeyword(file, 'as'), `Character add actions for map variables must have a key name here after the word 'as', like 'as "foo"'`);
                        key = processVariableValue(file, advance(file, peekVariableValue(file), `Character add actions must have a key name here after the word 'as', like 'as "foo"'`));
                    }
                    checkEndOfLine(file, `Character add actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varAdd', range: getFileRange(file, t), variableID, value, key, characterID });
                },
                adds: t => optionMap.add(t),
                subtract: t => {
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Character subtract actions must have a value specified here to subtract from the variable`));
                    advance(file, peekKeyword(file, 'from'), `Character subtract actions must have the word 'form' here`);
                    const variableToken = advance(file, peekVariable(file), `Character subtract actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const variable = character.variables[variableID] ?? project.definition.variables[variableID];
                    if (!variable || variable.scope === 'global') {
                        throw new ParseError(file, variableToken.range, `Character subtract actions must have a defined character or cast variable name here. Did you forget to define it elsewhere with 'has variable ${variableID}' under a character definition?`);
                    }
                    checkEndOfLine(file, `Character subtract actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varSubtract', range: getFileRange(file, t), variableID, value, characterID });
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
                    const backdrop = project.definition.backdrops[identifierToken.text];
                    if (!backdrop) {
                        throw new ParseError(file, identifierToken.range, `Display actions must have a defined backdrop name here. Did you forget to define it with 'define backdrop ${identifierToken.text}'?`);
                    }
                    checkEndOfLine(file, `Display actions must not have anything here after the backdrop name`);
                    parent.actions.push({ type: 'backdropChange', range: getFileRange(file, t), backdropID: backdrop.id });
                },
                play: t => {
                    const identifierToken = advance(file, peekAnyIdentifier(file, 'sound'), `Play Sound actions must have a sound name here`);
                    const sound = project.definition.sounds[identifierToken.text];
                    if (!sound) {
                        throw new ParseError(file, identifierToken.range, `Play Sound actions must have a defined sound name here. Did you forget to define it with 'define sound ${identifierToken.text}'?`);
                    }
                    checkEndOfLine(file, `Play Sound actions must not have anything here after the sound name`);
                    parent.actions.push({ type: 'playSound', range: getFileRange(file, t), soundID: sound.id });
                },
                narrate: t => {
                    const text = processVariableValueOfType(file, advance(file, peekString(file), `Narration actions must have the text to display here, enclosed in double-quotes, like '"Hello!"'`), 'string', `Narration text must be enclosed in double-quotes, like '"Hello!"'`).string;
                    checkEndOfLine(file, `Narration actions must not have anything here after the narration text`);
                    parent.actions.push({ type: 'narration', range: getFileRange(file, t), text });
                },
                option: t => {
                    const text = processVariableValueOfType(file, advance(file, peekString(file), `Passage options must have the text to display here, enclosed in double-quotes, like '"Pick Me"'`), 'string', `Passage option text must be enclosed in double-quotes, like '"Pick Me"'`).string;
                    checkEndOfLine(file, `Passage options must not have anything here after the option text`);
                    const optionDefinition = { type: 'option', range: getFileRange(file, t), text, actions: [] };
                    parent.actions.push(optionDefinition);
                    file.states.push({ indent, passage, actionContainer: optionDefinition });
                },
                check: t => {
                    advance(file, peekKeyword(file, 'if'), `Check actions must start with the word 'if' here`);
                    const variableToken = advance(file, peekVariable(file), `Check actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const variable = project.definition.variables[variableID];
                    if (!variable || variable.scope !== 'global') {
                        throw new ParseError(file, variableToken.range, `Check actions must have a defined global variable name here. Did you forget to define it with 'define global variable ${variableID}'?`);
                    }
                    const comparison = parseComparison(file, `Check actions must have a comparison here that is`);
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Check actions must have a value specified here to compare against`));
                    checkEndOfLine(file, `Check actions must not have anything here after the value`);
                    const checkAction = { type: 'check', range: getFileRange(file, t), variableID, comparison, value, actions: [], characterID: null };
                    parent.actions.push(checkAction);
                    file.states.push({ indent, passage, actionContainer: checkAction });
                },
                set: t => {
                    const variableToken = advance(file, peekVariable(file), `Set actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const variable = project.definition.variables[variableID];
                    if (!variable || variable.scope !== 'global') {
                        throw new ParseError(file, variableToken.range, `Set actions must have a defined global variable name here. Did you forget to define it with 'define global variable ${variableID}'?`);
                    }
                    advance(file, peekKeyword(file, 'to'), `Set actions must have the word 'to' here`);
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Set actions must have a value specified here to store in the variable`));
                    checkEndOfLine(file, `Set actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varSet', range: getFileRange(file, t), variableID, value, characterID: null });
                },
                add: t => {
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Add actions must have a value specified here to add to the variable`));
                    advance(file, peekKeyword(file, 'to'), `Add actions must have the word 'to' here`);
                    const variableToken = advance(file, peekVariable(file), `Add actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const variable = project.definition.variables[variableID];
                    if (!variable || variable.scope !== 'global') {
                        throw new ParseError(file, variableToken.range, `Add actions must have a defined global variable name here. Did you forget to define it with 'define global variable ${variableID}'?`);
                    }
                    let key = undefined;
                    if (variable.type === 'map') {
                        advance(file, peekKeyword(file, 'as'), `Add actions for map variables must have a key name here after the word 'as', like 'as "foo"'`);
                        key = processVariableValue(file, advance(file, peekVariableValue(file), `Add actions must have a key name here after the word 'as', like 'as "foo"'`));
                    }
                    checkEndOfLine(file, `Add actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varAdd', range: getFileRange(file, t), variableID, value, characterID: null });
                },
                subtract: t => {
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Subtract actions must have a value specified here to subtract from the variable`));
                    advance(file, peekKeyword(file, 'from'), `Subtract actions must have the word 'from' here`);
                    const variableToken = advance(file, peekVariable(file), `Subtract actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const variable = project.definition.variables[variableID];
                    if (!variable || variable.scope !== 'global') {
                        throw new ParseError(file, variableToken.range, `Subtract actions must have a defined global variable name here. Did you forget to define it with 'define global variable ${variableID}'?`);
                    }
                    checkEndOfLine(file, `Subtract actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varSubtract', range: getFileRange(file, t), variableID, value, characterID: null });
                },
            }, `Passage actions must start with a defined character's name (in which case, did you forget to define them with 'define character ${characterID}'?) or be`);
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
        const token = { type, range, text: readRange(file, range), subType };
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
            let cursor = { row: file.cursor.row, col: file.cursor.col + 1 };
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
            let cursor = { row: file.cursor.row, col: file.cursor.col + 1 };
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
            let cursor = { row: file.cursor.row, col: file.cursor.col + 1 };
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
            let cursor = { row: file.cursor.row, col: file.cursor.col + 1 };
            while (!isChar(file, cursor, '"') && !isOutOfBounds(file, cursor)) {
                cursor.col++;
            }
            if (isChar(file, cursor, '"')) {
                cursor.col++;
            }
            const token = peek(file, 'string', cursor.col - file.cursor.col);
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
class InterpreterError extends Error {
    file;
    range;
    msg;
    constructor(file, range, msg) {
        super(`An error was identified while processing a story file: ${msg}\nin ${file.path} at ${range.row}:${range.start}\n${file.lines[range.row]}\n${' '.repeat(range.start)}${'^'.repeat(Math.max(1, range.end - range.start))}`);
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
//# sourceMappingURL=index.js.map