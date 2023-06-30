
const MARKUP = (() => {
    function clickTrap(e: MouseEvent) {
        e.preventDefault()
        e.stopPropagation()
    }
    
    let currentBackdrop = <div className="backdrop" /> as HTMLDivElement
    const characterBounds = <div id="characterBounds" /> as HTMLDivElement
    const viewport = <div id="viewport">
        {currentBackdrop}
        {characterBounds}
    </div> as HTMLDivElement

    const menu = <div id="menu" className="closed" onclick={clickTrap} /> as HTMLDivElement
    
    const codeFiles = <div id="codeFiles" />
    const codePane = <div id="codePane" />
    const codeEditor = <div id="codeEditor" className="closed" onclick={clickTrap}>
        {codeFiles}
        {codePane}
    </div> as HTMLDivElement

    const nameplate = <div id="nameplate" /> as HTMLDivElement
    const dialogue = <div id="dialogue" /> as HTMLDivElement
    const caret = <div id="caret" /> as HTMLDivElement
    const choiceList = <div id="choiceList" /> as HTMLDivElement
    const textbox = <div id="textbox">
        {nameplate}
        {dialogue}
        {caret}
        {choiceList}
    </div> as HTMLDivElement

    const main = <div id="main">
        {viewport}
        {textbox}
        {menu}
        {codeEditor}
    </div> as HTMLDivElement

    function makeLoadingSpinner() {
        const spinner = <div className="spinner">
            <div />
            <div />
            <div />
            <div />
            <div />
            <div />
        </div> as HTMLDivElement
        return spinner
    }
    
    document.body.append(main)

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
        makeLoadingSpinner,
    }
})()