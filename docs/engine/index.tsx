async function loadProject() {
    const story = await PARSER.parseStory('project', 'project/story.nvn', async path => {
        const response = await fetch(path)
        const text = await response.text()
        return text
    })
    for (const file of Object.values(story.files)) {
        if (file?.errors.length) {
            MONACO.makeCodeEditor(file)
        }
    }
    console.log(story)
}

requestAnimationFrame(async () => {
    await loadProject()
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
})
