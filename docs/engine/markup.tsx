
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
const errorEditor = <div id="errorEditor" className="closed" onclick={clickTrap} /> as HTMLDivElement
const nameplate = <div id="nameplate" /> as HTMLDivElement
const dialogue = <div id="dialogue" /> as HTMLDivElement
const choiceList = <div id="choiceList" /> as HTMLDivElement
const caret = <div id="caret" /> as HTMLDivElement
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
    {errorEditor}
</div> as HTMLDivElement

document.body.append(main)
