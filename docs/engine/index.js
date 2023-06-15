"use strict";
async function loadProject() {
    const story = await PARSER.parseStory('project', 'project/story.nvn', async (path) => {
        const response = await fetch(path);
        const text = await response.text();
        return text;
    });
    for (const file of Object.values(story.files)) {
        if (file?.errors.length) {
            MONACO.makeCodeEditor(file);
        }
    }
    console.log(story);
}
requestAnimationFrame(async () => {
    await loadProject();
    /*ENGINE.defineCharacter('vel', 'Vel')
    ENGINE.defineCharacterOutfit('vel', 'casual')
    ENGINE.defineCharacterExpression('vel', 'casual', 'neutral')
    ENGINE.defineCharacterExpression('vel', 'casual', 'annoyed')
    ENGINE.defineCharacterExpression('vel', 'casual', 'happy')
    ENGINE.defineCharacterExpression('vel', 'casual', 'horny')
    ENGINE.defineCharacterExpression('vel', 'casual', 'hungry')
    ENGINE.defineCharacterOutfit('vel', 'casualBelly')
    ENGINE.defineCharacterExpression('vel', 'casualBelly', 'happy')
    ENGINE.defineCharacterOutfit('vel', 'casualBellyHuge')
    ENGINE.defineCharacterExpression('vel', 'casualBellyHuge', 'neutral')
    ENGINE.defineBackdrop('classroom1')
    ENGINE.defineSound('GGP/Bweeeelch')
    await ENGINE.changeBackdrop('classroom1')
    await ENGINE.addCharacter('vel')
    await ENGINE.changeCharacterOutfit('vel', 'casual')
    await ENGINE.changeCharacterExpression('vel', 'happy')
    await ENGINE.displayText('Oh, hello there! How are you?\nI\'m Vel! Vel Noire!', 'Vel')
    await ENGINE.waitForAdvance()
    await ENGINE.changeCharacterExpression('vel', 'hungry')
    await ENGINE.displayText('Vel stares hungrily.', null)
    await ENGINE.waitForAdvance()
    await ENGINE.changeCharacterOutfit('vel', 'casualBelly')
    await ENGINE.changeCharacterExpression('vel', 'happy')
    await ENGINE.playSound('GGP/Bweeeelch')
    await ENGINE.displayText('"Burrrrrrp!"', 'Vel')*/
});
const INTERFACE = (() => {
    let audioContext = null;
    const characterElements = {};
    let textRevealPromise = null;
    let advancePromise = null;
    let viewState = {
        definition: {
            characters: {},
            backdrops: {},
            sounds: {},
            passages: {},
            variables: {},
        },
        states: [],
        backdropID: null,
        characters: {},
        text: '',
        speaker: null,
    };
    function updateViewState(updater) {
        viewState = updater(viewState);
    }
    async function changeBackdrop(backdropID) {
        const backdropDef = backdropID ? viewState.definition.backdrops[backdropID] : null;
        if (backdropDef === undefined)
            throw new Error(`There are no defined backdrops named '${backdropID}'!`);
        updateViewState(viewState => {
            return { ...viewState, backdropID: backdropID };
        });
        const oldElement = backdrop;
        const newElement = backdrop.cloneNode();
        newElement.classList.add('hide');
        oldElement.parentNode?.insertBefore(newElement, oldElement.nextSibling);
        newElement.style.backgroundImage = backdropDef ? `url(${backdropDef.path})` : 'transparent';
        requestAnimationFrame(() => {
            oldElement.classList.add('hide');
            newElement.classList.remove('hide');
        });
        setTimeout(() => {
            oldElement.remove();
        }, 1000);
    }
    async function playSound(soundID) {
        const soundDef = viewState.definition.sounds[soundID];
        if (!soundDef)
            throw new Error(`There are no defined sounds named '${soundID}'!`);
        await playSoundRaw(soundDef.path, false);
    }
    async function addCharacter(characterID) {
        const characterDef = viewState.definition.characters[characterID];
        if (!characterDef)
            throw new Error(`There are no defined characters named '${characterID}'!`);
        const [outfitID, outfitDef] = Object.entries(characterDef.outfits)[0];
        if (!outfitDef)
            throw new Error(`There are no defined outfits for character named '${characterID}'!`);
        const [expressionID, expressionDef] = Object.entries(outfitDef.expressions)[0];
        if (!expressionDef)
            throw new Error(`There are no defined expressions for outfit named '${outfitID}' in character named '${characterID}'!`);
        updateViewState(viewState => {
            if (viewState.characters[characterID]) {
                return viewState;
            }
            return {
                ...viewState,
                characters: {
                    ...viewState.characters,
                    [characterID]: {
                        outfit: outfitID,
                        expression: expressionID,
                    }
                }
            };
        });
        const element = h("div", { className: "character hide" });
        element.style.backgroundImage = `url(${expressionDef.path})`;
        characterBounds.append(element);
        characterElements[characterID] = element;
        requestAnimationFrame(() => {
            element.classList.remove('hide');
        });
    }
    async function changeCharacterOutfit(characterID, outfitID) {
        if (!viewState.characters[characterID]) {
            await addCharacter(characterID);
        }
        const characterState = viewState.characters[characterID];
        const characterDef = viewState.definition.characters[characterID];
        const outfitDef = characterDef.outfits[outfitID];
        if (!outfitDef)
            throw new Error(`There are no defined outfits named '${outfitID}' in character named '${characterID}'!`);
        const [expressionID, expressionDef] = characterState.expression in outfitDef.expressions ? [characterState.expression, outfitDef.expressions[characterState.expression]] : Object.entries(outfitDef.expressions)[0];
        if (!expressionDef)
            throw new Error(`There are no defined expressions for outfit named '${outfitID}' in character named '${characterID}'!`);
        updateViewState(viewState => {
            if (characterState.outfit === outfitID) {
                return viewState;
            }
            return {
                ...viewState,
                characters: {
                    ...viewState.characters,
                    [characterID]: {
                        ...viewState.characters[characterID],
                        outfit: outfitID,
                        expression: expressionID,
                    }
                }
            };
        });
        const imgUrl = expressionDef.path;
        await updateCharacterRaw(characterID, imgUrl);
    }
    async function changeCharacterExpression(characterID, expressionID) {
        if (!viewState.characters[characterID]) {
            await addCharacter(characterID);
        }
        const characterState = viewState.characters[characterID];
        const characterDef = viewState.definition.characters[characterID];
        const outfitDef = characterDef.outfits[characterState.outfit];
        const expressionDef = outfitDef.expressions[expressionID];
        if (!expressionDef)
            throw new Error(`There are no defined expressions named '${expressionID}' for outfit named '${characterState.outfit}' in character named '${characterID}'!`);
        updateViewState(viewState => {
            if (characterState.expression === expressionID) {
                return viewState;
            }
            return {
                ...viewState,
                characters: {
                    ...viewState.characters,
                    [characterID]: {
                        ...viewState.characters[characterID],
                        expression: expressionID,
                    }
                }
            };
        });
        const imgUrl = expressionDef.path;
        await updateCharacterRaw(characterID, imgUrl);
    }
    async function updateCharacterRaw(characterID, imgUrl) {
        await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = e => resolve();
            img.onerror = e => reject(e);
            img.src = imgUrl;
        });
        const oldElement = characterElements[characterID];
        const newElement = oldElement.cloneNode();
        newElement.classList.add('hide');
        oldElement.parentNode?.insertBefore(newElement, oldElement.nextSibling);
        newElement.style.backgroundImage = `url(${imgUrl})`;
        characterElements[characterID] = newElement;
        requestAnimationFrame(() => {
            oldElement.classList.add('hide');
            newElement.classList.remove('hide');
        });
        setTimeout(() => {
            oldElement.remove();
        }, 1000);
    }
    async function displayText(text, speaker) {
        updateViewState(viewState => {
            return {
                ...viewState,
                text,
                speaker,
            };
        });
        const skipPromise = createExposedPromise();
        textRevealPromise = skipPromise;
        nameplate.textContent = speaker;
        dialogue.textContent = '';
        caret.classList.add('hide');
        const parts = text.split(/\b/g);
        for (const part of parts) {
            for (const char of part) {
                await Promise.any([skipPromise, waitForNextFrame()]);
                const span = h("span", { className: "hide" }, char);
                dialogue.append(span);
                await Promise.any([skipPromise, waitForNextFrame()]);
                span.classList.remove('hide');
                Promise.any([skipPromise, wait(1000)]).then(() => {
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
            caret.classList.remove('hide');
        }
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
        main.addEventListener('click', clickAdvance);
    });
    return {
        addCharacter,
        changeCharacterOutfit,
        changeCharacterExpression,
        changeBackdrop,
        playSound,
        displayText,
        waitForAdvance,
    };
})();
function clickTrap(e) {
    e.preventDefault();
    e.stopPropagation();
}
const backdrop = h("div", { className: "backdrop" });
const characterBounds = h("div", { id: "characterBounds" });
const viewport = h("div", { id: "viewport" },
    backdrop,
    characterBounds);
const menu = h("div", { id: "menu", onclick: clickTrap });
const errorEditor = h("div", { id: "errorEditor" });
const nameplate = h("div", { id: "nameplate" });
const dialogue = h("div", { id: "dialogue" });
const caret = h("div", { id: "caret" });
const textbox = h("div", { id: "textbox" },
    nameplate,
    dialogue,
    caret);
const main = h("div", { id: "main" },
    viewport,
    textbox,
    menu,
    errorEditor);
document.body.append(main);
/// <reference path="../../node_modules/monaco-editor/monaco.d.ts" />
const MONACO = (() => {
    const LANG_ID = 'nova-vn';
    let loadingPromise = createExposedPromise();
    let currentFile = null;
    let currentEditor = null;
    require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.26.1/min/vs' } });
    require(["vs/editor/editor.main"], () => {
        monaco.languages.register({ id: LANG_ID });
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
        loadingPromise.resolve();
    });
    async function makeCodeEditor(file) {
        await loadingPromise;
        if (currentEditor) {
            currentEditor.dispose();
            currentEditor = null;
        }
        const uri = monaco.Uri.parse(file.path);
        const value = file.lines.join('\n');
        const model = monaco.editor.createModel(value, LANG_ID, uri);
        let wasReset = false;
        model.onDidChangeContent(e => {
            if (wasReset) {
                wasReset = false;
                return;
            }
            requestAnimationFrame(() => {
                wasReset = true;
                model.setValue(value);
            });
        });
        const markers = file.errors.map(e => ({
            message: e.msg,
            severity: monaco.MarkerSeverity.Error,
            startLineNumber: e.range.row + 1,
            endLineNumber: e.range.row + 1,
            startColumn: e.range.start + 1,
            endColumn: e.range.end + 1,
        }));
        monaco.editor.setModelMarkers(model, LANG_ID, markers);
        currentEditor = monaco.editor.create(errorEditor, {
            model: model,
            theme: 'vs-dark',
        });
    }
    return {
        makeCodeEditor,
    };
})();
/// <reference path="../../node_modules/neutralinojs-types/index.d.ts" />
const NATIVE = (() => {
    const enabled = 'NL_VERSION' in window;
    let loadingPromise = createExposedPromise();
    if (enabled) {
        console.log('Detected Neutralino');
        Neutralino.init();
        Neutralino.events.on('ready', () => {
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
    return {
        isEnabled,
    };
})();
const PARSER = (() => {
    // The default in OSX TextEdit and Windows Notepad; editors where it's configurable usually can just normalize on spaces or tabs
    const TABS_TO_SPACES = 8;
    async function parseStory(projectPath, mainFilePath, fileLookup) {
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
        await parseFile(project, mainFilePath, fileLookup);
        return project;
    }
    async function parseFile(project, path, fileLookup) {
        const text = await fileLookup(path);
        const lines = text.split(/\r?\n/g);
        const file = {
            project,
            path,
            lines,
            tokens: [],
            cursor: { row: 0, col: 0 },
            states: [],
            errors: [],
        };
        project.files[path] = file;
        while (file.cursor.row < file.lines.length) {
            parseLine(file);
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
            if (tryAdvance(file, peekKeyword(file, keyword))) {
                return optionMap[keyword]();
            }
        }
        const keywordList = keywords.map((v, i, a) => a.length && i === a.length - 1 ? `or '${v}'` : `'${v}'`).join(keywords.length > 2 ? ', ' : ' ');
        const token = peekAny(file);
        throw new ParseError(file, token.range, `${error} ${keywordList}, but this line has '${token.text}' instead.`);
    }
    function parseCharacterSubDefinition(file, character, indent) {
        advance(file, peekKeyword(file, 'has'), `Character sub-definitions must start with 'has'`);
        parseKeywordSelect(file, {
            outfit: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file), `Outfit definitions must have a name that starts with a letter here`);
                const id = identifierToken.text;
                if (character.outfits[id]) {
                    throw new ParseError(file, identifierToken.range, `Outfits names must be unique, but you already have a outfit named '${id}' defined elsewhere for this character.`);
                }
                character.outfits[id] = {
                    id,
                    expressions: {},
                };
                file.states.push({ indent, character, outfit: character.outfits[id] });
                checkEndOfLine(file, `Outfit definitions must not have anything here after the outfit name`);
            },
            variable: () => {
                parseVariableDefinition(file, 'character', character);
            },
        }, `Character sub-definitions must be an`);
    }
    function parseOutfitSubDefinition(file, character, outfit, indent) {
        advance(file, peekKeyword(file, 'with'), `Outfit sub-definitions must start with 'with'`);
        parseKeywordSelect(file, {
            expression: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file), `Expression definitions must have a name that starts with a letter here`);
                const id = identifierToken.text;
                if (outfit.expressions[id]) {
                    throw new ParseError(file, identifierToken.range, `Expression names must be unique, but you already have an expression named '${id}' defined elsewhere for this outfit.`);
                }
                outfit.expressions[id] = {
                    id,
                    path: `${file.project.path}/${character.id}/${outfit.id}/${id}.png`,
                };
                checkEndOfLine(file, `Expression definitions must not have anything here after the expression name`);
            }
        }, `Outfit sub-definitions must be an`);
    }
    function parseVariableDefinition(file, scope, character) {
        const scopeDisplay = scope.substring(0, 1).toUpperCase() + scope.substring(1);
        const varToken = advance(file, peekVariable(file), `${scopeDisplay} variable definitions must have a variable name that starts with the '$' symbol here`);
        tryAdvance(file, peekKeyword(file, 'which'));
        advance(file, peekKeyword(file, 'is'), `${scopeDisplay} variable definitions must have a default value here, starting with the word 'is'`);
        const valueToken = advance(file, peekVariableValue(file), `${scopeDisplay} variable definitions must have a default value specified here`);
        const id = varToken.text;
        const [type, value] = processVariableValue(file, valueToken);
        const parent = character ? character : file.project.definition;
        if (parent.variables[id]) {
            throw new ParseError(file, varToken.range, `Variable names must be unique, but you already have a variable named '${id}' defined elsewhere.`);
        }
        parent.variables[varToken.text] = {
            id,
            initialValue: value,
            scope,
            characterID: character?.id,
            type,
        };
        checkEndOfLine(file, `${scopeDisplay} variable definitions must not have anything here after the default value`);
    }
    function parseDefinition(file, indent) {
        advance(file, peekKeyword(file, 'define'), `Lines must start with 'define'`);
        parseKeywordSelect(file, {
            'global variable': () => {
                parseVariableDefinition(file, 'global');
            },
            'cast variable': () => {
                parseVariableDefinition(file, 'cast');
            },
            character: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file), `Character definitions must have a name that starts with a letter here`);
                advance(file, peekKeyword(file, 'as'), `Character definitions must have a name here, starting with the word 'as', like 'as "Jane"'`);
                const nameToken = advance(file, peekString(file), `Character definitions must have a name here, contained in double-quotes, like 'as "Jane"'`);
                const id = identifierToken.text;
                const name = processVariableValueOfType(file, nameToken, 'string', `Character names must be enclosed in double-quotes, like '"Jane"'`);
                if (file.project.definition.characters[id]) {
                    throw new ParseError(file, identifierToken.range, `Character names must be unique, but you already have a character named '${id}' defined elsewhere.`);
                }
                file.project.definition.characters[id] = {
                    id,
                    name,
                    outfits: {},
                    variables: {},
                };
                file.states.push({ indent: indent, character: file.project.definition.characters[id] });
                checkEndOfLine(file, `Character definitions must not have anything here after the name`);
            },
            backdrop: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file), `Backdrop definitions must have a name that starts with a letter here`);
                const id = identifierToken.text;
                let path = `${file.project.path}/backdrops/${id}.png`;
                if (tryAdvance(file, peekKeyword(file, 'from'))) {
                    const filenameToken = advance(file, peekString(file), `Backdrop definitions must have a file path here, enclosed in double-quotes, like 'from "bg.jpg"'`);
                    const filename = processVariableValueOfType(file, filenameToken, 'string', `Backdrop file paths must be enclosed in double-quotes, like '"bg.jpg"'`);
                    path = `${file.project.path}/backdrops/${filename}`;
                }
                if (file.project.definition.backdrops[id]) {
                    throw new ParseError(file, identifierToken.range, `Passage names must be unique, but you already have a backdrop named '${id}' defined elsewhere.`);
                }
                file.project.definition.backdrops[id] = {
                    id,
                    path,
                };
                checkEndOfLine(file, `Backdrop definitions must not have anything here after the name`);
            },
            sound: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file), `Sound definitions must have a name that starts with a letter here`);
                const id = identifierToken.text;
                let path = `${file.project.path}/sound/${id}.mp3`;
                if (tryAdvance(file, peekKeyword(file, 'from'))) {
                    const filenameToken = advance(file, peekString(file), `Sound definitions must have a file path here, enclosed in double-quotes, like 'from "snd.wav"'`);
                    const filename = processVariableValueOfType(file, filenameToken, 'string', `Sound file paths must be enclosed in double-quotes, like '"snd.wav"'`);
                    path = `${file.project.path}/sounds/${filename}`;
                }
                if (file.project.definition.sounds[id]) {
                    throw new ParseError(file, identifierToken.range, `Sound names must be unique, but you already have a sound named '${id}' defined elsewhere.`);
                }
                file.project.definition.sounds[id] = {
                    id,
                    path,
                };
                checkEndOfLine(file, `Sound definitions must not have anything here after the name`);
            },
            passage: () => {
                const identifierToken = advance(file, peekAnyIdentifier(file), `Passage definitions must have a name that starts with a letter here`);
                const id = identifierToken.text;
                if (file.project.definition.passages[id]) {
                    throw new ParseError(file, identifierToken.range, `Passage names must be unique, but you already have a passage named '${id}' defined elsewhere.`);
                }
                file.project.definition.passages[id] = {
                    id,
                    actions: [],
                };
                file.states.push({ indent: indent, passage: file.project.definition.passages[id] });
                checkEndOfLine(file, `Passage definitions must not have anything here after the name`);
            },
        }, `Definitions must be a`);
    }
    function parsePassageAction(file, passage, parent, indent) {
        const identifierToken = peekAnyIdentifier(file);
        if (identifierToken && file.project.definition.characters[identifierToken.text]) {
            advance(file, identifierToken, '');
            const character = file.project.definition.characters[identifierToken.text];
            const characterID = character.id;
            const optionMap = {
                enter: () => {
                    let location = 'default';
                    if (tryAdvance(file, peekKeyword(file, 'from'))) {
                        location = parseKeywordSelect(file, {
                            left: () => 'left',
                            right: () => 'right',
                            center: () => 'center',
                        }, `Character entry location must be`);
                        checkEndOfLine(file, `Character entry actions must not have anything here after the location`);
                    }
                    else {
                        checkEndOfLine(file, `Character entry actions must not have anything here after the action name unless it's the word 'from' and a location, like 'from left'`);
                    }
                    parent.actions.push({ type: 'characterEntry', characterID, location });
                },
                enters: () => optionMap.enter(),
                exit: () => {
                    let location = 'default';
                    if (tryAdvance(file, peekKeyword(file, 'to'))) {
                        location = parseKeywordSelect(file, {
                            left: () => 'left',
                            right: () => 'right',
                            center: () => 'center',
                        }, `Character exit location must be`);
                        checkEndOfLine(file, `Character exit actions must not have anything here after the location`);
                    }
                    else {
                        checkEndOfLine(file, `Character exit actions must not have anything here after the action name unless it's the word 'to' and a location, like 'to left'`);
                    }
                    parent.actions.push({ type: 'characterExit', characterID, location });
                },
                exits: () => optionMap.exit(),
                say: () => {
                    const text = processVariableValueOfType(file, advance(file, peekString(file), `Character speech actions must have the text to display here, enclosed in double-quotes, like '"Hello!"'`), 'string', `Character speech action text must be enclosed in double-quotes, like '"Hello!"'`);
                    checkEndOfLine(file, `Character speech actions must not have anything here after the speech text`);
                    parent.actions.push({ type: 'characterSpeech', characterID, text });
                },
                says: () => optionMap.say(),
                emote: () => {
                    const identifierToken = advance(file, peekAnyIdentifier(file), `Character expression change actions must have an expression name here`);
                    const expression = Object.values(character.outfits).flatMap(o => Object.values(o?.expressions ?? [])).find(e => e?.id === identifierToken.text);
                    if (!expression) {
                        throw new ParseError(file, identifierToken.range, `Character expression change actions must have a defined expression name here`);
                    }
                    checkEndOfLine(file, `Character expression change actions must not have anything here after the expression name`);
                    parent.actions.push({ type: 'characterExpressionChange', characterID, expressionID: expression.id });
                },
                emotes: () => optionMap.emote(),
                wear: () => {
                    const identifierToken = advance(file, peekAnyIdentifier(file), `Character outfit change actions must have an expression name here`);
                    const outfit = Object.values(character.outfits).find(o => o?.id === identifierToken.text);
                    if (!outfit) {
                        throw new ParseError(file, identifierToken.range, `Character outfit change actions must have a defined outfit name here`);
                    }
                    checkEndOfLine(file, `Character outfit change actions must not have anything here after the outfit name`);
                    parent.actions.push({ type: 'characterOutfitChange', characterID, outfitID: outfit.id });
                },
                wears: () => optionMap.wear(),
                move: () => {
                    tryAdvance(file, peekKeyword(file, 'to'));
                    const location = parseKeywordSelect(file, {
                        left: () => 'left',
                        right: () => 'right',
                        center: () => 'center',
                    }, `Character movement location must be`);
                    checkEndOfLine(file, `Character movement actions must not have anything here after the location`);
                    parent.actions.push({ type: 'characterMove', characterID, location });
                },
                moves: () => optionMap.move(),
                check: () => {
                    advance(file, peekKeyword(file, 'if'), `Character check actions must start with the word 'if' here`);
                    const variableToken = advance(file, peekVariable(file), `Character check actions must have a variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const variable = character.variables[variableID] ?? file.project.definition.variables[variableID];
                    if (!variable || variable.scope === 'global') {
                        throw new ParseError(file, variableToken.range, `Character check actions must have a defined character or cast variable name here`);
                    }
                    const comparison = parseComparison(file, `Character check actions must have a comparison here that is`);
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Character check actions must have a value specified here to compare against`));
                    checkEndOfLine(file, `Character check actions must not have anything here after the value`);
                    const checkAction = { type: 'check', variableID, comparison, value, actions: [], characterID };
                    parent.actions.push(checkAction);
                    file.states.push({ indent, passage, actionContainer: checkAction });
                },
                checks: () => optionMap.check(),
                set: () => {
                    const variableToken = advance(file, peekVariable(file), `Character set actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const variable = character.variables[variableID] ?? file.project.definition.variables[variableID];
                    if (!variable || variable.scope === 'global') {
                        throw new ParseError(file, variableToken.range, `Character set actions must have a defined global variable name here`);
                    }
                    advance(file, peekKeyword(file, 'to'), `Character set actions must have the word 'to' here`);
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Character set actions must have a value specified here to store in the variable`));
                    checkEndOfLine(file, `Character set actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varSet', variableID, value, characterID });
                },
                add: () => {
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Character add actions must have a value specified here to add to the variable`));
                    advance(file, peekKeyword(file, 'to'), `Character add actions must have the word 'to' here`);
                    const variableToken = advance(file, peekVariable(file), `Character add actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const variable = character.variables[variableID] ?? file.project.definition.variables[variableID];
                    if (!variable || variable.scope === 'global') {
                        throw new ParseError(file, variableToken.range, `Character add actions must have a defined global variable name here`);
                    }
                    checkEndOfLine(file, `Character add actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varAdd', variableID, value, characterID });
                },
                adds: () => optionMap.add(),
                subtract: () => {
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Character subtract actions must have a value specified here to subtract from the variable`));
                    advance(file, peekKeyword(file, 'from'), `Character subtract actions must have the word 'form' here`);
                    const variableToken = advance(file, peekVariable(file), `Character subtract actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const variable = character.variables[variableID] ?? file.project.definition.variables[variableID];
                    if (!variable || variable.scope === 'global') {
                        throw new ParseError(file, variableToken.range, `Character subtract actions must have a defined global variable name here`);
                    }
                    checkEndOfLine(file, `Character subtract actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varSubtract', variableID, value, characterID });
                },
                subtracts: () => optionMap.subtract(),
            };
            parseKeywordSelect(file, optionMap, `Character actions must be`);
        }
        else {
            parseKeywordSelect(file, {
                display: () => {
                    const identifierToken = advance(file, peekAnyIdentifier(file), `Display actions must have a backdrop name here`);
                    const backdrop = file.project.definition.backdrops[identifierToken.text];
                    if (!backdrop) {
                        throw new ParseError(file, identifierToken.range, `Display actions must have a defined backdrop name here`);
                    }
                    checkEndOfLine(file, `Display actions must not have anything here after the backdrop name`);
                    parent.actions.push({ type: 'backdropChange', backdropID: backdrop.id });
                },
                play: () => {
                    const identifierToken = advance(file, peekAnyIdentifier(file), `Play Sound actions must have a sound name here`);
                    const sound = file.project.definition.sounds[identifierToken.text];
                    if (!sound) {
                        throw new ParseError(file, identifierToken.range, `Play Sound actions must have a defined sound name here`);
                    }
                    checkEndOfLine(file, `Play Sound actions must not have anything here after the sound name`);
                    parent.actions.push({ type: 'playSound', soundID: sound.id });
                },
                narrate: () => {
                    const text = processVariableValueOfType(file, advance(file, peekString(file), `Narration actions must have the text to display here, enclosed in double-quotes, like '"Hello!"'`), 'string', `Narration text must be enclosed in double-quotes, like '"Hello!"'`);
                    checkEndOfLine(file, `Narration actions must not have anything here after the narration text`);
                    parent.actions.push({ type: 'narration', text });
                },
                option: () => {
                    const text = processVariableValueOfType(file, advance(file, peekString(file), `Passage options must have the text to display here, enclosed in double-quotes, like '"Pick Me"'`), 'string', `Passage option text must be enclosed in double-quotes, like '"Pick Me"'`);
                    checkEndOfLine(file, `Passage options must not have anything here after the option text`);
                    const optionDefinition = { type: 'option', text, actions: [] };
                    parent.actions.push(optionDefinition);
                    file.states.push({ indent, passage, actionContainer: optionDefinition });
                },
                continue: () => {
                    checkEndOfLine(file, `Continuation options must not have anything here after 'continue'`);
                    parent.actions.push({ type: 'continue' });
                },
                'go to': () => {
                    const identifierToken = advance(file, peekAnyIdentifier(file), `Go-To actions must have a passage name here`);
                    const passageID = identifierToken.text;
                    // Passages are likely going to be defined later in the file, so don't try to resolve them immediately
                    if (false) {
                        const passage = file.project.definition.passages[passageID];
                        if (!passage) {
                            throw new ParseError(file, identifierToken.range, `Go-To actions must have a defined passage name here`);
                        }
                    }
                    checkEndOfLine(file, `Go-To actions must not have anything here after the passage name`);
                    parent.actions.push({ type: 'goto', passageID });
                },
                end: () => {
                    checkEndOfLine(file, `Ending options must not have anything here after 'end'`);
                    parent.actions.push({ type: 'end' });
                },
                check: () => {
                    advance(file, peekKeyword(file, 'if'), `Check actions must start with the word 'if' here`);
                    const variableToken = advance(file, peekVariable(file), `Check actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const variable = file.project.definition.variables[variableID];
                    if (!variable || variable.scope !== 'global') {
                        throw new ParseError(file, variableToken.range, `Check actions must have a defined global variable name here`);
                    }
                    const comparison = parseComparison(file, `Check actions must have a comparison here that is`);
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Check actions must have a value specified here to compare against`));
                    checkEndOfLine(file, `Check actions must not have anything here after the value`);
                    const checkAction = { type: 'check', variableID, comparison, value, actions: [] };
                    parent.actions.push(checkAction);
                    file.states.push({ indent, passage, actionContainer: checkAction });
                },
                set: () => {
                    const variableToken = advance(file, peekVariable(file), `Set actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const variable = file.project.definition.variables[variableID];
                    if (!variable || variable.scope !== 'global') {
                        throw new ParseError(file, variableToken.range, `Set actions must have a defined global variable name here`);
                    }
                    advance(file, peekKeyword(file, 'to'), `Set actions must have the word 'to' here`);
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Set actions must have a value specified here to store in the variable`));
                    checkEndOfLine(file, `Set actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varSet', variableID, value });
                },
                add: () => {
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Add actions must have a value specified here to add to the variable`));
                    advance(file, peekKeyword(file, 'to'), `Add actions must have the word 'to' here`);
                    const variableToken = advance(file, peekVariable(file), `Add actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const variable = file.project.definition.variables[variableID];
                    if (!variable || variable.scope !== 'global') {
                        throw new ParseError(file, variableToken.range, `Add actions must have a defined global variable name here`);
                    }
                    checkEndOfLine(file, `Add actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varAdd', variableID, value });
                },
                subtract: () => {
                    const value = processVariableValue(file, advance(file, peekVariableValue(file), `Subtract actions must have a value specified here to subtract from the variable`));
                    advance(file, peekKeyword(file, 'from'), `Subtract actions must have the word 'from' here`);
                    const variableToken = advance(file, peekVariable(file), `Subtract actions must have a global variable name that starts with the '$' symbol here`);
                    const variableID = variableToken.text;
                    const variable = file.project.definition.variables[variableID];
                    if (!variable || variable.scope !== 'global') {
                        throw new ParseError(file, variableToken.range, `Subtract actions must have a defined global variable name here`);
                    }
                    checkEndOfLine(file, `Subtract actions must not have anything here after the value`);
                    parent.actions.push({ type: 'varSubtract', variableID, value });
                },
            }, `Passage actions must start with a defined character's name or be`);
        }
    }
    function parseComparison(file, error) {
        const comparison = parseKeywordSelect(file, {
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
    function parseLine(file) {
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
                parsePassageAction(file, currentState.passage, currentState.actionContainer, indent);
            }
            else if (currentState?.passage) {
                parsePassageAction(file, currentState.passage, currentState.passage, indent);
            }
            else if (currentState?.character && !currentState.outfit) {
                parseCharacterSubDefinition(file, currentState.character, indent);
            }
            else if (currentState?.outfit && currentState.character) {
                parseOutfitSubDefinition(file, currentState.character, currentState.outfit, indent);
            }
            else {
                parseDefinition(file, indent);
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
    // If the left-hand side of the character at this position is a word boundary
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
    function parseToken(file, type, row, start, end) {
        const range = { row, start, end };
        const token = { type, range, text: readRange(file, range) };
        return token;
    }
    function peek(file, type, length) {
        const token = parseToken(file, type, file.cursor.row, file.cursor.col, file.cursor.col + length);
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
    function peekIdentifier(file, identifier) {
        if (isWord(file, file.cursor, identifier)) {
            return peek(file, 'identifier', identifier.length);
        }
        return null;
    }
    function peekAnyIdentifier(file) {
        if (isIdentifierChar(file, file.cursor) && isWordBoundary(file, file.cursor)) {
            let cursor = { row: file.cursor.row, col: file.cursor.col + 1 };
            while (isIdentifierChar(file, cursor)) {
                cursor.col++;
            }
            const token = peek(file, 'identifier', cursor.col - file.cursor.col);
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
        return peekVariable(file) ?? peekNumber(file) ?? peekString(file) ?? peekIdentifier(file, 'a list') ?? peekIdentifier(file, 'a map') ?? peekIdentifier(file, 'yes') ?? peekIdentifier(file, 'no') ?? peekIdentifier(file, 'nothing') ?? null;
    }
    function processVariableValue(file, token) {
        if (token.type === 'string')
            return ['string', JSON.parse(token.text)];
        else if (token.type === 'number')
            return ['number', JSON.parse(token.text)];
        else if (token.type === 'variable')
            return ['variable', { $: token.text }];
        else if (token.type === 'identifier') {
            if (token.text === 'yes')
                return ['boolean', true];
            else if (token.text === 'no')
                return ['boolean', false];
            else if (token.text === 'nothing')
                return ['null', null];
            else if (token.text === 'a list')
                return ['list', []];
            else if (token.text === 'a map')
                return ['map', {}];
        }
        throw new ParseError(file, token.range, `Could not determine the value of this expression: '${token.text}'`);
    }
    function processVariableValueOfType(file, token, type, error) {
        const [actualType, value] = processVariableValue(file, token);
        if (actualType !== type) {
            throw new ParseError(file, token.range, `${error}, but this line has '${token.text}'.`);
        }
        return value;
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
//# sourceMappingURL=index.js.map